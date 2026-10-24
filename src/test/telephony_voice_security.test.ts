import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTwilioWebhookSignatureUrl } from '../../api/_lib/twilioServer.js';
import voiceHandler from '../../api/telephony/voice';

const authToken = 'synthetic-twilio-auth-token-for-test';
const callbackUrl = 'https://calls.example.test/api/telephony/voice';

function signatureFor(url: string, params: Record<string, string>) {
  const signed = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  return createHmac('sha1', authToken).update(signed).digest('base64');
}

function request(method: string, options: { url?: string; body?: Record<string, string>; signature?: string } = {}) {
  const req = {
    method,
    url: options.url || '/api/telephony/voice',
    query: { destination: '+15551234567', callerId: '+15557654321' },
    headers: { 'x-twilio-signature': options.signature || '' },
    body: options.body || {},
  };
  const res: any = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    send(value: string) { this.body = value; return this; },
  };
  return { req, res };
}

describe('Twilio voice callback boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unsigned requests, including caller-supplied destinations', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', authToken);
    vi.stubEnv('TWILIO_VOICE_WEBHOOK_URL', callbackUrl);
    const { req, res } = request('POST');

    await voiceHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('+15551234567');
  });

  it('validates Twilio signatures but never dials a request-supplied destination', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', authToken);
    vi.stubEnv('TWILIO_VOICE_WEBHOOK_URL', callbackUrl);
    const params = { CallSid: `CA${'a'.repeat(32)}` };
    const url = getTwilioWebhookSignatureUrl(callbackUrl, '/api/telephony/voice')!;
    const { req, res } = request('POST', { body: params, signature: signatureFor(url, params) });

    await voiceHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/xml');
    expect(res.body).toContain('<Hangup />');
    expect(res.body).not.toContain('<Dial');
    expect(res.body).not.toContain('+15551234567');
    expect(res.body).not.toContain('+15557654321');
  });

  it('does not serve TwiML to non-POST requests', async () => {
    const { req, res } = request('GET');
    await voiceHandler(req, res);
    expect(res.statusCode).toBe(405);
  });
});
