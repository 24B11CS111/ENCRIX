import { afterEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/auth/send-otp';
import verifyOtpHandler from '../../api/auth/verify-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import * as otpServer from '../../api/_lib/otpServer';
import { verifySignedSessionToken } from '../../api/_lib/sessionServer';

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

describe('Phase 25: OTP Security Review & Production Acceptance Gate Suite', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    otpServer.serverOtpStore.clear();
    otpServer.consumedTickets.clear();
    vi.restoreAllMocks();
  });

  it('fails closed with 503 in production when pending_registrations table is unmigrated (42P01)', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'prod-unmigrated@encrix.test';
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'pending_registrations') {
          return createQueryBuilder({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
        }
        return createQueryBuilder({ data: [], error: null });
      }),
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
        fullName: 'Prod Founder',
        companyName: 'Prod Org',
      },
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body.error).toBe('Registration verification could not be prepared. Please try again shortly.');
    expect(dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).toContain('42P01');
    expect(JSON.stringify(log.mock.calls)).not.toContain(email);
  });

  it('allows ticket creation and OTP dispatch in development when database is in mock mode', async () => {
    process.env.NODE_ENV = 'development';
    const email = 'dev-founder@encrix.test';
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: [], error: null })),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const dispatch = vi.spyOn(otpServer, 'sendVerificationEmail').mockResolvedValue({
      success: true,
      provider: 'RESEND',
    });
    const response = createResponse();

    await sendOtpHandler({
      method: 'POST',
      body: {
        email,
        purpose: 'REGISTER',
        fullName: 'Dev Founder',
        companyName: 'Dev Org',
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verificationTicket).toBeDefined();
    expect(response.body.registrationTicket).toBeDefined();
    expect(dispatch).toHaveBeenCalledWith(email, expect.any(String));
  });

  it('strictly rejects replaying an already-consumed verification ticket', async () => {
    const email = 'replay-check@encrix.test';
    const otp = '849201';
    let profileCreated = false;
    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'organizations') {
          return createQueryBuilder({ data: { id: 'org-replay-1', name: 'Replay Org', owner_id: 'user-1' }, error: null });
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({
                  data: profileCreated ? { id: 'prof-replay-1', email, role: 'OWNER' } : null,
                  error: null,
                })),
              })),
            })),
            insert: vi.fn((data: any) => {
              profileCreated = true;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({ data: { id: 'prof-replay-1', ...data }, error: null })),
                })),
              };
            }),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Replay Org',
      ownerName: 'Replay User',
    });

    // First use: Valid
    const res1 = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, res1);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);

    // Second use (Replay attempt): Must be rejected!
    const res2 = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, res2);

    expect(res2.statusCode).toBe(400);
    expect(res2.body.error).toBe('No pending registration found for this email address.');
  });

  it('rejects verification ticket bound to a different email address', async () => {
    const ticketEmail = 'alice@encrix.test';
    const submitEmail = 'bob@encrix.test';
    const otp = '123456';
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const ticket = otpServer.createVerificationTicket({
      email: ticketEmail,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(ticketEmail, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Alice Corp',
      ownerName: 'Alice',
    });

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email: submitEmail, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
  });

  it('rejects tampered ticket payload where attacker modifies company name', async () => {
    const email = 'tamper-org@encrix.test';
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const validTicket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, '123456'),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Legit Org',
      ownerName: 'Legit Guy',
    });

    const [payload, sig] = validTicket.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    decoded.companyName = 'Attacker Org Hijack';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedTicket = `${tamperedPayload}.${sig}`;

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp: '123456', purpose: 'REGISTER', verificationTicket: tamperedTicket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
  });

  it('ignores unverified client registrationData body overrides and strictly enforces ticket data', async () => {
    const email = 'strict-payload@encrix.test';
    const otp = '998877';
    let insertedOrgData: any = null;

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'organizations') {
          return {
            insert: vi.fn((data: any) => {
              insertedOrgData = data;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({ data: { id: 'org-strict', ...data }, error: null })),
                })),
              };
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
            insert: vi.fn((data: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({ data: { id: 'prof-strict', ...data }, error: null })),
              })),
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Verified Ticket Company',
      ownerName: 'Verified Ticket Name',
    });

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp,
        purpose: 'REGISTER',
        verificationTicket: ticket,
        registrationData: {
          companyName: 'TAMPERED_CLIENT_BODY_NAME',
          ownerName: 'TAMPERED_CLIENT_OWNER',
        },
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(insertedOrgData.name).toBe('Verified Ticket Company');
    expect(insertedOrgData.name).not.toBe('TAMPERED_CLIENT_BODY_NAME');
  });

  it('returns 409 Conflict if email is already registered, preventing duplicate organization/owner creation', async () => {
    const email = 'already-registered@encrix.test';
    const otp = '112233';

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({
                  data: { id: 'prof-existing', email, organization_id: 'org-existing', role: 'OWNER' },
                  error: null,
                })),
              })),
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'New Org Attempt',
      ownerName: 'New Owner Attempt',
    });

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toContain('already exists');
  });

  it('generates a valid RFC 4122 UUID for organizations.owner_id and rolls back org on profile insert failure in production', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'rollback-test@encrix.test';
    const otp = '445566';
    let createdOrgId: string | null = null;
    let deletedOrgId: string | null = null;
    let insertedOwnerId: string | null = null;

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'organizations') {
          return {
            insert: vi.fn((data: any) => {
              insertedOwnerId = Array.isArray(data) ? data[0]?.owner_id : data?.owner_id;
              createdOrgId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({ data: { id: createdOrgId, ...data }, error: null })),
                })),
              };
            }),
            delete: vi.fn(() => ({
              eq: vi.fn((_col: string, val: string) => {
                deletedOrgId = val;
                return Promise.resolve({ data: null, error: null });
              }),
            })),
          };
        }
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve({
                  data: null,
                  error: { code: '42703', message: 'column "email" of relation "profiles" does not exist' },
                })),
              })),
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Failing Profile Org',
      ownerName: 'Failing Profile Owner',
    });

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    // Verify valid RFC 4122 UUID was provided
    expect(insertedOwnerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // In production, failure MUST fail closed (500) and NEVER return a fake in-memory mock profile
    expect(response.statusCode).toBe(500);
    expect(response.body.error).toContain('Failed to create owner profile');

    // Verify orphaned organization was cleaned up (rolled back)
    expect(deletedOrgId).toBe(createdOrgId);
  });

  it('fails closed with 503 in production on send-otp LOGIN when email_otps table is missing', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'prod-login-unmigrated@encrix.test';

    const fakeSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'email_otps') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  gt: vi.fn(() => ({
                    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => Promise.resolve({
              data: null,
              error: { code: '42P01', message: 'relation "email_otps" does not exist' },
            })),
          };
        }
        return createQueryBuilder({ data: null, error: null });
      }),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await sendOtpHandler({
      method: 'POST',
      body: { email, purpose: 'LOGIN' },
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body.error).toContain('Authentication verification could not be prepared');
  });

  it('logout properly revokes active session token on server and removes tokens from localStorage', async () => {
    localStorage.setItem('leadvault_session_token', 'test-active-session-token');
    localStorage.setItem('leadvault_session', JSON.stringify({ profileId: 'prof-test-123' }));

    let sessionRevoked = false;
    let authHeaderReceived: string | null = null;

    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      if (String(url).includes('/api/auth/session') && init?.method === 'DELETE') {
        sessionRevoked = true;
        authHeaderReceived = init?.headers?.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'Session revoked successfully' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const { authService } = await import('../services/auth/authService');
    await authService.logout();

    expect(sessionRevoked).toBe(true);
    expect(authHeaderReceived).toBe('Bearer test-active-session-token');
    expect(localStorage.getItem('leadvault_session_token')).toBeNull();
    expect(localStorage.getItem('leadvault_session')).toBeNull();
  });

  it('pre-flights SESSION_SERVER_SECRET and fails closed with 500 without burning OTP or modifying DB if secret is missing', async () => {
    const originalSecret = process.env.SESSION_SERVER_SECRET;
    delete process.env.SESSION_SERVER_SECRET;

    try {
      const email = 'preflight-secret@encrix.test';
      const otp = '654321';
      let dbMutated = false;

      const fakeSupabase = {
        from: vi.fn(() => ({
          insert: vi.fn(() => {
            dbMutated = true;
            return Promise.resolve({ data: null, error: null });
          }),
        })),
      };
      vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

      const response = createResponse();
      await verifyOtpHandler({
        method: 'POST',
        body: { email, otp, purpose: 'REGISTER' },
      }, response);

      expect(response.statusCode).toBe(500);
      expect(response.body.error).toBe('SESSION_SERVER_SECRET is missing or invalid');
      expect(dbMutated).toBe(false);
    } finally {
      if (originalSecret !== undefined) {
        process.env.SESSION_SERVER_SECRET = originalSecret;
      }
    }
  });
});
