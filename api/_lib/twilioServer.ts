
import crypto from 'crypto';

export interface TwilioServerConfig {
  accountSid: string;
  authToken: string;
  callerId: string;
  voiceWebhookUrl: string;
  statusCallbackUrl: string;
}

export function getTwilioServerConfig(): TwilioServerConfig {
  const appOrigin =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://encrix.vercel.app');

  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    callerId:
      process.env.TWILIO_PHONE_NUMBER ||
      process.env.TWILIO_CALLER_ID ||
      '',
    voiceWebhookUrl:
      process.env.TWILIO_VOICE_WEBHOOK_URL || `${appOrigin}/api/telephony/voice`,
    statusCallbackUrl:
      process.env.TWILIO_STATUS_CALLBACK_URL || `${appOrigin}/api/telephony/webhook`,
  };
}

export function isTwilioServerConfigured(
  config: TwilioServerConfig
): boolean {
  return (
    /^AC[a-f0-9]{32}$/i.test(config.accountSid) &&
    config.authToken.length > 0 &&
    /^\+[1-9]\d{7,14}$/.test(config.callerId) &&
    isValidHttpsUrl(config.voiceWebhookUrl) &&
    isValidHttpsUrl(config.statusCallbackUrl)
  );
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Builds the URL used to verify Twilio webhook signatures.
 * Do not trust incoming Host headers.
 */
export function getTwilioWebhookSignatureUrl(
  configuredUrl: string,
  requestUrl: string
): string | null {
  try {
    const configured = new URL(configuredUrl);

    if (
      configured.protocol !== 'https:' ||
      configured.username ||
      configured.password
    ) {
      return null;
    }

    const requested = new URL(requestUrl, configured.origin);

    if (requested.pathname !== configured.pathname) {
      return null;
    }

    return `${configured.origin}${requested.pathname}${requested.search}`;
  } catch {
    return null;
  }
}

/**
 * Verifies Twilio's X-Twilio-Signature header.
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

    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      expectedBuffer,
      signatureBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Masks phone numbers for telecaller-facing interfaces.
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '***-***-****';

  const clean = phone.trim();

  if (clean.length <= 4) return '****';

  const last4 = clean.slice(-4);
  const prefix = clean.startsWith('+')
    ? clean.slice(0, 3)
    : '';

  return `${prefix ? prefix + ' ' : ''}******${last4}`;
}
