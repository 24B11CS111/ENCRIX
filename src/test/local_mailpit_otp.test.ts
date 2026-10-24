import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendVerificationEmail } from '../../api/_lib/otpServer';

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  vercel: process.env.VERCEL,
  vercelEnv: process.env.VERCEL_ENV,
  transport: process.env.ENCRIX_LOCAL_OTP_TRANSPORT,
  resend: process.env.RESEND_API_KEY,
  sendgrid: process.env.SENDGRID_API_KEY,
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv('NODE_ENV', originalEnv.nodeEnv);
  restoreEnv('VERCEL', originalEnv.vercel);
  restoreEnv('VERCEL_ENV', originalEnv.vercelEnv);
  restoreEnv('ENCRIX_LOCAL_OTP_TRANSPORT', originalEnv.transport);
  restoreEnv('RESEND_API_KEY', originalEnv.resend);
  restoreEnv('SENDGRID_API_KEY', originalEnv.sendgrid);
  vi.restoreAllMocks();
});

describe('local Mailpit OTP transport', () => {
  it('sends verification mail only to the local Mailpit API when explicitly opted in', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.ENCRIX_LOCAL_OTP_TRANSPORT = 'mailpit';
    process.env.RESEND_API_KEY = 'synthetic-test-key';
    process.env.SENDGRID_API_KEY = 'synthetic-test-key';

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendVerificationEmail('local-test@example.invalid', '246810');
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(request.body));

    expect(url).toBe('http://127.0.0.1:54324/api/v1/send');
    expect(payload.To).toEqual([{ Email: 'local-test@example.invalid' }]);
    expect(payload.Text.includes('246810')).toBe(true);
    expect(result).toEqual({ success: true, provider: 'MAILPIT_LOCAL' });
    expect(JSON.stringify(result).includes('246810')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed outside local development without falling through to Resend', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    process.env.ENCRIX_LOCAL_OTP_TRANSPORT = 'mailpit';
    process.env.RESEND_API_KEY = 'synthetic-test-key';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendVerificationEmail('local-test@example.invalid', '135790')).rejects.toThrow(
      'BLOCKED — LOCAL MAILPIT TRANSPORT IS AVAILABLE ONLY IN LOCAL DEVELOPMENT'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on a Mailpit transport error without exposing provider details', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    process.env.ENCRIX_LOCAL_OTP_TRANSPORT = 'mailpit';
    const fetchMock = vi.fn().mockRejectedValue(new Error('sensitive transport detail'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendVerificationEmail('local-test@example.invalid', '975310')).rejects.toThrow(
      'BLOCKED — LOCAL MAILPIT DELIVERY FAILED'
    );
  });
});
