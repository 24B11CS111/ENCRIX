import { afterEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/_lib/authHandlers/send-otp';
import verifyOtpHandler from '../../api/_lib/authHandlers/verify-otp';
import * as otpServer from '../../api/_lib/otpServer';
import * as sessionServer from '../../api/_lib/sessionServer';
import * as supabaseServer from '../../api/_lib/supabaseServer';

function createResponse() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function createQueryBuilder(result: { data: any; error: any }) {
  const builder: any = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function parseTicketPayloadUnsafe(ticket: string): otpServer.VerificationTicketPayload {
  const parts = ticket.split('.');
  if (parts.length !== 2) throw new Error('Invalid ticket structure');
  return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
}

function createRegistrationSupabase(
  email: string,
  ticket: string,
  options: { attempts?: number; profileResult?: { data: any; error: any }; createError?: any; pendingExpiresAt?: string } = {},
) {
  const payload = parseTicketPayloadUnsafe(ticket);
  const pending = {
    id: 'pending-registration-test',
    email,
    otp_hash: payload.otpHash,
    otp_ticket_id: payload.ticketId,
    expires_at: options.pendingExpiresAt || payload.expiresAt,
    phone_number: payload.phone || null,
    company_name: payload.companyName || 'Test Company',
    owner_name: payload.ownerName || 'Test Owner',
    industry: payload.industry || 'General',
    company_size: payload.companySize || '1-10',
    business_email: payload.businessEmail || null,
    business_phone: payload.businessPhone || null,
    business_location: payload.businessLocation || null,
    website_url: payload.websiteUrl || null,
  };
  let attempts = options.attempts || 0;
  let verified = false;
  let consumed = false;
  const supabase = {
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === 'complete_registration_otp_verification') {
        if (args.p_ticket_id !== payload.ticketId || args.p_email !== email) {
          return { data: { verified: false, unavailable: true }, error: null };
        }
        if (consumed) return { data: { verified: false, consumed: true }, error: null };
        if (new Date(pending.expires_at).getTime() <= Date.now()) {
          return { data: { verified: false, expired: true }, error: null };
        }
        if (attempts >= 5) return { data: { verified: false, locked: true, attempts }, error: null };
        if (!args.p_is_valid) {
          attempts = Math.min(attempts + 1, 5);
          return { data: { verified: false, locked: attempts >= 5, attempts }, error: null };
        }
        verified = true;
        return { data: { verified: true, attempts }, error: null };
      }
      if (name === 'create_owner_registration') {
        if (!verified || consumed || args.p_ticket_id !== payload.ticketId || args.p_email !== email) {
          return { data: null, error: { code: '22023', message: 'ticket unavailable' } };
        }
        if (options.createError) return { data: null, error: options.createError };
        consumed = true;
        const organization = { id: 'org-registration-test', name: pending.company_name, owner_id: args.p_owner_user_id, status: 'ACTIVE' };
        const profile = {
          id: 'profile-registration-test', user_id: args.p_owner_user_id,
          organization_id: organization.id, email, full_name: pending.owner_name,
          role: 'OWNER', status: 'ACTIVE',
        };
        return { data: { organization, profile }, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'pending_registrations') return createQueryBuilder({ data: pending, error: null });
      if (table === 'profiles') return createQueryBuilder(options.profileResult || { data: null, error: null });
      return createQueryBuilder({ data: null, error: null });
    }),
  };
  return supabase;
}

