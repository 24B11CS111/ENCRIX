import crypto from 'crypto';
import { getRequiredServerSecret } from './serverSecret';

export const OTP_CONFIG = {
  LENGTH: 6,
  EXPIRY_MS: 5 * 60 * 1000, // 5 minutes
  RESEND_COOLDOWN_MS: 60 * 1000, // 60 seconds
  MAX_ATTEMPTS: 5,
  MAX_SENDS_PER_WINDOW: 5,
  WINDOW_MS: 15 * 60 * 1000, // 15 minutes
};

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 */
export function generateSecureOtp(): string {
  const code = crypto.randomInt(100000, 1000000);
  return code.toString();
}

/**
 * Creates a salted SHA-256 HMAC hash of the OTP bound to the user's email identifier.
 * Plaintext OTP is NEVER stored in database or logs.
 */
export function hashOtp(identifier: string, otp: string): string {
  return crypto
    .createHmac('sha256', getRequiredServerSecret('OTP_SERVER_SECRET'))
    .update(`${String(identifier || '').trim().toLowerCase()}:${String(otp || '').trim()}`)
    .digest('hex');
}

/**
 * Timing-safe cryptographic comparison of candidate OTP against stored hash.
 */
export function verifyOtpHash(identifier: string, candidateOtp: string, expectedHash: string): boolean {
  if (!candidateOtp || candidateOtp.length !== OTP_CONFIG.LENGTH || !expectedHash) {
    return false;
  }
  const candidateHash = hashOtp(identifier, candidateOtp);
  if (candidateHash.length !== expectedHash.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(expectedHash));
}

/**
 * Checks if a live email provider is configured.
 */
export function isLiveEmailConfigured(): boolean {
  const hasResend = Boolean(
    process.env.RESEND_API_KEY &&
    !process.env.RESEND_API_KEY.includes('placeholder') &&
    !process.env.RESEND_API_KEY.includes('your-') &&
    !process.env.RESEND_API_KEY.includes('test')
  );
  const hasSendGrid = Boolean(
    process.env.SENDGRID_API_KEY &&
    !process.env.SENDGRID_API_KEY.includes('placeholder') &&
    !process.env.SENDGRID_API_KEY.includes('your-') &&
    !process.env.SENDGRID_API_KEY.includes('test')
  );
  return hasResend || hasSendGrid;
}

/**
 * Server-side fallback memory store for local development OTP tracking.
 * Plaintext OTP is NEVER stored. Only cryptographic hashes are retained.
 */
export interface StoredServerOtp {
  identifier: string;
  purpose: string;
  otpHash: string;
  attempts: number;
  resendAfter: string;
  expiresAt: string;
  used: boolean;
  createdAt: string;
  registrationData?: {
    companyName: string;
    ownerName: string;
    phone?: string | null;
    industry?: string;
    companySize?: string;
  };
}

export const serverOtpStore = new Map<string, StoredServerOtp>();

/**
 * Checks if a live SMS provider (Twilio) is configured.
 */
export function isLiveSmsConfigured(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_CALLER_ID;
  if (!sid || !token || !phone) return false;
  if (sid.includes('placeholder') || sid.includes('mock') || sid.includes('test')) return false;
  if (token.includes('placeholder') || token.includes('mock') || token.includes('test')) return false;
  return true;
}

/**
 * Sends an OTP via SMS (Twilio). Kept for telephony/backward-compatibility.
 */
