import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/auth/send-otp';
import verifyOtpHandler from '../../api/auth/verify-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import * as otpServer from '../../api/_lib/otpServer';
import { verifySignedSessionToken } from '../../api/_lib/sessionServer';
import { authService } from '../services/auth/authService';

function createQueryBuilder(result: { data?: any; error?: any }) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'gt', 'order', 'limit', 'maybeSingle', 'single', 'upsert', 'insert', 'update', 'delete']) {
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

describe('Phase 25 Regression: Login OTP Verification Across Serverless Instances', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    otpServer.serverOtpStore.clear();
    otpServer.consumedTickets.clear();
    sessionStorage.clear();
    localStorage.clear();
    authService.clearAllStoredTickets();
    vi.restoreAllMocks();
  });

  it('reproduces production error "No active verification code found. Request a new code." when serverless instances are disjoint and verificationTicket is missing', async () => {
    const email = 'user-disjoint@encrix.test';
    const otp = '789123';
    const otpHash = otpServer.hashOtp(email, otp);

    // Container A receives send-otp and stores OTP in its local RAM
    otpServer.serverOtpStore.set(`${email}:LOGIN`, {
      identifier: email,
      purpose: 'LOGIN',
      otpHash,
      attempts: 0,
      resendAfter: new Date(Date.now() + 60000).toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      used: false,
      createdAt: new Date().toISOString(),
    });

    // Simulate Container B handling verify-otp:
    // 1. RAM in Container B is empty (cold start / separate lambda instance)
    otpServer.serverOtpStore.clear();

    // 2. Remote database returns empty / table missing
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'email_otps') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    // When client (LoginPage) omits verificationTicket:
    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp,
        purpose: 'LOGIN',
        // verificationTicket omitted
      },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No active verification code found. Request a new code.');
  });

  it('successfully verifies LOGIN OTP across disjoint serverless instances when verificationTicket is forwarded', async () => {
    const email = 'verified-user@encrix.test';
    const otp = '654321';
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const otpHash = otpServer.hashOtp(email, otp);

    // Signed ticket generated during send-otp
    const verificationTicket = otpServer.createVerificationTicket({
      email,
      purpose: 'LOGIN',
      otpHash,
      expiresAt,
    });

    // Container B handles verify-otp with empty local memory (fresh lambda instance)
    otpServer.serverOtpStore.clear();

    const mockProfile = {
      id: 'prof-verified-user',
      user_id: 'user-auth-uuid-1',
      organization_id: 'org-verified-1',
      full_name: 'Verified User',
      email,
      role: 'OWNER',
      status: 'ACTIVE',
    };

    const mockOrg = {
      id: 'org-verified-1',
      name: 'Verified Org',
      owner_id: 'user-auth-uuid-1',
    };

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'email_otps') {
          return createQueryBuilder({ data: [], error: null });
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: mockProfile, error: null })),
              })),
            })),
          };
        }
        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: mockOrg, error: null })),
              })),
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp,
        purpose: 'LOGIN',
        verificationTicket,
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.profile.id).toBe('prof-verified-user');
    expect(response.body.sessionToken).toBeDefined();

    const verifiedSession = verifySignedSessionToken(response.body.sessionToken);
    expect(verifiedSession).not.toBeNull();
    expect(verifiedSession?.profileId).toBe('prof-verified-user');
  });

  it('strictly rejects replay of consumed LOGIN verification ticket', async () => {
    const email = 'replay-login@encrix.test';
    const otp = '112233';
    const expiresAt = new Date(Date.now() + 300000).toISOString();
    const otpHash = otpServer.hashOtp(email, otp);

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'LOGIN',
      otpHash,
      expiresAt,
    });

    const mockProfile = {
      id: 'prof-replay-login',
      organization_id: 'org-replay-1',
      full_name: 'Replay User',
      email,
      role: 'TELECALLER',
      status: 'ACTIVE',
    };

    const mockOrg = {
      id: 'org-replay-1',
      name: 'Replay Org',
      owner_id: 'owner-uuid-1',
    };

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'email_otps') return createQueryBuilder({ data: [], error: null });
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: mockProfile, error: null })),
              })),
            })),
          };
        }
        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: mockOrg, error: null })),
              })),
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    // First use: Valid
    const res1 = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'LOGIN', verificationTicket: ticket },
    }, res1);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);

    // Second use: Replay rejected because ticketId was marked consumed
    const res2 = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'LOGIN', verificationTicket: ticket },
    }, res2);

    expect(res2.statusCode).toBe(400);
    expect(res2.body.error).toBe('No active verification code found. Request a new code.');
  });

  describe('authService SessionStorage Ticket Persistence & Lifecycle', () => {
    beforeEach(() => {
      process.env.TEST_LIVE_API = 'true';
    });

    afterEach(() => {
      delete process.env.TEST_LIVE_API;
    });

    it('persists ticket to sessionStorage during requestOtp and reads it during verifyOtp even if in-memory Map is cleared', async () => {
      const email = 'session-persistence@encrix.test';
      const fakeTicket = 'payload.fake-sig-123';

      // Mock fetch for /api/auth/send-otp
      global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
        if (String(url).includes('/api/auth/send-otp')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              maskedEmail: 's***@encrix.test',
              expiresAt: new Date(Date.now() + 300000).toISOString(),
              verificationTicket: fakeTicket,
            }),
          };
        }
        if (String(url).includes('/api/auth/verify-otp')) {
          const body = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              receivedTicket: body.verificationTicket,
              profile: { id: 'prof-test-session', role: 'OWNER' },
              organization: { id: 'org-test' },
              sessionToken: 'session-jwt-abc',
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      // 1. Request OTP
      const sendRes = await authService.requestOtp({ email, purpose: 'LOGIN' });
      expect(sendRes.success).toBe(true);
      expect(sendRes.verificationTicket).toBe(fakeTicket);

      // Verify ticket persisted in sessionStorage
      const stored = sessionStorage.getItem(`encrix_ticket_${email}:LOGIN`);
      expect(stored).toBe(fakeTicket);

      // 2. Clear in-memory Map to simulate component remount / navigation / service reload
      (authService as any).tickets.clear();
      expect((authService as any).tickets.get(`${email}:LOGIN`)).toBeUndefined();

      // 3. Verify OTP without explicitly providing verificationTicket in params
      const verifyRes = await authService.verifyOtp({
        email,
        otp: '123456',
        purpose: 'LOGIN',
      });

      expect(verifyRes.success).toBe(true);

      // 4. Verify cleanup after success: ticket removed from sessionStorage and memory
      expect(sessionStorage.getItem(`encrix_ticket_${email}:LOGIN`)).toBeNull();
      expect(authService.getStoredTicket(`${email}:LOGIN`)).toBeUndefined();
    });

    it('cleans up stored ticket from sessionStorage on terminal errors (expiry, max attempts)', async () => {
      const email = 'cleanup-expired@encrix.test';
      const fakeTicket = 'payload.expired-ticket';

      authService.setStoredTicket(`${email}:LOGIN`, fakeTicket);
      expect(sessionStorage.getItem(`encrix_ticket_${email}:LOGIN`)).toBe(fakeTicket);

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'That code has expired. Request a new code.',
          }),
        };
      });

      const res = await authService.verifyOtp({
        email,
        otp: '999999',
        purpose: 'LOGIN',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('expired');
      expect(sessionStorage.getItem(`encrix_ticket_${email}:LOGIN`)).toBeNull();
    });

    it('clears all tickets from sessionStorage on logout', async () => {
      authService.setStoredTicket('user1@encrix.test:LOGIN', 'ticket-1');
      authService.setStoredTicket('user2@encrix.test:REGISTER', 'ticket-2');

      expect(sessionStorage.getItem('encrix_ticket_user1@encrix.test:LOGIN')).toBe('ticket-1');
      expect(sessionStorage.getItem('encrix_ticket_user2@encrix.test:REGISTER')).toBe('ticket-2');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      });

      await authService.logout();

      expect(sessionStorage.getItem('encrix_ticket_user1@encrix.test:LOGIN')).toBeNull();
      expect(sessionStorage.getItem('encrix_ticket_user2@encrix.test:REGISTER')).toBeNull();
    });
  });
});
