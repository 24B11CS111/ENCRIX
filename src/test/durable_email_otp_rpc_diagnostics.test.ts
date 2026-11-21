import { afterEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/_lib/authHandlers/send-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';

function createResponse() {
  let statusCode = 200;
  let body: any;
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(value: any) { body = value; return response; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return response;
}

describe('durable email OTP RPC diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards RPC transport status, confirms named arguments, and logs no sensitive payload', async () => {
    const previousOtpSecret = process.env.OTP_SERVER_SECRET;
    process.env.OTP_SERVER_SECRET = 'synthetic-otp-secret-for-regression-tests';
    const email = 'otp-diagnostic-test@example.test';
    const rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: '',
        name: 'Error',
        message: 'transport failure must not be logged',
        details: 'contains-redacted-test-data',
      },
      status: 0,
    }));
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({ rpc } as any);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = createResponse();

    try {
      await sendOtpHandler({ method: 'POST', body: { email, purpose: 'LOGIN' } }, response);

      expect(response.statusCode).toBe(503);
      expect(rpc).toHaveBeenCalledTimes(1);
      const [rpcName, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(rpcName).toBe('issue_email_otp_ticket');
      expect(Object.keys(args).sort()).toEqual([
        'p_email', 'p_expires_at', 'p_otp_hash', 'p_purpose', 'p_resend_after', 'p_ticket_id',
      ]);
      expect(args.p_ticket_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(args.p_email).toBe(email);
      expect(args.p_purpose).toBe('LOGIN');
      expect(args.p_otp_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof args.p_resend_after).toBe('string');
      expect(typeof args.p_expires_at).toBe('string');
      expect(Date.parse(String(args.p_resend_after))).not.toBeNaN();
      expect(Date.parse(String(args.p_expires_at))).not.toBeNaN();

      const diagnostic = log.mock.calls[0][1] as Record<string, unknown>;
      expect(diagnostic).toMatchObject({
        stage: 'issue_email_otp_ticket',
        kind: 'transport_failure',
        code: 'unknown',
        status: 0,
      });
      const serializedLog = JSON.stringify(log.mock.calls);
      expect(serializedLog).not.toContain(email);
      expect(serializedLog).not.toContain(String(args.p_otp_hash));
      expect(serializedLog).not.toContain('transport failure must not be logged');
      expect(serializedLog).not.toContain('contains-redacted-test-data');
    } finally {
      if (previousOtpSecret === undefined) delete process.env.OTP_SERVER_SECRET;
      else process.env.OTP_SERVER_SECRET = previousOtpSecret;
    }
  });
});