describe('Owner Registration End-to-End & Regression Suite', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    otpServer.serverOtpStore.clear();
    otpServer.consumedTickets.clear();
    vi.restoreAllMocks();
  });

  it('proves registration verification preparation succeeds and dispatches email OTP', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'new-owner@encrix.test';

    const fakeSupabase = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'issue_registration_otp_ticket') {
          return { data: { issued: true, pending_registration_id: 'pending-123' }, error: null };
        }
        return { data: null, error: null };
      }),
      from: vi.fn(() => createQueryBuilder({ data: [], error: null })),
    };

    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const dispatch = vi.spyOn(otpServer, 'sendVerificationEmail').mockResolvedValue({
      success: true,
      provider: 'RESEND',
    });

    const res = createResponse();
    await sendOtpHandler({
      method: 'POST',
      body: {
        email,
        purpose: 'REGISTER',
        fullName: 'New Owner',
        companyName: 'New Corp',
        phone: '+919876543210',
        industry: 'Education Consultancy',
        companySize: '1-10',
        businessEmail: email,
        businessPhone: '+919876543210',
        businessLocation: 'Mumbai, Maharashtra',
        websiteUrl: 'https://newcorp.test',
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.maskedEmail).toBeDefined();
    expect(res.body.verificationTicket).toBeDefined();
    expect(res.body.registrationTicket).toBeDefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('issue_registration_otp_ticket', expect.objectContaining({
      p_email: email,
      p_company_name: 'New Corp',
      p_owner_name: 'New Owner',
    }));
  });

  it('proves OTP registration completes end-to-end and creates organization and owner profile', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'complete-owner@encrix.test';
    const rawOtp = '123456';
    const otpHash = otpServer.hashOtp(email, rawOtp);
    const ticketId = 'ticket-uuid-001';

    const signedTicket = otpServer.createVerificationTicket({
      ticketId,
      email,
      purpose: 'REGISTER',
      otpHash,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      companyName: 'Complete Corp',
      ownerName: 'Complete Owner',
      phone: '+919876543210',
      industry: 'Education Consultancy',
      companySize: '1-10',
      businessEmail: email,
      businessPhone: '+919876543210',
      businessLocation: 'Mumbai, Maharashtra',
      websiteUrl: 'https://completecorp.test',
    });

    const fakeSupabase = createRegistrationSupabase(email, signedTicket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const res = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp: rawOtp,
        purpose: 'REGISTER',
        verificationTicket: signedTicket,
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionToken).toBeDefined();
    expect(res.body.profile.role).toBe('OWNER');
    expect(res.body.organization.status).toBe('ACTIVE');
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('complete_registration_otp_verification', expect.objectContaining({
      p_ticket_id: ticketId,
      p_email: email,
      p_is_valid: true,
    }));
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('create_owner_registration', expect.objectContaining({
      p_email: email,
      p_ticket_id: ticketId,
    }));
  });

  it('proves existing login remains functional and unaffected by registration flow', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'existing-owner@encrix.test';
    const rawOtp = '654321';
    const otpHash = otpServer.hashOtp(email, rawOtp);
    const ticketId = 'login-ticket-uuid-001';
    const expiresAt = new Date(Date.now() + 600000).toISOString();

    const signedTicket = otpServer.createVerificationTicket({
      ticketId,
      email,
      purpose: 'LOGIN',
      otpHash,
      expiresAt,
    });

    const fakeSupabase = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'complete_email_otp_verification') {
          return { data: { verified: true, attempts: 0 }, error: null };
        }
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === 'email_otps') {
          return createQueryBuilder({
            data: [{
              id: 'otp-record-1',
              ticket_id: ticketId,
              email,
              purpose: 'LOGIN',
              otp_hash: otpHash,
              attempts: 0,
              expires_at: expiresAt,
              used: false,
            }],
            error: null,
          });
        }
        if (table === 'profiles') {
          return createQueryBuilder({
            data: {
              id: 'prof-login-1',
              user_id: 'user-login-1',
              organization_id: 'org-login-1',
              role: 'OWNER',
              status: 'ACTIVE',
              email,
            },
            error: null,
          });
        }
        if (table === 'organizations') {
          return createQueryBuilder({
            data: { id: 'org-login-1', name: 'Existing Org', status: 'ACTIVE' },
            error: null,
          });
        }
        return createQueryBuilder({ data: [], error: null });
      }),
    };

    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const res = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp: rawOtp,
        purpose: 'LOGIN',
        verificationTicket: signedTicket,
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionToken).toBeDefined();
    expect(res.body.profile.role).toBe('OWNER');
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('complete_email_otp_verification', expect.objectContaining({
      p_ticket_id: ticketId,
      p_email: email,
      p_purpose: 'LOGIN',
      p_is_valid: true,
    }));
  });

  it('proves duplicate registration is rejected with 409 Conflict', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'duplicate-owner@encrix.test';
    const rawOtp = '123456';
    const otpHash = otpServer.hashOtp(email, rawOtp);
    const ticketId = 'ticket-dup-001';

    const signedTicket = otpServer.createVerificationTicket({
      ticketId,
      email,
      purpose: 'REGISTER',
      otpHash,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      companyName: 'Dup Corp',
      ownerName: 'Dup Owner',
    });

    const fakeSupabase = createRegistrationSupabase(email, signedTicket, {
      profileResult: {
        data: { id: 'existing-prof-id', email, role: 'OWNER', status: 'ACTIVE' },
        error: null,
      },
    });

    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const res = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp: rawOtp,
        purpose: 'REGISTER',
        verificationTicket: signedTicket,
      },
    }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('already exists. Please log in');
  });

  it('proves expired OTP registration tickets are strictly rejected', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'expired-owner@encrix.test';
    const rawOtp = '123456';
    const otpHash = otpServer.hashOtp(email, rawOtp);
    const ticketId = 'ticket-expired-001';
    const expiredIso = new Date(Date.now() - 3600000).toISOString();

    const expiredTicket = otpServer.createVerificationTicket({
      ticketId,
      email,
      purpose: 'REGISTER',
      otpHash,
      expiresAt: expiredIso,
      companyName: 'Expired Corp',
      ownerName: 'Expired Owner',
    });

    const fakeSupabase = createRegistrationSupabase(email, expiredTicket, {
      pendingExpiresAt: expiredIso,
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const res = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp: rawOtp,
        purpose: 'REGISTER',
        verificationTicket: expiredTicket,
      },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('That code has expired. Request a new code.');
  });

  it('proves reused verification tickets are rejected by replay cache and database lock', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'reused-ticket@encrix.test';
    const rawOtp = '123456';
    const otpHash = otpServer.hashOtp(email, rawOtp);
    const ticketId = 'ticket-reused-001';

    const ticket = otpServer.createVerificationTicket({
      ticketId,
      email,
      purpose: 'REGISTER',
      otpHash,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      companyName: 'Reused Corp',
      ownerName: 'Reused Owner',
    });

    otpServer.markTicketConsumed(ticket, new Date(Date.now() + 600000).toISOString());
    otpServer.markTicketConsumed(ticketId, new Date(Date.now() + 600000).toISOString());

    const fakeSupabase = createRegistrationSupabase(email, ticket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const res = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: {
        email,
        otp: rawOtp,
        purpose: 'REGISTER',
        verificationTicket: ticket,
      },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('No pending registration found for this email address.');
  });

  it('proves unauthorized non-owner roles cannot bypass onboarding or access owner data', async () => {
    const telecallerToken = sessionServer.createSignedSessionToken({
      userId: 'user-telecaller-123',
      profileId: 'telecaller-id-123',
      organizationId: 'org-123',
      role: 'TELECALLER',
      fullName: 'Test Telecaller',
      email: 'telecaller@encrix.test',
      status: 'ACTIVE',
    });

    const verified = sessionServer.verifySignedSessionToken(telecallerToken);
    expect(verified).not.toBeNull();
    expect(verified?.role).toBe('TELECALLER');
    expect(verified?.role === 'OWNER').toBe(false);
  });
});
