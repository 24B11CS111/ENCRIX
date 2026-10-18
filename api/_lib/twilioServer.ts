import crypto from 'crypto';

export interface TwilioServerConfig {
  accountSid: string;
  authToken: string;
  callerId: string;
  voiceWebhookUrl: string;
  statusCallbackUrl: string;
}

export function getTwilioServerConfig(): TwilioServerConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_prod_placeholder_sid_leadvault',
    authToken: process.env.TWILIO_AUTH_TOKEN || 'prod_auth_token_placeholder_leadvault',
    callerId: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_CALLER_ID || '+15550005678',
    voiceWebhookUrl:
      process.env.TWILIO_VOICE_WEBHOOK_URL ||
      'https://app.leadvault.io/api/telephony/voice',
    statusCallbackUrl:
      process.env.TWILIO_STATUS_CALLBACK_URL ||
      'https://app.leadvault.io/api/telephony/webhook',
  };
}

/**
 * Cryptographically verifies the Twilio X-Twilio-Signature HMAC-SHA1 header.
 * Rejects forged or tampered webhook callbacks.
 */
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature || !url) return false;

  try {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    const expected = crypto
      .createHmac('sha1', authToken)
      .update(data, 'utf-8')
      .digest('base64');

    if (expected.length !== signature.length) return false;

    let match = 0;
    for (let i = 0; i < expected.length; i++) {
      match |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return match === 0;
  } catch {
    return false;
  }
}

/**
 * Masks raw phone numbers for telecaller client safety.
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '***-***-****';
  const clean = phone.trim();
  if (clean.length <= 4) return '****';
  const last4 = clean.slice(-4);
  const prefix = clean.startsWith('+') ? clean.slice(0, 3) : '';
  return `${prefix ? prefix + ' ' : ''}******${last4}`;
}
