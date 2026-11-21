import { describe, expect, it, vi } from 'vitest';
import {
  createOrganizationTwilioCall,
  endOrganizationTwilioCall,
  sendOrganizationTwilioSms,
  validateOrganizationTwilioAccount,
} from '../../api/_lib/twilioRest';

const credentials = {
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'b'.repeat(32),
  phoneNumber: '+14155552671',
};
const callSid = `CA${'c'.repeat(32)}`;

describe('organization-scoped Twilio REST integration', () => {
  it('creates an outbound leg only through the customer account and returns no customer/provider secrets', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ sid: callSid, status: 'queued' }) })) as any;
    const result = await createOrganizationTwilioCall(credentials, {
      to: '+14155550111', from: credentials.phoneNumber,
      url: 'https://encrix.example/api/telephony/voice?bridge_id=call&leg=caller',
      statusCallback: 'https://encrix.example/api/telephony/webhook?bridge_id=call&leg=caller',
    }, fetchMock);

    expect(result).toEqual({ ok: true, status: 201, callSid, providerStatus: 'queued' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(credentials.accountSid);
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`);
    const body = new URLSearchParams(options.body);
    expect(body.get('To')).toBe('+14155550111');
    expect(body.get('From')).toBe(credentials.phoneNumber);
    expect(body.get('Url')).toContain('bridge_id=call');
    expect(body.getAll('StatusCallbackEvent')).toEqual(['initiated', 'ringing', 'answered', 'completed']);
    expect(JSON.stringify(result)).not.toContain(credentials.authToken);
    expect(JSON.stringify(result)).not.toContain('+14155550111');
  });

  it('treats provider server errors and network timeouts as ambiguous, without echoing provider text', async () => {
    const providerError = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: credentials.authToken }) })) as any;
    const response = await createOrganizationTwilioCall(credentials, {
      to: '+14155550111', from: credentials.phoneNumber,
      url: 'https://encrix.example/api/telephony/voice',
      statusCallback: 'https://encrix.example/api/telephony/webhook',
    }, providerError);
    expect(response).toEqual({ ok: false, status: 503, retryable: true });
    expect(JSON.stringify(response)).not.toContain(credentials.authToken);

    const timeout = await createOrganizationTwilioCall(credentials, {
      to: '+14155550111', from: credentials.phoneNumber,
      url: 'https://encrix.example/api/telephony/voice',
      statusCallback: 'https://encrix.example/api/telephony/webhook',
    }, vi.fn(async () => { throw new Error('network'); }) as any);
    expect(timeout).toEqual({ ok: false, status: 0, retryable: true });
  });

  it('rejects non-HTTPS webhook URLs before making a provider request', async () => {
    const fetchMock = vi.fn();
    await expect(createOrganizationTwilioCall(credentials, {
      to: '+14155550111', from: credentials.phoneNumber,
      url: 'http://attacker.example/voice',
      statusCallback: 'https://encrix.example/webhook',
    }, fetchMock as any)).rejects.toThrow('twilio_public_webhook_configuration_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates account credentials and voice number ownership through Twilio read APIs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sid: credentials.accountSid, status: 'active' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ incoming_phone_numbers: [{ phone_number: credentials.phoneNumber, capabilities: { voice: true } }] }) });
    expect(await validateOrganizationTwilioAccount(credentials, fetchMock as any)).toBe('VALID');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent(credentials.phoneNumber));

    const unowned = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sid: credentials.accountSid, status: 'active' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ incoming_phone_numbers: [] }) });
    expect(await validateOrganizationTwilioAccount(credentials, unowned as any)).toBe('INVALID');
  });

  it('sends caller verification SMS through the owning organization account only', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ sid: `SM${'d'.repeat(32)}` }) })) as any;
    expect(await sendOrganizationTwilioSms(credentials, '+14155550111', 'Synthetic one-time code', fetchMock)).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(credentials.accountSid);
    expect(new URLSearchParams(options.body).get('From')).toBe(credentials.phoneNumber);
    expect(new URLSearchParams(options.body).get('Body')).toBe('Synthetic one-time code');
    expect(await sendOrganizationTwilioSms(credentials, '555', 'bad', fetchMock)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends both requested account calls only with the owning credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'in-progress' }) })
      .mockResolvedValueOnce({ ok: true });
    expect(await endOrganizationTwilioCall(credentials, callSid, fetchMock as any)).toBe('ENDED');
    expect(fetchMock.mock.calls[0][0]).toContain(credentials.accountSid);
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(await endOrganizationTwilioCall(credentials, 'invalid', fetchMock as any)).toBe('UNAVAILABLE');
  });
});
