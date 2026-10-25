import crypto from 'crypto';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';
import { verifyOtpHash, OTP_CONFIG, serverOtpStore, verifyVerificationTicket, markTicketConsumed } from '../_lib/otpServer.js';
import { createSignedSessionToken } from '../_lib/sessionServer.js';
import { getRequiredServerSecret } from '../_lib/serverSecret.js';
import { normalizeEmail } from '../../src/lib/emailNormalization.js';

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

    const supabase = getSupabaseServerClient();
    const now = new Date();

    // 1. Fetch active OTP record
    let otpRecord: any = null;
    let pendingReg: any = null;
    let registrationLookupStatus: 'not_found' | 'query_error' | 'row_found' = 'not_found';

    if (purpose === 'REGISTER') {
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
        } else {
          const regRow = Array.isArray(reg) ? (reg.length > 0 ? reg[0] : null) : reg;
          if (regRow && regRow.otp_hash) {
            registrationLookupStatus = 'row_found';
            pendingReg = regRow;
            otpRecord = regRow;
          }
        }
      } catch (lookupError: any) {
        registrationLookupStatus = 'query_error';
        console.error('[verify-otp] Pending registration lookup failed', {
          stage: 'pending_registrations.select',
          code: safeDatabaseErrorCode(lookupError),
        });
      }

      // Check signed stateless verification ticket
      if (!otpRecord && effectiveTicket) {
        const ticketData = verifyVerificationTicket(effectiveTicket);
        if (ticketData && ticketData.email === normalizedEmail && ticketData.purpose === 'REGISTER') {
          pendingReg = {
            id: 'ticket-reg',
            ticketId: ticketData.ticketId,
            email: ticketData.email,
            company_name: ticketData.companyName || 'Organization',
            owner_name: ticketData.ownerName || 'Owner',
            phone_number: ticketData.phone || null,
            industry: ticketData.industry || 'General',
            company_size: ticketData.companySize || '1-10',
            otp_hash: ticketData.otpHash,
            attempts: 0,
            expires_at: ticketData.expiresAt,
          };
          otpRecord = pendingReg;
        }
      }

      if (!otpRecord) {
        const mem = serverOtpStore.get(`${normalizedEmail}:REGISTER`);
        if (mem && !mem.used) {
          pendingReg = {
            id: 'preg-local',
            email: mem.identifier,
            company_name: mem.registrationData?.companyName || req.body?.registrationData?.companyName || 'Organization',
            owner_name: mem.registrationData?.ownerName || req.body?.registrationData?.ownerName || 'Owner',
            phone_number: mem.registrationData?.phone || null,
            industry: mem.registrationData?.industry || req.body?.registrationData?.industry || 'General',
            company_size: mem.registrationData?.companySize || req.body?.registrationData?.companySize || '1-10',
            otp_hash: mem.otpHash,
            attempts: mem.attempts,
            expires_at: mem.expiresAt,
          };
          otpRecord = pendingReg;
        }
      }

      if (!otpRecord) {
        console.warn('[verify-otp] Registration verification state unavailable', {
          databaseLookup: registrationLookupStatus,
          memoryFallback: 'miss',
        });
        return res.status(400).json({ error: 'No pending registration found for this email address.' });
      }
    } else {
      try {
        const { data: records, error: recErr } = await supabase
          .from('email_otps')
          .select('*')
          .eq('email', normalizedEmail)
          .eq('purpose', purpose)
          .eq('used', false)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!recErr && records && records.length > 0) {
          otpRecord = records[0];
        }
      } catch {
        // Query error handled by fallback check
      }

      // Check signed stateless verification ticket
      if (!otpRecord && effectiveTicket) {
        const ticketData = verifyVerificationTicket(effectiveTicket);
        if (ticketData && ticketData.email === normalizedEmail && ticketData.purpose === purpose) {
          otpRecord = {
            id: 'ticket-otp',
            ticketId: ticketData.ticketId,
            email: ticketData.email,
            purpose: ticketData.purpose,
            otp_hash: ticketData.otpHash,
            attempts: 0,
            expires_at: ticketData.expiresAt,
          };
        }
      }

      if (!otpRecord) {
        const mem = serverOtpStore.get(`${normalizedEmail}:${purpose}`);
        if (mem && !mem.used) {
          otpRecord = {
            id: 'otp-local',
            email: mem.identifier,
            purpose: mem.purpose,
            otp_hash: mem.otpHash,
            attempts: mem.attempts,
            expires_at: mem.expiresAt,
          };
        }
      }

      if (!otpRecord) {
        return res.status(400).json({ error: 'No active verification code found. Request a new code.' });
      }
    }

    // 2. Check Expiration
    if (new Date(otpRecord.expires_at) < now) {
      return res.status(400).json({ error: 'That code has expired. Request a new code.' });
    }

    // 3. Check Attempt Limit
    if (otpRecord.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
    }

    // 4. Cryptographic Timing-Safe Hash Verification
    const isMatch = verifyOtpHash(normalizedEmail, cleanOtp, otpRecord.otp_hash);

    if (!isMatch) {
      const updatedAttempts = otpRecord.attempts + 1;
      const mem = serverOtpStore.get(`${normalizedEmail}:${purpose}`);
      if (mem) {
        mem.attempts = updatedAttempts;
      }

      if (otpRecord.id && !otpRecord.id.startsWith('ticket-')) {
        try {
          if (purpose === 'REGISTER') {
            await supabase
              .from('pending_registrations')
              .update({ attempts: updatedAttempts })
              .eq('id', otpRecord.id);
          } else {
            await supabase
              .from('email_otps')
              .update({ attempts: updatedAttempts })
              .eq('id', otpRecord.id);
          }
        } catch {
          // Update error handled
        }
      }

      try {
        await supabase.from('security_events').insert({
          event_type: 'OTP_FAILED',
          severity: 'MEDIUM',
          description: `Failed OTP attempt (${updatedAttempts}/${OTP_CONFIG.MAX_ATTEMPTS}) for email: ${normEmail.masked}`,
          metadata: { emailMasked: normEmail.masked, attempts: updatedAttempts, purpose },
        });
      } catch {
        // Logging error handled
      }

      if (updatedAttempts >= OTP_CONFIG.MAX_ATTEMPTS) {
        return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });
      }

      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // 5. Invalidate OTP Immediately upon Successful Verification
    serverOtpStore.delete(`${normalizedEmail}:${purpose}`);
    if (otpRecord.ticketId) {
      markTicketConsumed(otpRecord.ticketId, otpRecord.expires_at);
    }
    if (otpRecord.id && !otpRecord.id.startsWith('ticket-')) {
      try {
        if (purpose === 'REGISTER') {
          await supabase
            .from('pending_registrations')
            .delete()
            .eq('id', otpRecord.id);
        } else {
          await supabase
            .from('email_otps')
            .update({ used: true })
            .eq('id', otpRecord.id);
        }
      } catch {
        // Invalidation error handled
      }
    }

    // 6. Fulfill Verification by Purpose
    let resultProfile: any = null;
    let resultOrg: any = null;

    if (purpose === 'REGISTER') {
      // Check for existing account before creating duplicates
      try {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, email, organization_id, role, full_name, user_id, status')
          .eq('email', normalizedEmail)
          .maybeSingle();

        const profileRow = Array.isArray(existingProfile)
          ? (existingProfile.length > 0 ? existingProfile[0] : null)
          : existingProfile;

        if (profileRow && profileRow.id && (profileRow.email ? profileRow.email.toLowerCase() === normalizedEmail : true)) {
          return res.status(409).json({
            error: 'An account with this email address already exists. Please log in.',
          });
        }
      } catch {
        // Query error handled
      }

      // Generate standard RFC 4122 UUID for owner and unique slug
      const ownerUserId = crypto.randomUUID();
      const baseSlug = (pendingReg.company_name || 'org')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'org';
      const uniqueSlug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

      // Create Organization
      let resolvedOrg: any = null;
      try {
        const { data: newOrg, error: orgErr } = await supabase
          .from('organizations')
          .insert({
            name: pendingReg.company_name,
            slug: uniqueSlug,
            industry: pendingReg.industry || 'General',
            company_size: pendingReg.company_size || '1-10',
            owner_id: ownerUserId,
            status: 'ACTIVE',
          })
          .select('*')
          .single();

        if (orgErr) {
          console.error('[verify-otp] Organization creation failed', {
            stage: 'organizations.insert',
            code: safeDatabaseErrorCode(orgErr),
          });
          if (process.env.NODE_ENV === 'production') {
            return res.status(500).json({
              error: 'Failed to create organization account. Please try again shortly.',
            });
          }
        } else if (newOrg) {
          resolvedOrg = newOrg;
        }
      } catch (orgErr: any) {
        console.error('[verify-otp] Organization creation failed', {
          stage: 'organizations.insert',
          code: safeDatabaseErrorCode(orgErr),
        });
        if (process.env.NODE_ENV === 'production') {
          return res.status(500).json({
            error: 'Failed to create organization account. Please try again shortly.',
          });
        }
      }

      if (!resolvedOrg) {
        resolvedOrg = {
          id: `org-${crypto.randomUUID()}`,
          name: pendingReg.company_name,
          slug: uniqueSlug,
          industry: pendingReg.industry || 'General',
          company_size: pendingReg.company_size || '1-10',
          owner_id: ownerUserId,
          status: 'ACTIVE',
        };
      }

      // Create Owner Profile (Server-Side Only!)
      let resolvedProfile: any = null;
      try {
        const { data: newProfile, error: profErr } = await supabase
          .from('profiles')
          .insert({
            user_id: resolvedOrg.owner_id,
            organization_id: resolvedOrg.id,
            full_name: pendingReg.owner_name,
            email: normalizedEmail,
            phone: pendingReg.phone_number || null,
            email_verified: true,
            phone_verified: false,
            role: 'OWNER',
            status: 'ACTIVE',
          })
          .select('*')
          .single();

        if (profErr) {
          console.error('[verify-otp] Owner profile creation failed', {
            stage: 'profiles.insert',
            code: safeDatabaseErrorCode(profErr),
          });
          // Rollback newly created organization if profile insert fails
          if (resolvedOrg?.id && !resolvedOrg.id.startsWith('org-')) {
            try {
              await supabase.from('organizations').delete().eq('id', resolvedOrg.id);
            } catch {
              // Rollback error handled
            }
          }
          if (process.env.NODE_ENV === 'production') {
            return res.status(500).json({
              error: 'Failed to create owner profile. Please try again shortly.',
            });
          }
        } else if (newProfile) {
          resolvedProfile = newProfile;
        }
      } catch (profErr: any) {
        console.error('[verify-otp] Owner profile creation failed', {
          stage: 'profiles.insert',
          code: safeDatabaseErrorCode(profErr),
        });
        if (resolvedOrg?.id && !resolvedOrg.id.startsWith('org-')) {
          try {
            await supabase.from('organizations').delete().eq('id', resolvedOrg.id);
          } catch {
            // Rollback error handled
          }
        }
        if (process.env.NODE_ENV === 'production') {
          return res.status(500).json({
            error: 'Failed to create owner profile. Please try again shortly.',
          });
        }
      }

      if (!resolvedProfile) {
        resolvedProfile = {
          id: `prof-${crypto.randomUUID()}`,
          user_id: resolvedOrg.owner_id,
          organization_id: resolvedOrg.id,
          full_name: pendingReg.owner_name,
          email: normalizedEmail,
          phone: pendingReg.phone_number || null,
          email_verified: true,
          phone_verified: false,
          role: 'OWNER',
          status: 'ACTIVE',
        };
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
      let profile: any = null;
      try {
        const { data, error: profErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', normalizedEmail)
          .single();

        if (!profErr && data) {
          profile = data;
        }
      } catch {
        // Profile query error handled
      }

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
      let org: any = null;
      try {
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single();

        if (!orgErr && orgData) {
          org = orgData;
        }
      } catch {
        // Org query error handled
      }

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
      if (!inviteToken) {
        return res.status(400).json({ error: 'Invitation token is required.' });
      }

      let inv: any = null;
      try {
        const { data, error: invErr } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('token', inviteToken)
          .single();

        if (!invErr && data) {
          inv = data;
        }
      } catch {
        // Invitation lookup error handled
      }

      if (!inv || inv.status !== 'PENDING') {
        return res.status(400).json({ error: 'Invalid or already accepted invitation.' });
      }

      // Fetch inviting organization
      let org: any = null;
      try {
        const { data: orgData, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', inv.organization_id)
          .single();

        if (!orgErr && orgData) {
          org = orgData;
        }
      } catch {
        // Org lookup error handled
      }

      if (!org) {
        return res.status(404).json({ error: 'Inviting organization no longer exists.' });
      }

      // Create Telecaller Profile (Strictly TELECALLER role)
      let newTc: any = null;
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

        if (!tcErr && tcData) {
          newTc = tcData;
        }
      } catch {
        // Insert error handled by fallback
      }

      if (!newTc) {
        if (process.env.NODE_ENV === 'production') {
          return res.status(500).json({ error: 'Failed to activate telecaller account. Please try again shortly.' });
        }
        newTc = {
          id: `tc-${Date.now().toString(36)}`,
          user_id: crypto.randomUUID(),
          organization_id: org.id,
          full_name: inv.full_name,
          email: normalizedEmail,
          phone: inv.phone_number || null,
          email_verified: true,
          phone_verified: false,
          role: 'TELECALLER',
          status: 'ACTIVE',
        };
      }

      // Mark invitation accepted
      try {
        await supabase
          .from('organization_invitations')
          .update({ status: 'ACCEPTED' })
          .eq('id', inv.id);
      } catch {
        // Update error handled
      }

      resultProfile = newTc;
      resultOrg = org;

      try {
        await supabase.from('security_events').insert({
          organization_id: org.id,
          user_id: newTc.id,
          user_name: newTc.full_name,
          event_type: 'INVITATION_ACCEPTED',
          severity: 'LOW',
          description: `Telecaller ${newTc.full_name} accepted invitation and joined organization ${org.name}.`,
          metadata: { emailMasked: normEmail.masked, role: 'TELECALLER' },
        });
      } catch {
        // Event log error handled
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
