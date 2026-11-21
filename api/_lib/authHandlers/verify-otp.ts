import crypto from 'crypto';
import { getSupabaseServerClient } from '../supabaseServer.js';
import { updateServerInvitationStatus } from '../invitationServer.js';
import { verifyOtpHash, OTP_CONFIG, serverOtpStore, verifyVerificationTicket, markTicketConsumed } from '../otpServer.js';
import { createSignedSessionToken } from '../sessionServer.js';
import { getRequiredServerSecret } from '../serverSecret.js';
import { normalizeEmail } from '../../../src/lib/emailNormalization.js';

function safeDatabaseErrorCode(error: any): string {
  return typeof error?.code === 'string' && /^[A-Z0-9_]+$/i.test(error.code)
    ? error.code
    : 'unknown';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { email, otp, purpose, inviteToken, verificationTicket, registrationTicket } = req.body || {};
    const effectiveTicket = verificationTicket || registrationTicket;

    if (!purpose || !['LOGIN', 'REGISTER', 'INVITATION'].includes(purpose)) {
      return res.status(400).json({ error: 'Valid purpose (LOGIN, REGISTER, INVITATION) is required' });
    }

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const normEmail = normalizeEmail(email);
    if (!normEmail.isValid) {
      return res.status(400).json({ error: normEmail.error || 'Invalid email address format' });
    }
    const normalizedEmail = normEmail.normalized;

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
    }
    const cleanOtp = otp.trim();

    // 0. Pre-flight session signing secret before burning OTP or modifying DB state
    try {
      getRequiredServerSecret('SESSION_SERVER_SECRET');
    } catch (secretErr: any) {
      return res.status(500).json({ error: secretErr.message || 'SESSION_SERVER_SECRET is missing or invalid' });
    }

    let supabase: any = null;
    try {
      supabase = getSupabaseServerClient();
    } catch {
      supabase = null;
    }
    const now = new Date();

    // Login and invitation verification require shared durable state. Never
    // fall back to a stateless signed payload or an instance-local Map.
    if (purpose !== 'REGISTER' && !supabase) {
      return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
    }

    // Pre-flight invitation status check before consuming OTP or updating attempt limits
    if (purpose === 'INVITATION') {
      if (!inviteToken || typeof inviteToken !== 'string' || !inviteToken.trim()) {
        return res.status(400).json({ error: 'Invitation token is required.' });
      }

      const cleanToken = inviteToken.trim();
      let preInv: any = null;
      try {
        const { data, error: invErr } = await supabase
          .from('organization_invitations')
          .select('status, expires_at, email')
          .eq('token', cleanToken)
          .maybeSingle();
        if (invErr) {
          console.error('[verify-otp] Invitation lookup failed', {
            stage: 'organization_invitations.select',
            code: safeDatabaseErrorCode(invErr),
          });
          return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
        }
        preInv = data;
      } catch (invErr: any) {
        console.error('[verify-otp] Invitation lookup failed', {
          stage: 'organization_invitations.select',
          code: safeDatabaseErrorCode(invErr),
        });
        return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
      }

      if (!preInv) return res.status(404).json({ error: 'Invalid invitation link.' });

      {
        if (preInv.status === 'REVOKED') {
          return res.status(403).json({ error: 'This invitation has been revoked by the organization owner.' });
        }
        if (preInv.status === 'EXPIRED' || new Date(preInv.expires_at).getTime() < now.getTime()) {
          return res.status(400).json({ error: 'This invitation has expired. Request a new invitation.' });
        }
        if (preInv.status === 'ACCEPTED') {
          return res.status(400).json({ error: 'This invitation has already been accepted. Please sign in directly.' });
        }
        if (preInv.email) {
          const invEmailNorm = normalizeEmail(preInv.email);
          if (invEmailNorm.normalized !== normalizedEmail) {
            return res.status(400).json({ error: 'Email address does not match this invitation.' });
          }
        }
      }
    }

    // 1. Fetch active OTP record
    let otpRecord: any = null;
    let pendingReg: any = null;
    let registrationTicketPayload: ReturnType<typeof verifyVerificationTicket> = null;
    let registrationLookupStatus: 'not_found' | 'query_error' | 'row_found' = 'not_found';

    if (purpose === 'REGISTER') {
      if (!supabase) {
        return res.status(503).json({ error: 'Registration verification is temporarily unavailable. Please try again.' });
      }
      if (typeof effectiveTicket !== 'string' || !effectiveTicket) {
        return res.status(400).json({ error: 'No pending registration found for this email address.' });
      }

      try {
        const { data: reg, error: regErr } = await supabase
          .from('pending_registrations')
          .select('*')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (regErr) {
          registrationLookupStatus = 'query_error';
          console.error('[verify-otp] Pending registration lookup failed', {
            stage: 'pending_registrations.select',
            code: safeDatabaseErrorCode(regErr),
          });
          return res.status(503).json({ error: 'Registration verification is temporarily unavailable. Please try again.' });
        }
        const regRow = Array.isArray(reg) ? (reg.length > 0 ? reg[0] : null) : reg;
        if (regRow?.otp_hash && regRow?.otp_ticket_id) {
          registrationLookupStatus = 'row_found';
          pendingReg = regRow;
        }
      } catch (lookupError: any) {
        registrationLookupStatus = 'query_error';
        console.error('[verify-otp] Pending registration lookup failed', {
          stage: 'pending_registrations.select',
          code: safeDatabaseErrorCode(lookupError),
        });
        return res.status(503).json({ error: 'Registration verification is temporarily unavailable. Please try again.' });
      }

      if (!pendingReg) {
        console.warn('[verify-otp] Registration verification state unavailable', {
          databaseLookup: registrationLookupStatus,
        });
        return res.status(400).json({ error: 'No pending registration found for this email address.' });
      }

      if (new Date(pendingReg.expires_at).getTime() <= now.getTime()) {
        return res.status(400).json({ error: 'That code has expired. Request a new code.' });
      }

      registrationTicketPayload = verifyVerificationTicket(effectiveTicket);
      if (!registrationTicketPayload ||
          registrationTicketPayload.email !== normalizedEmail ||
          normalizeEmail(pendingReg.email || '').normalized !== normalizedEmail ||
          registrationTicketPayload.purpose !== 'REGISTER' ||
          registrationTicketPayload.ticketId !== pendingReg.otp_ticket_id ||
          registrationTicketPayload.otpHash !== pendingReg.otp_hash ||
          new Date(registrationTicketPayload.expiresAt).getTime() !== new Date(pendingReg.expires_at).getTime()) {
        return res.status(400).json({ error: 'No pending registration found for this email address.' });
      }
      otpRecord = { ...pendingReg, ticketId: pendingReg.otp_ticket_id };
    } else {
      if (typeof effectiveTicket !== 'string' || !effectiveTicket) {
        return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
      }

      const ticketData = verifyVerificationTicket(effectiveTicket);
      if (!ticketData || ticketData.email !== normalizedEmail || ticketData.purpose !== purpose ||
          (purpose === 'INVITATION' && ticketData.inviteToken !== String(inviteToken).trim())) {
        return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
      }

      let records: any[] | null = null;
      try {
        const { data, error: recErr } = await supabase
          .from('email_otps')
          .select('id, ticket_id, email, purpose, otp_hash, attempts, expires_at, resend_after, used, verified_at')
          .eq('ticket_id', ticketData.ticketId)
          .eq('email', normalizedEmail)
          .eq('purpose', purpose)
          .limit(1);
        if (recErr) {
          console.error('[verify-otp] Durable OTP lookup failed', {
            stage: 'email_otps.select',
            code: safeDatabaseErrorCode(recErr),
          });
          return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
        }
        records = data;
      } catch (recErr: any) {
        console.error('[verify-otp] Durable OTP lookup failed', {
          stage: 'email_otps.select',
          code: safeDatabaseErrorCode(recErr),
        });
        return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
      }

      otpRecord = records?.[0] || null;
      if (!otpRecord) {
        return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
      }
      if (otpRecord.ticket_id !== ticketData.ticketId || otpRecord.email !== normalizedEmail ||
          otpRecord.purpose !== purpose || otpRecord.otp_hash !== ticketData.otpHash ||
          new Date(otpRecord.expires_at).getTime() !== new Date(ticketData.expiresAt).getTime()) {
        return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
      }
      otpRecord.ticketId = ticketData.ticketId;
    }

    // 2. Check Expiration
    if (new Date(otpRecord.expires_at) <= now) {
      return res.status(400).json({ error: 'That code has expired. Request a new code.' });
    }

    // 3. Check Attempt Limit
    const registrationTicketId = purpose === 'REGISTER' ? otpRecord.ticketId : null;

    // The handler performs the existing timing-safe HMAC comparison. The RPC
    // then locks the issued ticket and atomically records either the failure
    // or successful verification, preventing concurrent limit bypasses.
    let isMatch = false;
    let verifiedLoginProfile: any = null;
    let verifiedLoginOrg: any = null;
    if (purpose === 'REGISTER') {
      const candidateMatches = verifyOtpHash(normalizedEmail, cleanOtp, otpRecord.otp_hash);
      const { data: state, error: verifyError } = await supabase.rpc('complete_registration_otp_verification', {
        p_ticket_id: registrationTicketId,
        p_email: normalizedEmail,
        p_is_valid: candidateMatches,
      });
      if (verifyError || !state) {
        return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
      }
      if (!state.verified) {
        if (state.unavailable || state.consumed) {
          return res.status(400).json({ error: 'No pending registration found for this email address.' });
        }
        if (state.expired) return res.status(400).json({ error: 'That code has expired. Request a new code.' });
        if (state.locked || Number(state.attempts) >= OTP_CONFIG.MAX_ATTEMPTS) {
          return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
        }
        return res.status(400).json({ error: 'Invalid verification code.' });
      }
      isMatch = true;
    } else {
      // 4. Cryptographic Timing-Safe Hash Verification
      const candidateMatches = verifyOtpHash(normalizedEmail, cleanOtp, otpRecord.otp_hash);
      if (purpose === 'LOGIN' && candidateMatches) {
        try {
          const { data, error: profileLookupError } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', normalizedEmail)
            .single();
          if (profileLookupError && profileLookupError.code !== 'PGRST116') {
            console.error('[verify-otp] Profile lookup failed', {
              stage: 'profiles.select',
              code: safeDatabaseErrorCode(profileLookupError),
            });
            return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please try again.' });
          }
          verifiedLoginProfile = profileLookupError ? null : data || null;
        } catch (profileLookupError: any) {
          console.error('[verify-otp] Profile lookup failed', {
            stage: 'profiles.select',
            code: safeDatabaseErrorCode(profileLookupError),
          });
          return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please try again.' });
        }

        if (verifiedLoginProfile) {
          try {
            const { data, error: orgLookupError } = await supabase
              .from('organizations')
              .select('*')
              .eq('id', verifiedLoginProfile.organization_id)
              .single();
            if (orgLookupError) {
              console.error('[verify-otp] Organization lookup failed', {
                stage: 'organizations.select',
                code: safeDatabaseErrorCode(orgLookupError),
              });
              return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please try again.' });
            }
            verifiedLoginOrg = data || null;
          } catch (orgLookupError: any) {
            console.error('[verify-otp] Organization lookup failed', {
              stage: 'organizations.select',
              code: safeDatabaseErrorCode(orgLookupError),
            });
            return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please try again.' });
          }
          if (!verifiedLoginOrg) {
            return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please try again.' });
          }
        }
      }

      let state: any = null;
      try {
        const { data, error: verifyError } = await supabase.rpc('complete_email_otp_verification', {
          p_ticket_id: otpRecord.ticket_id,
          p_email: normalizedEmail,
          p_purpose: purpose,
          p_is_valid: candidateMatches,
        });
        if (verifyError || !data) {
          console.error('[verify-otp] Atomic OTP verification failed', {
            stage: 'complete_email_otp_verification',
            code: safeDatabaseErrorCode(verifyError),
          });
          return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
        }
        state = data;
      } catch (verifyError: any) {
        console.error('[verify-otp] Atomic OTP verification failed', {
          stage: 'complete_email_otp_verification',
          code: safeDatabaseErrorCode(verifyError),
        });
        return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
      }

      if (!state?.verified) {
        if (state?.reason === 'expired') {
          return res.status(400).json({ error: 'That code has expired. Request a new code.' });
        }
        if (state?.reason === 'locked') {
          return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
        }
        if (state?.reason === 'consumed' || state?.reason === 'unavailable') {
          return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
        }
        if (state?.reason === 'invalid') {
          return res.status(400).json({ error: 'Invalid verification code.' });
        }
        return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again.' });
      }
      isMatch = true;
    }

    // Resolve LOGIN before consuming its ticket. A transient profile lookup
    // failure must leave a valid OTP available for a retry; a confirmed
    // not-found result is retained and handled after the normal consumption.
    if (purpose === 'LOGIN') {
      // Profile and organization were resolved before the atomic ticket claim,
      // so transient lookup failures do not consume a valid OTP.
    }

    // 5. Consume LOGIN/INVITATION OTPs now. For REGISTER, retain the pending
    // registration until both the organization and owner profile are persisted.
    if (purpose !== 'REGISTER') {
      serverOtpStore.delete(`${normalizedEmail}:${purpose}`);
      if (otpRecord.ticketId) {
        markTicketConsumed(otpRecord.ticketId, otpRecord.expires_at);
      }
    }

    // 6. Fulfill Verification by Purpose
    let resultProfile: any = null;
    let resultOrg: any = null;

    if (purpose === 'REGISTER') {
      // Check for existing account before creating duplicates
      try {
        const { data: existingProfile, error: profileLookupError } = await supabase
          .from('profiles')
          .select('id, email, organization_id, role, full_name, user_id, status')
          .eq('email', normalizedEmail)
          .maybeSingle();

        if (profileLookupError) {
          return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please retry.' });
        }

        const profileRow = Array.isArray(existingProfile)
          ? (existingProfile.length > 0 ? existingProfile[0] : null)
          : existingProfile;

        if (profileRow && profileRow.id && (profileRow.email ? profileRow.email.toLowerCase() === normalizedEmail : true)) {
          return res.status(409).json({
            error: 'An account with this email address already exists. Please log in.',
          });
        }
      } catch {
        return res.status(503).json({ error: 'Account lookup is temporarily unavailable. Please retry.' });
      }

      // Persist organization and owner profile in one database transaction.
      const ownerUserId = crypto.randomUUID();
      const baseSlug = (pendingReg.company_name || 'org')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'org';
      const uniqueSlug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

      let resolvedOrg: any = null;
      let resolvedProfile: any = null;
      try {
        const { data, error } = await supabase.rpc('create_owner_registration', {
          p_owner_user_id: ownerUserId,
          p_email: normalizedEmail,
          p_full_name: pendingReg.owner_name,
          p_phone: pendingReg.phone_number || null,
          p_company_name: pendingReg.company_name,
          p_slug: uniqueSlug,
          p_industry: pendingReg.industry || 'General',
          p_company_size: pendingReg.company_size || '1-10',
          p_business_email: pendingReg.business_email || null,
          p_business_phone: pendingReg.business_phone || null,
          p_business_location: pendingReg.business_location || null,
          p_website_url: pendingReg.website_url || null,
          p_ticket_id: registrationTicketId,
          p_ticket_expires_at: pendingReg.expires_at,
        });
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'An account with this email address already exists. Please log in.' });
          if (error.code === '22023') return res.status(400).json({ error: 'Registration verification ticket is invalid or expired. Please request a new code.' });
          console.error('[verify-otp] Owner registration transaction failed', { code: safeDatabaseErrorCode(error) });
          return res.status(503).json({ error: 'Account creation is temporarily unavailable. Please retry.' });
        }
        resolvedOrg = data?.organization;
        resolvedProfile = data?.profile;
      } catch (error: any) {
        console.error('[verify-otp] Owner registration transaction failed', { code: safeDatabaseErrorCode(error) });
        return res.status(503).json({ error: 'Account creation is temporarily unavailable. Please retry.' });
      }

      if (!resolvedProfile) {
        console.error('[verify-otp] Owner profile insert returned no row', {
          stage: 'profiles.insert',
          code: 'empty_result',
        });
        return res.status(500).json({
          error: 'The owner profile could not be saved. Please try again.',
        });
      }

      // Account creation is now persisted. Consume registration state only now.
      serverOtpStore.delete(`${normalizedEmail}:REGISTER`);
      if (otpRecord.ticketId) {
        markTicketConsumed(otpRecord.ticketId, otpRecord.expires_at);
      }
      if (otpRecord.id && !String(otpRecord.id).startsWith('ticket-') &&
          !['preg-local', 'otp-local'].includes(String(otpRecord.id))) {
        const { error: otpCleanupError } = await supabase
          .from('email_otps')
          .update({ used: true })
          .eq('email', normalizedEmail)
          .eq('purpose', 'REGISTER')
          .eq('used', false);
        if (otpCleanupError) {
          console.error('[verify-otp] Registration OTP cleanup failed', {
            stage: 'email_otps.update',
            code: safeDatabaseErrorCode(otpCleanupError),
          });
        }
      }

      resultProfile = resolvedProfile;
      resultOrg = resolvedOrg;

      // Log Security & Activity Events
      try {
        await supabase.from('security_events').insert({
          organization_id: resolvedOrg.id,
          user_id: resolvedProfile.id,
          user_name: resolvedProfile.full_name,
          event_type: 'OTP_VERIFIED',
          severity: 'LOW',
          description: `Owner ${resolvedProfile.full_name} verified email address: ${normEmail.masked}`,
          metadata: { emailMasked: normEmail.masked, role: 'OWNER' },
        });

        await supabase.from('security_events').insert({
          organization_id: resolvedOrg.id,
          user_id: resolvedProfile.id,
          user_name: resolvedProfile.full_name,
          event_type: 'ACCOUNT_CREATED',
          severity: 'LOW',
          description: `Organization ${resolvedOrg.name} and Owner account created.`,
          metadata: { organizationId: resolvedOrg.id, role: 'OWNER' },
        });

        await supabase.from('activity_logs').insert({
          organization_id: resolvedOrg.id,
          user_id: resolvedProfile.id,
          user_name: resolvedProfile.full_name,
          user_role: 'OWNER',
          action: 'LOGIN',
          entity_type: 'auth',
          metadata: { event: 'OWNER_REGISTER_VERIFIED' },
        });
      } catch {
        // Logging error handled
      }
    } else if (purpose === 'LOGIN') {
      // Existing User Login
      const profile = verifiedLoginProfile;

      if (!profile) {
        return res.status(404).json({ error: 'No account found with this email address. Please register.' });
      }

      // Status Verification
      if (profile.status === 'PENDING_VERIFICATION') {
        return res.status(403).json({ error: 'Your account is pending verification and cannot be accessed.' });
      }

      if (profile.status === 'SUSPENDED') {
        try {
          await supabase.from('security_events').insert({
            organization_id: profile.organization_id,
            user_id: profile.id,
            user_name: profile.full_name,
            event_type: 'ACCOUNT_SUSPENDED',
            severity: 'HIGH',
            description: `Suspended user ${profile.full_name} attempted to log in`,
            metadata: { emailMasked: normEmail.masked, userId: profile.id },
          });
        } catch {
          // Event log error handled
        }
        return res.status(403).json({ error: 'Your account has been suspended. Please contact your organization owner.' });
      }

      if (profile.status === 'DISABLED') {
        try {
          await supabase.from('security_events').insert({
            organization_id: profile.organization_id,
            user_id: profile.id,
            user_name: profile.full_name,
            event_type: 'ACCOUNT_DISABLED',
            severity: 'HIGH',
            description: `Disabled user ${profile.full_name} attempted to log in`,
            metadata: { emailMasked: normEmail.masked, userId: profile.id },
          });
        } catch {
          // Event log error handled
        }
        return res.status(403).json({ error: 'Your account has been disabled. Access denied.' });
      }

      // Fetch organization
      const org = verifiedLoginOrg;

      if (!org) {
        return res.status(404).json({ error: 'Organization record could not be resolved.' });
      }

      resultProfile = profile;
      resultOrg = org;

      try {
        await supabase.from('security_events').insert({
          organization_id: org.id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'OTP_VERIFIED',
          severity: 'LOW',
          description: `User ${profile.full_name} logged in via Email OTP: ${normEmail.masked}`,
          metadata: { emailMasked: normEmail.masked, role: profile.role },
        });
      } catch {
        // Event log error handled
      }
    } else if (purpose === 'INVITATION') {
      // Telecaller Invitation Acceptance
      if (!inviteToken || typeof inviteToken !== 'string' || !inviteToken.trim()) {
        return res.status(400).json({ error: 'Invitation token is required.' });
      }

      const cleanToken = inviteToken.trim();
      let inv: any = null;
      try {
        const { data, error: invErr } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('token', cleanToken)
          .maybeSingle();
        if (invErr) {
          console.error('[verify-otp] Invitation lookup failed', {
            stage: 'organization_invitations.select',
            code: safeDatabaseErrorCode(invErr),
          });
          return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
        }
        inv = data;
      } catch (invErr: any) {
        console.error('[verify-otp] Invitation lookup failed', {
          stage: 'organization_invitations.select',
          code: safeDatabaseErrorCode(invErr),
        });
        return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
      }

      if (!inv) {
        return res.status(404).json({ error: 'Invalid invitation link.' });
      }

      // Check Expiration
      const isExpired =
        inv.status === 'EXPIRED' || new Date(inv.expires_at).getTime() < now.getTime();
      if (isExpired) {
        return res.status(400).json({ error: 'This invitation has expired. Request a new invitation.' });
      }

      // Check Invitation Status
      if (inv.status === 'ACCEPTED') {
        return res.status(400).json({ error: 'This invitation has already been accepted. Please sign in directly.' });
      }
      if (inv.status === 'REVOKED') {
        return res.status(403).json({ error: 'This invitation has been revoked by the organization owner.' });
      }
      if (inv.status !== 'PENDING') {
        return res.status(400).json({ error: 'Invalid or already accepted invitation.' });
      }

      // Check Email Binding (Telecaller email must match the invitation)
      if (inv.email) {
        const invEmailNorm = normalizeEmail(inv.email);
        if (invEmailNorm.normalized !== normalizedEmail) {
          return res.status(400).json({ error: 'Email address does not match this invitation.' });
        }
      }

      // Fetch inviting organization
      let org: any = null;
      try {
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', inv.organization_id)
          .single();
        if (orgErr) {
          console.error('[verify-otp] Organization lookup failed', {
            stage: 'organizations.select',
            code: safeDatabaseErrorCode(orgErr),
          });
          return res.status(503).json({ error: 'Invitation organization is temporarily unavailable. Please try again.' });
        }
        org = orgData;
      } catch (orgErr: any) {
        console.error('[verify-otp] Organization lookup failed', {
          stage: 'organizations.select',
          code: safeDatabaseErrorCode(orgErr),
        });
        return res.status(503).json({ error: 'Invitation organization is temporarily unavailable. Please try again.' });
      }

      if (!org || org.status !== 'ACTIVE') {
        return res.status(404).json({ error: 'Inviting organization no longer exists or is suspended.' });
      }

      // Check if email already belongs to a profile (prevent cross-tenant hijacking)
      let existingProfile: any = null;
      try {
        const { data: profData, error: profileError } = await supabase
          .from('profiles')
          .select('id, user_id, organization_id, full_name, email, role, status')
          .eq('email', normalizedEmail)
          .maybeSingle();
        if (profileError) {
          console.error('[verify-otp] Existing profile lookup failed', {
            stage: 'profiles.select',
            code: safeDatabaseErrorCode(profileError),
          });
          return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
        }
        existingProfile = profData || null;
      } catch (profileError: any) {
        console.error('[verify-otp] Existing profile lookup failed', {
          stage: 'profiles.select',
          code: safeDatabaseErrorCode(profileError),
        });
        return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
      }

      if (existingProfile) {
        if (existingProfile.organization_id !== org.id) {
          return res.status(409).json({
            error: 'An account with this email address already belongs to another organization.',
          });
        }
      }

      // Atomic Status Update to Prevent Race Conditions and Replay Attacks
      let markedAccepted = false;
      try {
        const { data: updatedInv, error: updateErr } = await supabase
          .from('organization_invitations')
          .update({ status: 'ACCEPTED' })
          .eq('id', inv.id)
          .eq('status', 'PENDING')
          .select('*')
          .maybeSingle();
        if (updateErr) {
          console.error('[verify-otp] Invitation acceptance failed', {
            stage: 'organization_invitations.update',
            code: safeDatabaseErrorCode(updateErr),
          });
          return res.status(503).json({ error: 'Invitation acceptance is temporarily unavailable. Please try again.' });
        }
        markedAccepted = Boolean(updatedInv);
      } catch (updateErr: any) {
        console.error('[verify-otp] Invitation acceptance failed', {
          stage: 'organization_invitations.update',
          code: safeDatabaseErrorCode(updateErr),
        });
        return res.status(503).json({ error: 'Invitation acceptance is temporarily unavailable. Please try again.' });
      }

      if (!markedAccepted) {
        return res.status(400).json({ error: 'This invitation has already been accepted.' });
      }

      updateServerInvitationStatus(cleanToken, 'ACCEPTED');

      // Create or activate Telecaller Profile (Strictly TELECALLER role)
      let newTc: any = existingProfile;
      if (!newTc) {
        try {
          const { data: tcData, error: tcErr } = await supabase
            .from('profiles')
            .insert({
              user_id: crypto.randomUUID(),
              organization_id: org.id,
              full_name: inv.full_name,
              email: normalizedEmail,
              phone: inv.phone_number || null,
              email_verified: true,
              phone_verified: false,
              role: 'TELECALLER',
              status: 'ACTIVE',
            })
            .select('*')
            .single();
          if (tcErr || !tcData) {
            console.error('[verify-otp] Telecaller profile creation failed', {
              stage: 'profiles.insert',
              code: safeDatabaseErrorCode(tcErr),
            });
            return res.status(503).json({ error: 'Failed to activate telecaller account. Please try again shortly.' });
          }
          newTc = tcData;
        } catch (tcErr: any) {
          console.error('[verify-otp] Telecaller profile creation failed', {
            stage: 'profiles.insert',
            code: safeDatabaseErrorCode(tcErr),
          });
          return res.status(503).json({ error: 'Failed to activate telecaller account. Please try again shortly.' });
        }
      }

      resultProfile = newTc;
      resultOrg = org;

      if (supabase) {
        try {
          await supabase.from('security_events').insert({
            organization_id: org.id,
            user_id: newTc.id,
            user_name: newTc.full_name,
            event_type: 'INVITATION_ACCEPTED',
            severity: 'LOW',
            description: `Telecaller ${newTc.full_name} accepted invitation and joined organization ${org.name}.`,
            metadata: { emailMasked: normEmail.masked, role: 'TELECALLER', invitedBy: inv.invited_by },
          });
        } catch {
          // Event log error handled
        }
      }
    }

    // 7. Issue server-signed cryptographic session token
    const sessionToken = createSignedSessionToken({
      userId: resultProfile.user_id,
      profileId: resultProfile.id,
      organizationId: resultOrg?.id || resultProfile.organization_id,
      role: resultProfile.role,
      email: normalizedEmail,
      fullName: resultProfile.full_name,
    });

    return res.status(200).json({
      success: true,
      sessionToken,
      profile: resultProfile,
      organization: resultOrg,
      role: resultProfile?.role,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'OTP verification failed.' });
  }
}
