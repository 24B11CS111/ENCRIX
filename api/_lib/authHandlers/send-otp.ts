import { getSupabaseServerClient } from '../supabaseServer.js';
import crypto from 'crypto';
import {
  generateSecureOtp,
  hashOtp,
  createVerificationTicket,
  sendVerificationEmail,
  OTP_CONFIG,
} from '../otpServer.js';
import { normalizeEmail } from '../../../src/lib/emailNormalization.js';
import { normalizePhoneNumber } from '../../../src/lib/phoneNormalization.js';

export function sanitizeErrorMessage(msg?: string): string {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]')
    .replace(/\b(inv|sess)_[a-zA-Z0-9_-]+/gi, '[REDACTED_TOKEN]')
    .replace(/\b(re|SG)_[a-zA-Z0-9_-]+/gi, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [REDACTED]')
    .replace(/BLOCKED\s*â€”\s*EMAIL\s*OTP\s*PROVIDER\s*(ERROR|NOT CONFIGURED):\s*/gi, '')
    .trim();
}

export function formatActionableEmailError(rawError: any): { error: string; code: string; status: number } {
  const msg = typeof rawError?.message === 'string' ? rawError.message : '';
  const rawStatus = Number.isInteger(rawError?.status) ? rawError.status : undefined;
  const rawCode = typeof rawError?.code === 'string' ? rawError.code : '';

  // Resend free tier: sending to unverified domain / only allowed to send to account owner email
  if (
    /testing emails to your own email address/i.test(msg) ||
    /verify a domain at resend\.com/i.test(msg) ||
    rawCode === 'EMAIL_TEST_DOMAIN_RESTRICTION'
  ) {
    const matchOwner = msg.match(/testing emails to your own email address \(([^)]+)\)/i);
    const ownerEmail = matchOwner ? ` (${matchOwner[1]})` : '';
    return {
      error: `Email delivery restricted: Using unverified testing sender domain. In testing mode, you can only invite the verified account owner email${ownerEmail}. To invite other emails, verify a custom domain at resend.com/domains.`,
      code: 'EMAIL_TEST_DOMAIN_RESTRICTION',
      status: 403,
    };
  }

  // Resend/SendGrid: Invalid recipient domain (e.g. example.com)
  if (/Invalid to field/i.test(msg) || /domains like example\.com/i.test(msg)) {
    return {
      error: 'Invalid recipient email domain. Please use a real work email address rather than an example domain.',
      code: 'EMAIL_INVALID_RECIPIENT_DOMAIN',
      status: 422,
    };
  }

  // Unconfigured provider
  if (
    /PROVIDER NOT CONFIGURED/i.test(msg) ||
    rawCode === 'EMAIL_PROVIDER_NOT_CONFIGURED'
  ) {
    return {
      error: 'Email delivery service is not configured. Please configure RESEND_API_KEY and RESEND_FROM_EMAIL.',
      code: 'EMAIL_PROVIDER_NOT_CONFIGURED',
      status: 503,
    };
  }

  // Rate limited
  if (rawStatus === 429 || /rate limit/i.test(msg)) {
    return {
      error: 'Email delivery rate limit reached. Please wait a moment before trying again.',
      code: 'EMAIL_RATE_LIMITED',
      status: 429,
    };
  }

  // Authentication error with provider (invalid API key)
  if (
    rawStatus === 401 ||
    /API key is invalid/i.test(msg) ||
    /unauthorized/i.test(msg)
  ) {
    return {
      error: 'Email delivery authentication failed. Please verify email provider API credentials.',
      code: 'EMAIL_AUTH_FAILED',
      status: 503,
    };
  }

  // Network error
  if (
    /Network error/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    rawCode === 'RESEND_NETWORK_ERROR' ||
    rawCode === 'SENDGRID_NETWORK_ERROR'
  ) {
    return {
      error: 'Unable to reach email delivery service. Please check your network connection and try again.',
      code: 'EMAIL_NETWORK_ERROR',
      status: 503,
    };
  }

  // General 4xx client errors from provider
  if (rawStatus && rawStatus >= 400 && rawStatus < 500) {
    const sanitized = sanitizeErrorMessage(msg);
    return {
      error: sanitized.length > 0 && sanitized.length < 200
        ? sanitized
        : 'Email delivery request was rejected by the provider. Please verify recipient email.',
      code: 'EMAIL_DELIVERY_REJECTED',
      status: rawStatus,
    };
  }

  // Default fallback
  return {
    error: 'Unable to send verification code. Please try again shortly.',
    code: 'EMAIL_DELIVERY_FAILED',
    status: 503,
  };
}

