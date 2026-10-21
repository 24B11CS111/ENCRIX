import { afterEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/auth/send-otp';
import verifyOtpHandler from '../../api/auth/verify-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import * as otpServer from '../../api/_lib/otpServer';

function createQueryBuilder(result: { data?: any; error?: any }) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'gt', 'order', 'limit', 'maybeSingle', 'upsert', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createResponse() {
  let statusCode = 200;
  let body: any = null;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: any) {
      body = value;
      return response;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
  return response;
}

describe('production registration pending-state persistence', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    otpServer.serverOtpStore.clear();
    vi.restoreAllMocks();
  });

  it('does not send a registration OTP or report success when pending registration persistence fails', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'owner@example.test';
    const privateErrorText = `${email} private provider detail`;
    const pendingRegistrationError = { code: '42P01', status: 404, message: privateErrorText };
    const fakeSupabase = {
      from: vi.fn((table: string) => createQueryBuilder(
        table === 'pending_registrations'
          ? { data: null, error: pendingRegistrationError }
          : { data: [], error: null }
      )),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const dispatch = vi.spyOn(otpServer, 'sendVerificationEmail').mockResolvedValue({
      success: true,
      provider: 'RESEND',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = createResponse();

    await sendOtpHandler({
      method: 'POST',
      body: {
        email,
        purpose: 'REGISTER',
        fullName: 'Example Owner',
        companyName: 'Example Organization',
      },
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      error: 'Registration verification could not be prepared. Please try again shortly.',
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(otpServer.serverOtpStore.has(`${email}:REGISTER`)).toBe(false);
    expect(JSON.stringify(log.mock.calls)).toContain('42P01');
    expect(JSON.stringify(log.mock.calls)).not.toContain(email);
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateErrorText);
  });

  it('diagnoses missing database and instance-local state without logging the submitted email', async () => {
    const email = 'owner@example.test';
    const otp = otpServer.generateSecureOtp();
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = createResponse();

    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER' },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
    expect(JSON.stringify(log.mock.calls)).toContain('Registration verification state unavailable');
    expect(JSON.stringify(log.mock.calls)).toContain('memoryFallback');
    expect(JSON.stringify(log.mock.calls)).not.toContain(email);
  });
});