export async function sendOtpSms(phone: string, otp: string): Promise<{ success: boolean; sid?: string; provider?: string }> {
  if (!isLiveSmsConfigured()) {
    const isProd =
      process.env.NODE_ENV === 'production' ||
      process.env.VITE_APP_ENV === 'production' ||
      process.env.VITE_ENABLE_DEMO_SANDBOX === 'false';
    if (isProd) {
      throw new Error('BLOCKED — REAL SMS PROVIDER CREDENTIALS REQUIRED');
    }
    return { success: true, provider: 'DEV_CAPTURED' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_CALLER_ID!;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: phone,
    From: fromPhone,
    Body: `Your ENCRIX verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data.code === 21408 || String(data.message || '').includes('21408')) {
      throw new Error(
        'BLOCKED — SMS PROVIDER / INDIA DELIVERY CONFIGURATION REQUIRED: Twilio Geo Permissions for India (+91) are restricted (error 21408). Please enable India in Twilio Messaging Geo-Permissions.'
      );
    }
    throw new Error(`BLOCKED — SMS PROVIDER ERROR: ${data.message || 'SMS dispatch failed'}`);
  }

  return { success: true, sid: data.sid, provider: 'TWILIO' };
}

/**
 * Generates the clean white + deep navy ENCRIX branded email template.
 */
export function getEncrixEmailContent(otp: string): { subject: string; text: string; html: string } {
  const subject = 'Your ENCRIX verification code';
  const text = `ENCRIX

Verify your email address

Your verification code is:
${otp}

This code expires in 5 minutes.

If you did not request this code, you can safely ignore this email.

Do not share this code with anyone.

Regards,
ENCRIX Security Team`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ENCRIX verification code</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #F6F8FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0B1F3A;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; background-color: #FFFFFF; border: 1px solid #DCE4EE; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(11, 31, 58, 0.04);">
    <!-- Header -->
    <tr>
      <td style="background-color: #0B1F3A; padding: 28px 36px; text-align: left;">
        <span style="font-size: 24px; font-weight: 800; letter-spacing: 1.5px; color: #FFFFFF;">ENCRIX</span>
      </td>
    </tr>
    <!-- Content Body -->
    <tr>
      <td style="padding: 36px 36px 40px;">
        <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: #0B1F3A;">Verify your email address</h2>
        <p style="margin: 0 0 24px; font-size: 15px; line-height: 24px; color: #475569;">Your verification code is:</p>
        
        <!-- Code Card -->
        <div style="background-color: #F6F8FB; border: 1px solid #C7DCF3; border-radius: 10px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-size: 38px; font-weight: 800; letter-spacing: 12px; color: #1E4D8F; font-family: 'Courier New', Courier, monospace;">${otp}</span>
        </div>

        <p style="margin: 0 0 12px; font-size: 14px; line-height: 22px; color: #64748B;">This code expires in 5 minutes.</p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 22px; color: #64748B;">If you did not request this code, you can safely ignore this email.</p>
        <p style="margin: 0 0 32px; font-size: 13px; font-weight: 600; color: #DC2626;">Do not share this code with anyone.</p>

        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 0 0 24px;" />
        <p style="margin: 0; font-size: 13px; line-height: 20px; color: #94A3B8;">
          Regards,<br />
          <strong style="color: #0B1F3A;">ENCRIX Security Team</strong>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Dispatches the verification email through configured email provider.
 * Never leaks the plaintext OTP to client network responses.
 */
export async function sendVerificationEmail(
  email: string,
  otp: string
): Promise<{ success: boolean; provider: string; error?: string }> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Email address is required.');
  }

  const { subject, text, html } = getEncrixEmailContent(otp);

  // Provider 1: Resend
  if (
    process.env.RESEND_API_KEY &&
    !process.env.RESEND_API_KEY.includes('placeholder') &&
    !process.env.RESEND_API_KEY.includes('your-') &&
    !process.env.RESEND_API_KEY.includes('test')
  ) {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'ENCRIX Security <auth@encrix.io>',
          to: [normalized],
          subject,
          text,
          html,
        }),
      });
    } catch (networkErr: any) {
      throw new Error(`BLOCKED — EMAIL OTP PROVIDER ERROR: Network error connecting to Resend: ${networkErr?.message || 'fetch failed'}`);
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const errMsg = errJson?.message || (await res.text().catch(() => '')) || 'Resend dispatch failed.';
      throw new Error(`BLOCKED — EMAIL OTP PROVIDER ERROR: ${errMsg}`);
    }

    return { success: true, provider: 'RESEND' };
  }

  // Provider 2: SendGrid
  if (
    process.env.SENDGRID_API_KEY &&
    !process.env.SENDGRID_API_KEY.includes('placeholder') &&
    !process.env.SENDGRID_API_KEY.includes('your-') &&
    !process.env.SENDGRID_API_KEY.includes('test')
  ) {
    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: normalized }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL || 'auth@encrix.io', name: 'ENCRIX Security' },
          subject,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
        }),
      });
    } catch (networkErr: any) {
      throw new Error(`BLOCKED — EMAIL OTP PROVIDER ERROR: Network error connecting to SendGrid: ${networkErr?.message || 'fetch failed'}`);
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const errMsg = errJson?.message || (await res.text().catch(() => '')) || 'SendGrid dispatch failed.';
      throw new Error(`BLOCKED — EMAIL OTP PROVIDER ERROR: ${errMsg}`);
    }

    return { success: true, provider: 'SENDGRID' };
  }

  // Actionable configuration error: Never simulate a successful live email delivery
  throw new Error(
    'BLOCKED — EMAIL OTP PROVIDER NOT CONFIGURED: Please configure RESEND_API_KEY and RESEND_FROM_EMAIL in your environment to send live verification emails.'
  );
}