const SAFE_DATABASE_ERROR_CODES = new Set([
  'RESEND_NETWORK_ERROR', 'SENDGRID_NETWORK_ERROR', 'EMAIL_TEST_DOMAIN_RESTRICTION',
  'EMAIL_PROVIDER_NOT_CONFIGURED', 'RESEND_ERROR', 'SENDGRID_ERROR',
]);

export function getSafeFailureDiagnostics(
  stage: string,
  error: any,
  responseStatus?: unknown,
  source: 'rpc_result' | 'rpc_exception' | 'other' = 'other',
) {
  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const code = /^[0-9A-Z]{5}$/.test(rawCode) || /^PGRST\d{3}$/.test(rawCode) || SAFE_DATABASE_ERROR_CODES.has(rawCode)
    ? rawCode
    : 'unknown';
  const statusCandidate = Number.isInteger(responseStatus)
    ? responseStatus
    : error?.status;
  const status = Number.isInteger(statusCandidate) && statusCandidate >= 0 && statusCandidate <= 599
    ? statusCandidate as number
    : undefined;
  const errorType = ['Error', 'TypeError', 'FetchError', 'PostgrestError'].includes(error?.name)
    ? error.name
    : 'unknown';
  const kind = source === 'rpc_exception'
    ? 'rpc_exception'
    : status === 0
      ? 'transport_failure'
      : code !== 'unknown'
        ? 'supabase_response'
        : 'unclassified';

  return { stage, kind, code, status, errorType };
}

