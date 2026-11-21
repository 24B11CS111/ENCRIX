import type { OrganizationTwilioCredentials } from './twilioCredentials.js';

export interface TwilioCreateCallOptions {
  to: string;
  from: string;
  url: string;
  statusCallback: string;
  statusCallbackEvents?: string[];
  timeoutSeconds?: number;
}

export interface TwilioCreateCallResult {
  ok: boolean;
  status: number;
  callSid?: string;
  providerStatus?: string;
  retryable?: boolean;
}

export async function sendOrganizationTwilioSms(
  credentials: OrganizationTwilioCredentials,
  to: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!/^\+[1-9]\d{7,14}$/.test(to) || !message || message.length > 1600) return false;
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: credentials.phoneNumber, Body: message }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null) as any;
    return typeof data?.sid === 'string' && /^SM[0-9a-f]{32}$/i.test(data.sid);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function validateOrganizationTwilioAccount(
  credentials: OrganizationTwilioCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<'VALID' | 'INVALID' | 'UNAVAILABLE'> {
  const authorization = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`;
  const accountUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}.json`;
  const numbersUrl = new URL(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/IncomingPhoneNumbers.json`);
  numbersUrl.searchParams.set('PhoneNumber', credentials.phoneNumber);
  numbersUrl.searchParams.set('PageSize', '20');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const accountResponse = await fetchImpl(accountUrl, { headers: { Authorization: authorization }, signal: controller.signal });
    if (accountResponse.status === 401 || accountResponse.status === 403 || accountResponse.status === 404) return 'INVALID';
    if (!accountResponse.ok) return 'UNAVAILABLE';
    const account = await accountResponse.json().catch(() => null) as any;
    if (account?.sid !== credentials.accountSid || account?.status !== 'active') return 'INVALID';

    const numberResponse = await fetchImpl(numbersUrl.toString(), { headers: { Authorization: authorization }, signal: controller.signal });
    if (numberResponse.status === 401 || numberResponse.status === 403) return 'INVALID';
    if (!numberResponse.ok) return 'UNAVAILABLE';
    const numbers = await numberResponse.json().catch(() => null) as any;
    const ownedVoiceNumber = Array.isArray(numbers?.incoming_phone_numbers)
      && numbers.incoming_phone_numbers.some((number: any) =>
        number?.phone_number === credentials.phoneNumber && number?.capabilities?.voice === true);
    return ownedVoiceNumber ? 'VALID' : 'INVALID';
  } catch {
    return 'UNAVAILABLE';
  } finally {
    clearTimeout(timer);
  }
}

function validWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function createOrganizationTwilioCall(
  credentials: OrganizationTwilioCredentials,
  options: TwilioCreateCallOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioCreateCallResult> {
  if (!validWebhookUrl(options.url) || !validWebhookUrl(options.statusCallback)) {
    throw new Error('twilio_public_webhook_configuration_invalid');
  }

  const timeoutSeconds = Math.min(60, Math.max(10, options.timeoutSeconds || 30));
  const body = new URLSearchParams({
    To: options.to,
    From: options.from,
    Url: options.url,
    Method: 'POST',
    StatusCallback: options.statusCallback,
    StatusCallbackMethod: 'POST',
    Timeout: String(timeoutSeconds),
  });
  for (const event of options.statusCallbackEvents || ['initiated', 'ringing', 'answered', 'completed']) {
    body.append('StatusCallbackEvent', event);
  }
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Calls.json`;
  const authorization = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      // Never pass the provider body or request credentials into API responses/logs.
      return { ok: false, status: response.status, retryable: response.status >= 500 || response.status === 429 };
    }
    const data = await response.json().catch(() => null) as any;
    if (typeof data?.sid !== 'string' || !/^CA[0-9a-f]{32}$/i.test(data.sid)) {
      return { ok: false, status: 502, retryable: true };
    }
    return {
      ok: true,
      status: response.status,
      callSid: data.sid,
      providerStatus: typeof data.status === 'string' ? data.status : undefined,
    };
  } catch {
    // A timeout/network error is ambiguous: the provider may have accepted the
    // call. The caller must mark recovery_required and must not retry blindly.
    return { ok: false, status: 0, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function endOrganizationTwilioCall(
  credentials: OrganizationTwilioCredentials,
  callSid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'ENDED' | 'ALREADY_ENDED' | 'UNAVAILABLE'> {
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return 'UNAVAILABLE';
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Calls/${encodeURIComponent(callSid)}.json`;
  const authorization = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const currentResponse = await fetchImpl(endpoint, {
      headers: { Authorization: authorization },
      signal: controller.signal,
    });
    if (!currentResponse.ok) return 'UNAVAILABLE';
    const current = await currentResponse.json().catch(() => null) as any;
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(String(current?.status).toLowerCase())) {
      return 'ALREADY_ENDED';
    }
    const endResponse = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Status: 'completed' }),
      signal: controller.signal,
    });
    return endResponse.ok ? 'ENDED' : 'UNAVAILABLE';
  } catch {
    return 'UNAVAILABLE';
  } finally {
    clearTimeout(timer);
  }
}

export function getPublicTelephonyWebhookBase(): string {
  const candidate = process.env.TWILIO_PUBLIC_WEBHOOK_BASE_URL
    || process.env.APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '');
  if (!candidate) throw new Error('twilio_public_webhook_base_url_unconfigured');
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('twilio_public_webhook_base_url_invalid');
  }
  return parsed.origin;
}

export function telephonyWebhookUrl(path: 'voice' | 'webhook', params: Record<string, string>): string {
  const url = new URL(`/api/telephony/${path}`, getPublicTelephonyWebhookBase());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function isTwilioCallingEnabled(): boolean {
  return process.env.TWILIO_CALLING_ENABLED === 'true';
}
