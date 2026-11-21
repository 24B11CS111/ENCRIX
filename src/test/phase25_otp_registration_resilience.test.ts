import { afterEach, describe, expect, it, vi } from 'vitest';
import sendOtpHandler from '../../api/_lib/authHandlers/send-otp';
import verifyOtpHandler from '../../api/_lib/authHandlers/verify-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import * as otpServer from '../../api/_lib/otpServer';

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

function createRegistrationSupabase(
  email: string,
  ticket: string,
  options: { attempts?: number; profileResult?: { data?: any; error?: any }; createError?: any; onCreate?: (args: any) => void } = {},
) {
  const payload = otpServer.verifyVerificationTicket(ticket);
  if (!payload) throw new Error('Test setup requires a valid registration ticket');
  const pending = {
    id: 'pending-registration-test',
    email,
    otp_hash: payload.otpHash,
    otp_ticket_id: payload.ticketId,
    expires_at: payload.expiresAt,
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
  let created = false;
  const supabase = {
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === 'complete_registration_otp_verification') {
        if (args.p_ticket_id !== payload.ticketId || args.p_email !== email) {
          return { data: { verified: false, unavailable: true }, error: null };
        }
        if (consumed) return { data: { verified: false, consumed: true }, error: null };
        if (new Date(payload.expiresAt).getTime() <= Date.now()) {
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
        options.onCreate?.(args);
        if (!verified || consumed || args.p_ticket_id !== payload.ticketId || args.p_email !== email) {
          return { data: null, error: { code: '22023', message: 'ticket unavailable' } };
        }
        if (options.createError) return { data: null, error: options.createError };
        consumed = true;
        created = true;
        const organization = { id: 'org-registration-test', name: pending.company_name, owner_id: args.p_owner_user_id };
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
    getAttempts: () => attempts,
    isVerified: () => verified,
    isConsumed: () => consumed,
    isCreated: () => created,
    pending,
  };
  return supabase;
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
      rpc: vi.fn(async () => ({ data: null, error: { code: '42P01', message: 'registration OTP table does not exist' } })),
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
        phone: '+919876543210',
        businessEmail: 'billing@prod-org.test',
        businessPhone: '+919876543211',
        businessLocation: 'Mumbai, India',
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
      rpc: vi.fn(async (name: string) => name === 'issue_registration_otp_ticket'
        ? ({ data: { issued: true }, error: null })
        : ({ data: null, error: null })),
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
        phone: '+919876543210',
        businessEmail: 'billing@dev-org.test',
        businessPhone: '+919876543211',
        businessLocation: 'Mumbai, India',
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.verificationTicket).toBeDefined();
    expect(response.body.registrationTicket).toBeDefined();
    expect(dispatch).toHaveBeenCalledWith(email, expect.any(String));
  });

  it('persists the signed registration ticket ID alongside its pending OTP row', async () => {
    const email = 'ticket-persistence@encrix.test';
    let persisted: any = null;
    const query: any = {
      select: vi.fn(() => query), eq: vi.fn(() => query), gt: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    const fakeSupabase = {
      rpc: vi.fn(async (name: string, args: any) => {
        if (name !== 'issue_registration_otp_ticket') return { data: null, error: null };
        if (persisted && new Date(persisted.p_resend_after).getTime() > Date.now()) {
          return { data: { issued: false, resend_after: persisted.p_resend_after }, error: null };
        }
        persisted = args;
        return { data: { issued: true }, error: null };
      }),
      from: vi.fn(() => query),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    vi.spyOn(otpServer, 'sendVerificationEmail').mockResolvedValue({ success: true, provider: 'RESEND' });
    const response = createResponse();
    await sendOtpHandler({ method: 'POST', body: {
      email, purpose: 'REGISTER', fullName: 'Ticket Owner', companyName: 'Ticket Co', phone: '+919876543210',
      businessEmail: 'billing@ticket.co', businessPhone: '+919876543211', businessLocation: 'Pune',
    } }, response);
    const ticket = otpServer.verifyVerificationTicket(response.body.verificationTicket);
    expect(response.statusCode).toBe(200);
    expect(ticket?.ticketId).toBe(persisted.p_ticket_id);
    expect(persisted.p_otp_hash).toBe(ticket?.otpHash);
    expect(persisted).toMatchObject({ p_business_email: 'billing@ticket.co', p_business_phone: '+919876543211', p_business_location: 'Pune' });
    const resendResponse = createResponse();
    await sendOtpHandler({ method: 'POST', body: {
      email, purpose: 'REGISTER', fullName: 'Ticket Owner', companyName: 'Ticket Co', phone: '+919876543210',
      businessEmail: 'billing@ticket.co', businessPhone: '+919876543211', businessLocation: 'Pune',
    } }, resendResponse);
    expect(resendResponse.statusCode).toBe(429);
    expect(resendResponse.body.error).toContain('Please wait');
    persisted.p_resend_after = new Date(Date.now() - 1000).toISOString();
    const secondTicketResponse = createResponse();
    await sendOtpHandler({ method: 'POST', body: {
      email, purpose: 'REGISTER', fullName: 'Ticket Owner', companyName: 'Ticket Co', phone: '+919876543210',
      businessEmail: 'billing@ticket.co', businessPhone: '+919876543211', businessLocation: 'Pune',
    } }, secondTicketResponse);
    const secondTicket = otpServer.verifyVerificationTicket(secondTicketResponse.body.verificationTicket);
    expect(secondTicketResponse.statusCode).toBe(200);
    expect(secondTicket?.ticketId).not.toBe(ticket?.ticketId);
    expect(persisted.p_ticket_id).toBe(secondTicket?.ticketId);
  });

  it('does not send registration OTP after the database rolling-window limit is reached', async () => {
    const email = 'rate-limited-registration@encrix.test';
    const fakeSupabase = {
      rpc: vi.fn(async (name: string) => name === 'issue_registration_otp_ticket'
        ? ({ data: { issued: false, rate_limited: true, retry_after: new Date(Date.now() + 60_000).toISOString() }, error: null })
        : ({ data: null, error: null })),
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const dispatch = vi.spyOn(otpServer, 'sendVerificationEmail').mockResolvedValue({
      success: true,
      provider: 'RESEND',
    });
    const response = createResponse();

    await sendOtpHandler({ method: 'POST', body: {
      email,
      purpose: 'REGISTER',
      fullName: 'Rate Limited Owner',
      companyName: 'Rate Limited Co',
      phone: '+919876543210',
      businessEmail: 'billing@rate-limited.co',
      businessPhone: '+919876543211',
      businessLocation: 'Pune',
    } }, response);

    expect(response.statusCode).toBe(429);
    expect(response.body.error).toBe('Too many requests. Please try again later.');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('strictly rejects replaying an already-consumed verification ticket', async () => {
    const email = 'replay-check@encrix.test';
    const otp = '849201';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Replay Org',
      ownerName: 'Replay User',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

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

  it('rejects registration without a ticket before reading or mutating OTP storage', async () => {
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
      rpc: vi.fn(),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email: 'no-ticket@encrix.test', otp: '123456', purpose: 'REGISTER', registrationData: { companyName: 'Untrusted' } },
    }, response);
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
    expect(fakeSupabase.from).not.toHaveBeenCalled();
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects a valid signed but never-issued stateless registration ticket', async () => {
    const email = 'never-issued@encrix.test';
    const ticket = otpServer.createVerificationTicket({
      email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '123456'),
      expiresAt: new Date(Date.now() + 300000).toISOString(), companyName: 'Never Issued', ownerName: 'Owner',
    });
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
      rpc: vi.fn(),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const response = createResponse();
    await verifyOtpHandler({ method: 'POST', body: { email, otp: '123456', purpose: 'REGISTER', verificationTicket: ticket } }, response);
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('locks registration tickets after five wrong codes across independent requests', async () => {
    const email = 'attempt-limit@encrix.test';
    const ticketId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const ticket = otpServer.createVerificationTicket({
      ticketId, email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '654321'),
      expiresAt: new Date(Date.now() + 300000).toISOString(), companyName: 'Attempt Co', ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    for (let i = 0; i < 5; i += 1) {
      const response = createResponse();
      await verifyOtpHandler({ method: 'POST', body: { email, otp: '000000', purpose: 'REGISTER', verificationTicket: ticket } }, response);
      expect(response.statusCode).toBe(400);
    }
    const sixth = createResponse();
    await verifyOtpHandler({ method: 'POST', body: { email, otp: '000000', purpose: 'REGISTER', verificationTicket: ticket } }, sixth);
    expect(sixth.body.error).toContain('Too many attempts');
    expect(fakeSupabase.getAttempts()).toBe(5);
  });

  it('does not allow concurrent incorrect verification requests to exceed the shared limit', async () => {
    const email = 'concurrent-attempt-limit@encrix.test';
    const ticket = otpServer.createVerificationTicket({
      email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '123456'),
      expiresAt: new Date(Date.now() + 300000).toISOString(), companyName: 'Concurrent Co', ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const responses = await Promise.all(Array.from({ length: 12 }, async () => {
      const response = createResponse();
      await verifyOtpHandler({ method: 'POST', body: { email, otp: '999999', purpose: 'REGISTER', verificationTicket: ticket } }, response);
      return response;
    }));
    expect(fakeSupabase.getAttempts()).toBe(5);
    expect(responses.every((response) => response.statusCode === 400)).toBe(true);
    expect(fakeSupabase.rpc).toHaveBeenCalledTimes(12); // one atomic database verification per request
  });

  it('permits the correct registration code after fewer than five durable failures', async () => {
    const email = 'valid-after-failures@encrix.test';
    const ticket = otpServer.createVerificationTicket({
      email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '765432'),
      expiresAt: new Date(Date.now() + 300000).toISOString(), companyName: 'Valid Co', ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    for (let i = 0; i < 2; i += 1) {
      const wrong = createResponse();
      await verifyOtpHandler({ method: 'POST', body: { email, otp: '000000', purpose: 'REGISTER', verificationTicket: ticket } }, wrong);
      expect(wrong.statusCode).toBe(400);
    }
    const correct = createResponse();
    await verifyOtpHandler({ method: 'POST', body: { email, otp: '765432', purpose: 'REGISTER', verificationTicket: ticket } }, correct);
    expect(correct.statusCode).toBe(200);
    expect(correct.body.success).toBe(true);
    expect(fakeSupabase.getAttempts()).toBe(2);
    expect(fakeSupabase.isConsumed()).toBe(true);
  });

  it('rejects an expired signed registration OTP ticket', async () => {
    const email = 'expired-ticket@encrix.test';
    const ticket = otpServer.createVerificationTicket({
      email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '111222'),
      expiresAt: new Date(Date.now() - 1000).toISOString(), companyName: 'Expired Co', ownerName: 'Owner',
    });
    const payload = JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString('utf8'));
    const fakeSupabase = {
      from: vi.fn(() => createQueryBuilder({ data: {
        id: 'pending-expired', email, otp_hash: payload.otpHash, otp_ticket_id: payload.ticketId,
        expires_at: payload.expiresAt, company_name: payload.companyName, owner_name: payload.ownerName,
      }, error: null })),
      rpc: vi.fn(),
    };
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const response = createResponse();
    await verifyOtpHandler({ method: 'POST', body: { email, otp: '111222', purpose: 'REGISTER', verificationTicket: ticket } }, response);
    expect(response.statusCode).toBe(400);
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('rejects tampered ticket payload where attacker modifies company name', async () => {
    const email = 'tamper-org@encrix.test';
    let pending: any = null;
    const fakeSupabase = {
      from: vi.fn((table: string) => createQueryBuilder({ data: table === 'pending_registrations' ? pending : null, error: null })),
      rpc: vi.fn(),
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
    const originalPayload = otpServer.verifyVerificationTicket(validTicket)!;
    pending = {
      id: 'pending-tamper-test', email, otp_hash: originalPayload.otpHash,
      otp_ticket_id: originalPayload.ticketId, expires_at: originalPayload.expiresAt,
      company_name: originalPayload.companyName, owner_name: originalPayload.ownerName,
    };

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
    expect(fakeSupabase.rpc).not.toHaveBeenCalled();
  });

  it('ignores unverified client registrationData body overrides and strictly enforces ticket data', async () => {
    const email = 'strict-payload@encrix.test';
    const otp = '998877';

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Verified Ticket Company',
      ownerName: 'Verified Ticket Name',
    });
    let registrationArgs: any = null;
    const fakeSupabase = createRegistrationSupabase(email, ticket, { onCreate: (args) => { registrationArgs = args; } });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

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
    expect(fakeSupabase.pending.company_name).toBe('Verified Ticket Company');
    expect(registrationArgs).toMatchObject({ p_email: email, p_company_name: 'Verified Ticket Company' });
    expect(fakeSupabase.pending.company_name).not.toBe('TAMPERED_CLIENT_BODY_NAME');
  });

  it('returns 409 Conflict if email is already registered, preventing duplicate organization/owner creation', async () => {
    const email = 'already-registered@encrix.test';
    const otp = '112233';

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'New Org Attempt',
      ownerName: 'New Owner Attempt',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket, {
      profileResult: { data: { id: 'prof-existing', email, organization_id: 'org-existing', role: 'OWNER' }, error: null },
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(409);
    expect(response.body.error).toContain('already exists');
  });

  it('returns a retryable error and never calls the registration RPC when profile lookup fails', async () => {
    const email = 'profile-lookup-error@encrix.test';
    const ticket = otpServer.createVerificationTicket({
      email, purpose: 'REGISTER', otpHash: otpServer.hashOtp(email, '887766'),
      expiresAt: new Date(Date.now() + 300000).toISOString(), companyName: 'Lookup Co', ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket, {
      profileResult: { data: null, error: { code: '08006', message: 'database connection lost' } },
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);
    const response = createResponse();
    await verifyOtpHandler({ method: 'POST', body: { email, otp: '887766', purpose: 'REGISTER', verificationTicket: ticket } }, response);
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toContain('Account lookup is temporarily unavailable');
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('complete_registration_otp_verification', expect.any(Object));
    expect(fakeSupabase.rpc).not.toHaveBeenCalledWith('create_owner_registration', expect.any(Object));
  });

  it('passes a valid RFC 4122 owner UUID to the transactional RPC and leaves rollback to PostgreSQL', async () => {
    process.env.NODE_ENV = 'production';
    const email = 'rollback-test@encrix.test';
    const otp = '445566';
    let insertedOwnerId: string | null = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Failing Profile Org',
      ownerName: 'Failing Profile Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket, {
      createError: { code: '42703', message: 'simulated transactional insert failure' },
      onCreate: (args) => { insertedOwnerId = args.p_owner_user_id; },
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    // Verify valid RFC 4122 UUID was provided
    expect(insertedOwnerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // In production, failure MUST fail closed (500) and NEVER return a fake in-memory mock profile
    expect(response.statusCode).toBe(503);
    expect(response.body.error).toContain('temporarily unavailable');
    expect(fakeSupabase.rpc).toHaveBeenCalledTimes(2);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('create_owner_registration', expect.objectContaining({ p_ticket_id: expect.any(String) }));
    expect(fakeSupabase.from).not.toHaveBeenCalledWith('organizations');
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

  it('rejects registration when create_owner_registration reports ticket unavailable or consumed (code 22023)', async () => {
    const email = 'ticket-unavailable@encrix.test';
    const otp = '123456';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Unavailable Co',
      ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket, {
      createError: { code: '22023', message: 'registration_otp_ticket_unavailable' },
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toContain('Registration verification ticket is invalid or expired');
  });

  it('rejects registration when database verification RPC reports unissued or unavailable ticket', async () => {
    const email = 'rpc-unavailable@encrix.test';
    const otp = '123456';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Unissued Co',
      ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    fakeSupabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'complete_registration_otp_verification') {
        return { data: { verified: false, unavailable: true }, error: null };
      }
      return { data: null, error: null };
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
  });

  it('rejects registration when database verification RPC reports consumed ticket', async () => {
    const email = 'rpc-consumed@encrix.test';
    const otp = '123456';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Consumed Co',
      ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    fakeSupabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'complete_registration_otp_verification') {
        return { data: { verified: false, consumed: true }, error: null };
      }
      return { data: null, error: null };
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('No pending registration found for this email address.');
  });

  it('rejects registration when database verification RPC reports expired ticket', async () => {
    const email = 'rpc-expired@encrix.test';
    const otp = '123456';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Expired Co',
      ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    fakeSupabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'complete_registration_otp_verification') {
        return { data: { verified: false, expired: true }, error: null };
      }
      return { data: null, error: null };
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('That code has expired. Request a new code.');
  });

  it('rejects registration when database verification RPC reports locked ticket after max attempts', async () => {
    const email = 'rpc-locked@encrix.test';
    const otp = '123456';
    const ticket = otpServer.createVerificationTicket({
      email,
      purpose: 'REGISTER',
      otpHash: otpServer.hashOtp(email, otp),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      companyName: 'Locked Co',
      ownerName: 'Owner',
    });
    const fakeSupabase = createRegistrationSupabase(email, ticket);
    fakeSupabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'complete_registration_otp_verification') {
        return { data: { verified: false, locked: true, attempts: 5 }, error: null };
      }
      return { data: null, error: null };
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(fakeSupabase as any);

    const response = createResponse();
    await verifyOtpHandler({
      method: 'POST',
      body: { email, otp, purpose: 'REGISTER', verificationTicket: ticket },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toBe('Too many attempts. Please request a new code.');
  });
});