function logSafeFailure(stage: string, error: any, responseStatus?: unknown, source?: 'rpc_result' | 'rpc_exception') {
  console.error('[send-otp] Operation failed', getSafeFailureDiagnostics(stage, error, responseStatus, source));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { email, phone, purpose, fullName, companyName, inviteToken } = req.body || {};

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

    // Phone is optional for authentication
    const normPhone = phone ? normalizePhoneNumber(phone) : null;
    const optionalPhone = normPhone?.isValid ? normPhone.normalized : null;
    let businessEmail: string | null = null;
    let businessPhone: string | null = null;
    let businessLocation: string | null = null;
    let websiteUrl: string | null = null;
    if (purpose === 'REGISTER') {
      const normalizedOwnerPhone = normalizePhoneNumber(phone || '');
      const normalizedBusinessEmail = normalizeEmail(req.body?.businessEmail || '');
      const normalizedBusinessPhone = normalizePhoneNumber(req.body?.businessPhone || '');
      if (!fullName?.trim() || !companyName?.trim() || !normalizedOwnerPhone.isValid ||
          !normalizedBusinessEmail.isValid || !normalizedBusinessPhone.isValid ||
          typeof req.body?.businessLocation !== 'string' || req.body.businessLocation.trim().length < 2) {
        return res.status(400).json({ error: 'Complete all required owner and business details with valid email and phone numbers.' });
      }
      businessEmail = normalizedBusinessEmail.normalized;
      businessPhone = normalizedBusinessPhone.normalized;
      businessLocation = req.body.businessLocation.trim();
      if (req.body?.websiteUrl) {
        try {
          const parsed = new URL(req.body.websiteUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid_url');
          websiteUrl = parsed.toString();
        } catch {
          return res.status(400).json({ error: 'Enter a valid http or https website URL.' });
        }
      }
    }

    let supabase: any = null;
    try {
      supabase = getSupabaseServerClient();
    } catch {
      supabase = null;
    }
    const now = new Date();

    // 1. Check invitation validity if purpose is INVITATION
    let invitationRecord: any = null;
    if (purpose === 'INVITATION') {
      if (!inviteToken || typeof inviteToken !== 'string' || !inviteToken.trim()) {
        return res.status(400).json({ error: 'Invitation token is required' });
      }

      // Invitation OTP issuance also requires authoritative database state.
      if (!supabase) {
        return res.status(503).json({ error: 'Verification is temporarily unavailable. Please try again shortly.' });
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
          logSafeFailure('organization_invitations.select', invErr);
          return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
        }
        inv = data;
      } catch (invLookupErr: any) {
        logSafeFailure('organization_invitations.select', invLookupErr);
        return res.status(503).json({ error: 'Invitation verification is temporarily unavailable. Please try again.' });
      }

      if (!inv) {
        return res.status(404).json({ error: 'Invalid invitation link.' });
      }

      const isExpired = inv.status === 'EXPIRED' || new Date(inv.expires_at).getTime() < now.getTime();
      if (isExpired) {
        return res.status(400).json({ error: 'This invitation has expired. Request a new invitation.' });
      }

      if (inv.status === 'ACCEPTED') {
        return res.status(400).json({ error: 'This invitation has already been accepted. Please sign in directly.' });
      }

      if (inv.status === 'REVOKED') {
        return res.status(403).json({ error: 'This invitation has been revoked by the organization owner.' });
      }

      if (inv.status !== 'PENDING') {
        return res.status(400).json({ error: `This invitation is already ${String(inv.status).toLowerCase()}.` });
      }

      if (inv.email) {
        const invEmailNorm = normalizeEmail(inv.email);
        if (invEmailNorm.normalized !== normalizedEmail) {
          return res.status(400).json({ error: 'Email address does not match this invitation.' });
        }
      }

      invitationRecord = inv;
    }

    // LOGIN and INVITATION OTPs must always have a durable shared record.
    // Process memory and signed transport tickets are not an authentication
    // state store and cannot enforce cross-instance attempt limits.
    if (purpose !== 'REGISTER' && !supabase) {
      return res.status(503).json({
        error: 'Verification is temporarily unavailable. Please try again shortly.',
      });
    }

    // Rate limit, cooldown, prior-ticket invalidation, and ticket insertion are
    // serialized in issue_email_otp_ticket for LOGIN/INVITATION.
    // 3. Generate Cryptographic 6-digit OTP
    const rawOtp = generateSecureOtp();
    const otpHash = hashOtp(normalizedEmail, rawOtp);
    const expiresAt = new Date(now.getTime() + OTP_CONFIG.EXPIRY_MS).toISOString();
    const resendAfter = new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS).toISOString();

    // The signed ticket is only a transport proof. Registration verification
    // also requires the durable ticket row issued below.
    const verificationTicketId = crypto.randomUUID();
    const verificationTicket = createVerificationTicket({
      ticketId: verificationTicketId,
      email: normalizedEmail,
      purpose,
      otpHash,
      expiresAt,
      companyName,
      ownerName: fullName,
      phone: optionalPhone,
      industry: req.body?.industry,
      companySize: req.body?.companySize,
      businessEmail: businessEmail || undefined,
      businessPhone: businessPhone || undefined,
      businessLocation: businessLocation || undefined,
      websiteUrl: websiteUrl || undefined,
      inviteToken,
    });

    // 4. Store OTP record in database & memory store
    if (purpose === 'REGISTER') {
      if (!companyName || !fullName) {
        return res.status(400).json({ error: 'Full name and business name are required for registration.' });
      }

      if (!supabase) {
        return res.status(503).json({
          error: 'Registration verification could not be prepared. Please try again shortly.',
        });
      }

      try {
        const { data: issueState, error: registrationError } = await supabase.rpc('issue_registration_otp_ticket', {
          p_ticket_id: verificationTicketId,
          p_email: normalizedEmail,
          p_otp_hash: otpHash,
          p_expires_at: expiresAt,
          p_resend_after: resendAfter,
          p_phone_number: optionalPhone,
          p_company_name: companyName,
          p_owner_name: fullName,
          p_industry: req.body?.industry || 'General',
          p_company_size: req.body?.companySize || '1-10',
          p_business_email: businessEmail,
          p_business_phone: businessPhone,
          p_business_location: businessLocation,
          p_website_url: websiteUrl,
        });
        if (registrationError) {
          logSafeFailure('issue_registration_otp_ticket', registrationError);
          return res.status(503).json({
            error: 'Registration verification could not be prepared. Please try again shortly.',
          });
        }
        if (issueState?.issued === false && issueState.resend_after) {
          const remainingCooldown = Math.max(1, Math.ceil(
            (new Date(issueState.resend_after).getTime() - Date.now()) / 1000,
          ));
          return res.status(429).json({
            error: `Please wait ${remainingCooldown} seconds before requesting a new code.`,
            cooldownSeconds: remainingCooldown,
            resendAvailableAt: issueState.resend_after,
          });
        }
        if (issueState?.rate_limited === true) {
          return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        if (issueState?.issued !== true) {
          logSafeFailure('issue_registration_otp_ticket', { code: 'REGISTRATION_OTP_ISSUE_STATE_INVALID' });
          return res.status(503).json({
            error: 'Registration verification could not be prepared. Please try again shortly.',
          });
        }
      } catch (registrationError: any) {
        logSafeFailure('issue_registration_otp_ticket', registrationError);
        return res.status(503).json({
          error: 'Registration verification could not be prepared. Please try again shortly.',
        });
      }
    }

    if (purpose !== 'REGISTER') {
      try {
        const { data: issueState, error: otpIssueError, status: otpIssueStatus } = await supabase.rpc('issue_email_otp_ticket', {
          p_ticket_id: verificationTicketId,
          p_email: normalizedEmail,
          p_purpose: purpose,
          p_otp_hash: otpHash,
          p_resend_after: resendAfter,
          p_expires_at: expiresAt,
        });
        if (otpIssueError) {
          logSafeFailure('issue_email_otp_ticket', otpIssueError, otpIssueStatus, 'rpc_result');
          return res.status(503).json({
            error: purpose === 'LOGIN'
              ? 'Authentication verification could not be prepared. Please try again shortly.'
              : 'Verification could not be prepared. Please try again shortly.',
          });
        }
        if (issueState?.issued !== true) {
          if (issueState?.reason === 'cooldown') {
            const seconds = Math.max(1, Number(issueState.cooldown_seconds) || 1);
            return res.status(429).json({
              error: `Please wait ${seconds} seconds before requesting a new code.`,
              cooldownSeconds: seconds,
              resendAvailableAt: issueState.resend_after,
            });
          }
          if (issueState?.reason === 'rate_limited') {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
          }
          return res.status(503).json({
            error: 'Verification could not be prepared. Please try again shortly.',
          });
        }
      } catch (otpErr: any) {
        logSafeFailure('issue_email_otp_ticket', otpErr, undefined, 'rpc_exception');
        return res.status(503).json({
          error: purpose === 'LOGIN'
            ? 'Authentication verification could not be prepared. Please try again shortly.'
            : 'Verification could not be prepared. Please try again shortly.',
        });
      }
    } else if (supabase) {
      // Registration uses its existing registration_otp_attempts transaction;
      // retain the email_otps compatibility row but bind it to the same ticket.
      try {
        const { error: otpInsertErr } = await supabase.from('email_otps').insert({
          ticket_id: verificationTicketId,
          email: normalizedEmail,
          purpose,
          otp_hash: otpHash,
          attempts: 0,
          resend_after: resendAfter,
          expires_at: expiresAt,
          used: false,
        });
        if (otpInsertErr) logSafeFailure('email_otps.insert', otpInsertErr);
      } catch (otpErr: any) {
        logSafeFailure('email_otps.insert', otpErr);
      }
    }

    // Record in server fallback memory store
    // 5. Send OTP via Email Provider
    try {
      await sendVerificationEmail(normalizedEmail, rawOtp);
    } catch (emailErr: any) {
      logSafeFailure('email.dispatch', emailErr);

      // Invalidate the un-sent OTP from memory and database immediately
      if (supabase) {
        try {
          if (purpose !== 'REGISTER') {
            await supabase.rpc('cancel_email_otp_ticket', {
              p_ticket_id: verificationTicketId,
              p_email: normalizedEmail,
              p_purpose: purpose,
            });
          } else {
            await supabase.from('email_otps').update({ used: true })
              .eq('ticket_id', verificationTicketId)
              .eq('used', false);
          }
          if (purpose === 'REGISTER') {
            await supabase.rpc('cancel_registration_otp_ticket', {
              p_ticket_id: verificationTicketId,
              p_email: normalizedEmail,
            });
            await supabase.from('pending_registrations').delete()
              .eq('email', normalizedEmail)
              .eq('otp_ticket_id', verificationTicketId);
          }
          await supabase.from('security_events').insert({
            organization_id: invitationRecord?.organization_id || null,
            event_type: 'OTP_DISPATCH_FAILED',
            severity: 'HIGH',
            description: `Failed to dispatch verification email for ${purpose}`,
            metadata: {
              emailMasked: normEmail.masked,
              purpose,
              errorCode: typeof emailErr?.code === 'string' && /^[A-Z0-9_]+$/i.test(emailErr.code)
                ? emailErr.code
                : 'delivery_failed',
            },
          });
        } catch {
          // Cleanup error handled
        }
      }

      const actionable = formatActionableEmailError(emailErr);
      return res.status(actionable.status).json({
        error: actionable.error,
        code: actionable.code,
      });
    }

    // 6. Audit Logging on Successful Dispatch
    if (supabase) {
      try {
        await supabase.from('security_events').insert({
          organization_id: invitationRecord?.organization_id || null,
          event_type: 'OTP_REQUESTED',
          severity: 'LOW',
          description: `Email OTP requested and dispatched for ${purpose} verification`,
          metadata: { emailMasked: normEmail.masked, purpose },
        });
      } catch {
        // Event log error handled
      }
    }

    // 7. Secure Response (NEVER return OTP!)
    return res.status(200).json({
      success: true,
      maskedEmail: normEmail.masked,
      expiresAt,
      resendAvailableAt: resendAfter,
      cooldownSeconds: OTP_CONFIG.RESEND_COOLDOWN_MS / 1000,
      expiresInSeconds: OTP_CONFIG.EXPIRY_MS / 1000,
      verificationTicket,
      registrationTicket: verificationTicket,
    });
  } catch (err: any) {
    logSafeFailure('handler', err);
    return res.status(503).json({
      error: 'Unable to send verification code. Please try again shortly.',
      code: 'SERVER_ERROR',
    });
  }
}
