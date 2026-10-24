import { getSupabaseServerClient } from '../_lib/supabaseServer.js';
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

    const supabase = getSupabaseServerClient();
    const now = new Date();

    // 1. Check invitation validity if purpose is INVITATION
    let invitationRecord: any = null;
    if (purpose === 'INVITATION') {
      if (!inviteToken) {
        return res.status(400).json({ error: 'Invitation token is required' });
      }

      try {
        const { data: inv, error: invErr } = await supabase
          .from('organization_invitations')
          .select('*')
          .eq('token', inviteToken)
          .single();

        if (invErr || !inv) {
          return res.status(404).json({ error: 'Invalid invitation link.' });
        }

        if (inv.status !== 'PENDING') {
          return res.status(400).json({ error: `This invitation is already ${inv.status.toLowerCase()}.` });
        }

        if (new Date(inv.expires_at) < now) {
          return res.status(400).json({ error: 'This invitation has expired. Request a new invitation.' });
        }

        if (inv.email) {
          const invEmailNorm = normalizeEmail(inv.email);
          if (invEmailNorm.normalized !== normalizedEmail) {
            return res.status(400).json({ error: 'Email address does not match this invitation.' });
          }
        }

        invitationRecord = inv;
      } catch (invLookupErr: any) {
        logSafeFailure('organization_invitations.select', invLookupErr);
      }
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

      return res.status(503).json({ error: 'Unable to send verification code. Please try again shortly.' });
    }

    // 6. Audit Logging on Successful Dispatch
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
    });
  }
}
