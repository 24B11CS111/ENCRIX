import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import { getServerInvitation } from '../_lib/invitationServer.js';
import {
  generateSecureOtp,
  hashOtp,
  createVerificationTicket,
  sendVerificationEmail,
  OTP_CONFIG,
  serverOtpStore,
} from '../_lib/otpServer.js';
import { normalizeEmail } from '../../src/lib/emailNormalization.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';

export function sanitizeErrorMessage(msg?: string): string {
  if (!msg || typeof msg !== 'string') return '';
  return msg
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]')
    .replace(/\b(inv|sess)_[a-zA-Z0-9_\-]+/gi, '[REDACTED_TOKEN]')
    .replace(/\b(re|SG)_[a-zA-Z0-9_\-]+/gi, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9_\.\-]+/gi, 'Bearer [REDACTED]')
    .replace(/BLOCKED\s*—\s*EMAIL\s*OTP\s*PROVIDER\s*(ERROR|NOT CONFIGURED):\s*/gi, '')
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

function logSafeFailure(stage: string, error: any) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/i.test(error.code)
    ? error.code
    : 'unknown';
  const status = Number.isInteger(error?.status) ? error.status : undefined;
  console.error('[send-otp] Operation failed', { stage, code, status });
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

      const cleanToken = inviteToken.trim();
      let inv: any = null;

      if (supabase) {
        try {
          const { data, error: invErr } = await supabase
            .from('organization_invitations')
            .select('*')
            .eq('token', cleanToken)
            .maybeSingle();

          if (!invErr && data) {
            inv = data;
          }
        } catch (invLookupErr: any) {
          logSafeFailure('organization_invitations.select', invLookupErr);
        }
      }

      if (!inv) {
        inv = getServerInvitation(cleanToken);
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

    // 2. Rate limiting & Resend Cooldown Check
    // 2a. Check in-memory store for active cooldown
    const memRecord = serverOtpStore.get(`${normalizedEmail}:${purpose}`);
    if (memRecord && new Date(memRecord.resendAfter) > now) {
      const remainingCooldown = Math.ceil(
        (new Date(memRecord.resendAfter).getTime() - now.getTime()) / 1000
      );
      return res.status(429).json({
        error: `Please wait ${remainingCooldown} seconds before requesting a new code.`,
        cooldownSeconds: remainingCooldown,
        resendAvailableAt: memRecord.resendAfter,
        expiresAt: memRecord.expiresAt,
      });
    }

    // 2b. Check database for active cooldown and window limit
    if (supabase) {
      try {
        const { data: recentOtps } = await supabase
          .from('email_otps')
          .select('created_at, resend_after, expires_at')
          .eq('email', normalizedEmail)
          .eq('purpose', purpose)
          .gt('created_at', new Date(now.getTime() - OTP_CONFIG.WINDOW_MS).toISOString())
          .order('created_at', { ascending: false });

        if (recentOtps && recentOtps.length > 0) {
          const latest = recentOtps[0];
          if (new Date(latest.resend_after) > now) {
            const remainingCooldown = Math.ceil(
              (new Date(latest.resend_after).getTime() - now.getTime()) / 1000
            );
            return res.status(429).json({
              error: `Please wait ${remainingCooldown} seconds before requesting a new code.`,
              cooldownSeconds: remainingCooldown,
              resendAvailableAt: latest.resend_after,
              expiresAt: latest.expires_at,
            });
          }

          if (recentOtps.length >= OTP_CONFIG.MAX_SENDS_PER_WINDOW) {
            try {
              await supabase.from('security_events').insert({
                organization_id: invitationRecord?.organization_id || null,
                event_type: 'OTP_RATE_LIMITED',
                severity: 'HIGH',
                description: `Strict rate limit triggered for email: ${normEmail.masked}`,
                metadata: { emailMasked: normEmail.masked, purpose },
              });
            } catch {
              // Event log error handled
            }

            return res.status(429).json({
              error: 'Too many requests. Please try again later.',
            });
          }
        }
      } catch (rateLimitErr: any) {
        // Supabase offline/mock fallback; in-memory store enforces cooldown
      }
    }

    // 3. Generate Cryptographic 6-digit OTP
    const rawOtp = generateSecureOtp();
    const otpHash = hashOtp(normalizedEmail, rawOtp);
    const expiresAt = new Date(now.getTime() + OTP_CONFIG.EXPIRY_MS).toISOString();
    const resendAfter = new Date(now.getTime() + OTP_CONFIG.RESEND_COOLDOWN_MS).toISOString();

    // Generate signed stateless verification ticket for multi-instance serverless resilience
    const verificationTicket = createVerificationTicket({
      email: normalizedEmail,
      purpose,
      otpHash,
      expiresAt,
      companyName,
      ownerName: fullName,
      phone: optionalPhone,
      industry: req.body?.industry,
      companySize: req.body?.companySize,
      inviteToken,
    });

    // 4. Store OTP record in database & memory store
    if (purpose === 'REGISTER') {
      if (!companyName || !fullName) {
        return res.status(400).json({ error: 'Full name and business name are required for registration.' });
      }

      if (supabase) {
        try {
          const { error: registrationError } = await supabase.from('pending_registrations').upsert(
            {
              email: normalizedEmail,
              phone_number: optionalPhone,
              company_name: companyName,
              owner_name: fullName,
              otp_hash: otpHash,
              attempts: 0,
              resend_after: resendAfter,
              expires_at: expiresAt,
              created_at: now.toISOString(),
            },
            { onConflict: 'email' }
          );
          if (registrationError) {
            logSafeFailure('pending_registrations.upsert', registrationError);
            if (process.env.NODE_ENV === 'production') {
              return res.status(503).json({
                error: 'Registration verification could not be prepared. Please try again shortly.',
              });
            }
          }
        } catch (registrationError: any) {
          logSafeFailure('pending_registrations.upsert', registrationError);
          if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({
              error: 'Registration verification could not be prepared. Please try again shortly.',
            });
          }
        }
      }
    }

    if (supabase) {
      try {
        const { error: otpInsertErr } = await supabase.from('email_otps').insert({
          email: normalizedEmail,
          purpose,
          otp_hash: otpHash,
          attempts: 0,
          resend_after: resendAfter,
          expires_at: expiresAt,
          used: false,
        });
        if (otpInsertErr) {
          logSafeFailure('email_otps.insert', otpInsertErr);
          if (process.env.NODE_ENV === 'production' && purpose === 'LOGIN') {
            return res.status(503).json({
              error: 'Authentication verification could not be prepared. Please try again shortly.',
            });
          }
        }
      } catch (otpErr: any) {
        logSafeFailure('email_otps.insert', otpErr);
        if (process.env.NODE_ENV === 'production' && purpose === 'LOGIN') {
          return res.status(503).json({
            error: 'Authentication verification could not be prepared. Please try again shortly.',
          });
        }
      }
    }

    // Record in server fallback memory store
    serverOtpStore.set(`${normalizedEmail}:${purpose}`, {
      identifier: normalizedEmail,
      purpose,
      otpHash,
      attempts: 0,
      resendAfter,
      expiresAt,
      used: false,
      createdAt: now.toISOString(),
      registrationData:
        purpose === 'REGISTER'
          ? {
              companyName,
              ownerName: fullName,
              phone: optionalPhone,
            }
          : undefined,
    });

    // 5. Send OTP via Email Provider
    try {
      await sendVerificationEmail(normalizedEmail, rawOtp);
    } catch (emailErr: any) {
      logSafeFailure('email.dispatch', emailErr);

      // Invalidate the un-sent OTP from memory and database immediately
      serverOtpStore.delete(`${normalizedEmail}:${purpose}`);
      if (supabase) {
        try {
          await supabase.from('email_otps').delete().eq('otp_hash', otpHash);
          if (purpose === 'REGISTER') {
            await supabase.from('pending_registrations').delete().eq('email', normalizedEmail);
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
