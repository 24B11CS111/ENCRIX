import { authenticateServerRequest, getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import {
  generateSecureOtp,
  hashOtp,
  isLiveSmsConfigured,
  OTP_CONFIG,
  sendOtpSms,
  verifyOtpHash,
} from '../_lib/otpServer.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';

const ENROLLMENT_IDENTIFIER = (profileId: string, phone: string) => `${profileId}:${phone}`;

function firstRow(value: any): any {
  return Array.isArray(value) ? value[0] : value;
}

function responseForOutcome(outcome: string, res: any) {
  switch (outcome) {
    case 'COOLDOWN':
      return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
    case 'RATE_LIMITED':
      return res.status(429).json({ error: 'Too many verification requests. Try again later.' });
    case 'ALREADY_VERIFIED':
      return res.status(200).json({ success: true, verified: true });
    case 'NOT_AUTHORIZED':
      return res.status(403).json({ error: 'Caller enrollment is not available for this account.' });
    default:
      return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { user, profile, error: authError } = await authenticateServerRequest(req);
  if (authError || !user || !profile) {
    return res.status(401).json({ error: 'Authentication is required.' });
  }
  if (profile.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'An active account is required.' });
  }
  if (profile.role !== 'TELECALLER') {
    return res.status(403).json({ error: 'Caller enrollment is available only to telecallers.' });
  }
  if (!isRealSupabaseServerConfigured()) {
    return res.status(503).json({ error: 'Phone verification storage is not configured.' });
  }

  const supabase = getSupabaseServerClient();
  const action = req.body?.action;

  if (action === 'send') {
    const inputPhone = req.body?.phone;
    if (typeof inputPhone !== 'string') {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    const normalized = normalizePhoneNumber(inputPhone);
    if (!normalized.isValid || !/^\+[1-9][0-9]{7,14}$/.test(normalized.normalized)) {
      return res.status(400).json({ error: 'Enter a valid phone number.' });
    }
    if (!isLiveSmsConfigured()) {
      return res.status(503).json({ error: 'Phone verification delivery is not configured.' });
    }

    try {
      const code = generateSecureOtp();
      const otpHash = hashOtp(ENROLLMENT_IDENTIFIER(profile.id, normalized.normalized), code);
      const { data, error } = await supabase.rpc('begin_caller_phone_enrollment', {
        p_profile_id: profile.id,
        p_organization_id: profile.organization_id,
        p_phone_number: normalized.normalized,
        p_otp_hash: otpHash,
      });
      if (error) return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });

      const result = firstRow(data);
      if (!result || result.outcome !== 'CREATED') {
        return responseForOutcome(result?.outcome || 'UNAVAILABLE', res);
      }

      try {
        await sendOtpSms(normalized.normalized, code);
      } catch {
        await supabase
          .from('caller_phone_enrollments')
          .update({ consumed_at: new Date().toISOString(), phone_number: null })
          .eq('id', result.enrollment_id)
          .eq('profile_id', profile.id);
        return res.status(503).json({ error: 'Verification code could not be delivered. Try again later.' });
      }

      return res.status(200).json({
        success: true,
        expiresInSeconds: OTP_CONFIG.EXPIRY_MS / 1000,
        resendAfterSeconds: OTP_CONFIG.RESEND_COOLDOWN_MS / 1000,
      });
    } catch {
      return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
    }
  }

  if (action === 'verify') {
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
    }

    try {
      const { data: enrollment, error } = await supabase
        .from('caller_phone_enrollments')
        .select('id, phone_number, otp_hash')
        .eq('profile_id', profile.id)
        .is('consumed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
      if (!enrollment?.id || !enrollment.phone_number || !enrollment.otp_hash) {
        return res.status(400).json({ error: 'No active verification code is available.' });
      }

      const matches = verifyOtpHash(
        ENROLLMENT_IDENTIFIER(profile.id, enrollment.phone_number),
        code,
        enrollment.otp_hash,
      );
      const { data: outcome, error: completionError } = await supabase.rpc('complete_caller_phone_enrollment', {
        p_enrollment_id: enrollment.id,
        p_profile_id: profile.id,
        p_code_matches: matches,
      });
      if (completionError) {
        return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
      }

      switch (outcome) {
        case 'VERIFIED':
          return res.status(200).json({ success: true, verified: true });
        case 'MAX_ATTEMPTS':
          return res.status(429).json({ error: 'Too many attempts. Request a new verification code.' });
        case 'INVALID':
          return res.status(400).json({ error: 'Invalid verification code.' });
        case 'NOT_AUTHORIZED':
          return res.status(403).json({ error: 'Caller enrollment is not available for this account.' });
        case 'EXPIRED':
        case 'REPLAYED':
        case 'NOT_FOUND':
          return res.status(400).json({ error: 'The verification code is expired or unavailable.' });
        default:
          return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
      }
    } catch {
      return res.status(503).json({ error: 'Phone verification is temporarily unavailable.' });
    }
  }

  return res.status(400).json({ error: 'Unsupported phone enrollment action.' });
}
