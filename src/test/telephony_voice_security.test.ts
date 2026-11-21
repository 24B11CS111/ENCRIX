import { afterEach, describe, expect, it, vi } from 'vitest';
import voiceHandler from '../../api/telephony/voice';

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

  it('fails closed when the server cannot resolve a tenant-owned Twilio account', async () => {
    const { req, res } = request('POST');

    await voiceHandler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('+15551234567');
  });

  it('never serves caller-supplied destinations when durable tenant configuration is unavailable', async () => {
    const { req, res } = request('POST', { body: { CallSid: `CA${'a'.repeat(32)}`, To: '+15551234567' } });

    await voiceHandler(req, res);

    expect(res.statusCode).toBe(503);
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
