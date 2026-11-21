import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFollowUpReminderEmail, sendInvitationEmail } from '../../api/_lib/emailDelivery';

describe('Resend transactional email delivery', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFrom;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends an escaped invitation URL through Resend and reports the provider message ID', async () => {
    process.env.RESEND_API_KEY = 'synthetic_resend_key_for_unit_spec_123';
    process.env.RESEND_FROM_EMAIL = 'ENCRIX <staging@example.test>';
    const fetchMock = vi.fn(async (_url: any, init: any) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'mock-email-id' }),
      body: JSON.parse(init.body),
    } as any));
    globalThis.fetch = fetchMock as any;
    const result = await sendInvitationEmail({
      recipient: 'caller@example.test',
      recipientName: '<Caller>',
      organizationName: 'Org & Co',
      inviteUrl: 'https://staging.example.test/accept?token=inv_synthetic_token',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result.id).toBe('mock-email-id');
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.to).toEqual(['caller@example.test']);
    expect(payload.html).toContain('&lt;Caller&gt;');
    expect(payload.html).toContain('Org &amp; Co');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });

  it('does not claim delivery when Resend rejects an invitation', async () => {
    process.env.RESEND_API_KEY = 'synthetic_resend_key_for_unit_spec_123';
    process.env.RESEND_FROM_EMAIL = 'staging@example.test';
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: 'private recipient details' }) } as any)) as any;
    await expect(sendInvitationEmail({
      recipient: 'caller@example.test', recipientName: 'Caller', organizationName: 'Org',
      inviteUrl: 'https://staging.example.test/accept?token=inv_secretish',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).rejects.toMatchObject({ code: 'EMAIL_PROVIDER_REJECTED' });
  });

  it('uses an idempotency key for reminder delivery', async () => {
    process.env.RESEND_API_KEY = 'synthetic_resend_key_for_unit_spec_123';
    process.env.RESEND_FROM_EMAIL = 'staging@example.test';
    const fetchMock = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'reminder-id' }),
      requestHeaders: options?.headers,
    } as any));
    globalThis.fetch = fetchMock as any;
    await sendFollowUpReminderEmail({
      recipient: 'verified@example.test', subject: 'Reminder', text: 'Test', html: '<p>Test</p>', idempotencyKey: 'delivery-uuid',
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBe('encrix-reminder-delivery-uuid');
  });
});
