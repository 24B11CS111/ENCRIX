import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import verifyOtpHandler from '../../api/_lib/authHandlers/verify-otp';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import { consumedTickets, createVerificationTicket, hashOtp, serverOtpStore } from '../../api/_lib/otpServer';

type OtpRow = {
  id: string;
  ticket_id: string;
  email: string;
  purpose: 'LOGIN' | 'INVITATION';
  otp_hash: string;
  attempts: number;
  expires_at: string;
  resend_after: string;
  used: boolean;
  verified_at: string | null;
};

function response() {
  let statusCode = 200;
  let body: any;
  return {
    status(code: number) { statusCode = code; return this; },
    json(value: any) { body = value; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeDatabase(options: { rpcFailure?: boolean; rowMissing?: boolean; lookupFailure?: boolean } = {}) {
  const email = 'otp-user@example.test';
  const correctOtp = '482619';
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const ticketId = '43bc13c1-7dd1-43a2-a5ec-cb26f967cad6';
  const inviteToken = 'invite-durable-otp-token';
  const ticket = createVerificationTicket({
    ticketId,
    email,
    purpose: 'LOGIN',
    otpHash: hashOtp(email, correctOtp),
    expiresAt,
  });
  const row: OtpRow = {
    id: 'email-otp-row', ticket_id: ticketId, email, purpose: 'LOGIN',
    otp_hash: hashOtp(email, correctOtp), attempts: 0, expires_at: expiresAt,
    resend_after: new Date(Date.now() - 1_000).toISOString(), used: false, verified_at: null,
  };
  const profile = {
    id: 'profile-owner-1', user_id: 'auth-user-1', organization_id: 'organization-1',
    full_name: 'OTP Owner', email, role: 'OWNER', status: 'ACTIVE',
  };
  const org = { id: 'organization-1', name: 'OTP Test Org', owner_id: 'auth-user-1', status: 'ACTIVE' };
  const invitation: any = {
    id: 'inv-1', token: inviteToken, organization_id: org.id, full_name: 'OTP Caller', email,
    invited_by: profile.id, role: 'TELECALLER', status: 'PENDING',
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), phone_number: null,
  };
  let rpcQueue = Promise.resolve();
  let profileCreated = false;
  let rpcCalls = 0;

  const makeBuilder = (table: string, selectColumns?: string) => {
    const filters: Array<[string, unknown]> = [];
    let updates: any = null;
    let inserted: any = null;
    const builder: any = {};
    builder.select = vi.fn((columns?: string) => {
      if (columns) selectColumns = columns;
      return builder;
    });
    builder.eq = vi.fn((key: string, value: unknown) => { filters.push([key, value]); return builder; });
    builder.limit = vi.fn(async () => {
      if (table !== 'email_otps') return { data: [], error: null };
      if (options.lookupFailure) return { data: null, error: { code: '08006' } };
      if (options.rowMissing) return { data: [], error: null };
      if (filters.some(([key, value]) => (row as any)[key] !== value)) return { data: [], error: null };
      return { data: [{ ...row }], error: null };
    });
    builder.maybeSingle = vi.fn(async () => {
      if (table === 'organization_invitations') {
        const match = filters.every(([key, value]) => invitation[key] === value);
        return { data: match ? { ...invitation } : null, error: null };
      }
      if (table === 'profiles') {
        return { data: profileCreated ? { ...profile, role: 'TELECALLER' } : null, error: null };
      }
      return { data: null, error: null };
    });
    builder.single = vi.fn(async () => {
      if (table === 'profiles') return { data: { ...profile }, error: null };
      if (table === 'organizations') return { data: { ...org }, error: null };
      return { data: null, error: { code: 'PGRST116' } };
    });
    builder.update = vi.fn((value: any) => { updates = value; return builder; });
    builder.insert = vi.fn((value: any) => { inserted = value; return builder; });
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      if (table === 'security_events' || table === 'activity_logs') {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
    };
    builder.selectAfterWrite = undefined;
    const originalSelect = builder.select;
    builder.select = vi.fn((columns?: string) => {
      if (columns) selectColumns = columns;
      const selected = originalSelect(columns);
      selected.maybeSingle = vi.fn(async () => {
        if (table !== 'organization_invitations') return { data: null, error: null };
        const matches = filters.every(([key, value]) => invitation[key] === value);
        if (!matches) return { data: null, error: null };
        Object.assign(invitation, updates);
        return { data: { ...invitation }, error: null };
      });
      selected.single = vi.fn(async () => {
        if (table === 'profiles') {
          if (inserted) {
            profileCreated = true;
            return { data: { ...inserted, id: 'profile-telecaller-1' }, error: null };
          }
          return { data: { ...profile }, error: null };
        }
        if (table === 'organizations') return { data: { ...org }, error: null };
        return { data: null, error: { code: 'PGRST116' } };
      });
      return selected;
    });
    return builder;
  };

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn(async (name: string, args: any) => {
      if (name !== 'complete_email_otp_verification') return { data: null, error: null };
      rpcCalls += 1;
      if (options.rpcFailure) return { data: null, error: { code: '08006' } };

      const prior = rpcQueue;
      const gate = deferred<void>();
      rpcQueue = prior.then(() => gate.promise);
      await prior;
      let data: any;
      if (row.used) {
        data = { verified: false, reason: 'consumed', attempts: row.attempts };
      } else if (new Date(row.expires_at).getTime() <= Date.now()) {
        row.used = true;
        data = { verified: false, reason: 'expired', attempts: row.attempts };
      } else if (row.attempts >= 5) {
        row.used = true;
        data = { verified: false, reason: 'locked', attempts: row.attempts };
      } else if (args.p_ticket_id !== row.ticket_id || args.p_email !== row.email || args.p_purpose !== row.purpose) {
        data = { verified: false, reason: 'unavailable', attempts: row.attempts };
      } else if (!args.p_is_valid) {
        row.attempts += 1;
        if (row.attempts >= 5) row.used = true;
        data = { verified: false, reason: row.used ? 'locked' : 'invalid', attempts: row.attempts };
      } else {
        row.used = true;
        row.verified_at = new Date().toISOString();
        data = { verified: true, attempts: row.attempts, verified_at: row.verified_at };
      }
      gate.resolve();
      return { data, error: null };
    }),
  };

  return { client, row, email, correctOtp, expiresAt, ticketId, ticket, inviteToken, invitation, profile, org, get rpcCalls() { return rpcCalls; } };
}

describe('durable login and invitation OTP verification', () => {
  const previousEnv = { nodeEnv: process.env.NODE_ENV, otp: process.env.OTP_SERVER_SECRET, session: process.env.SESSION_SERVER_SECRET };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.OTP_SERVER_SECRET = randomBytes(32).toString('hex');
    process.env.SESSION_SERVER_SECRET = randomBytes(32).toString('hex');
    serverOtpStore.clear();
    consumedTickets.clear();
  });

  afterEach(() => {
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv.nodeEnv;
    if (previousEnv.otp === undefined) delete process.env.OTP_SERVER_SECRET; else process.env.OTP_SERVER_SECRET = previousEnv.otp;
    if (previousEnv.session === undefined) delete process.env.SESSION_SERVER_SECRET; else process.env.SESSION_SERVER_SECRET = previousEnv.session;
    serverOtpStore.clear();
    consumedTickets.clear();
    vi.restoreAllMocks();
  });

  async function runLogin(db: ReturnType<typeof makeDatabase>, otp: string, ticket = db.ticket) {
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(db.client as any);
    const res = response();
    await verifyOtpHandler({ method: 'POST', body: { email: db.email, otp, purpose: 'LOGIN', verificationTicket: ticket } }, res);
    return res;
  }

  it('accepts a correct LOGIN code and consumes its durable ticket', async () => {
    const db = makeDatabase();
    const res = await runLogin(db, db.correctOtp);
    expect(res.statusCode).toBe(200);
    expect(db.row.used).toBe(true);
    expect(db.row.verified_at).toBeTruthy();
    expect(db.rpcCalls).toBe(1);
  });

  it('records an incorrect attempt in the atomic RPC and rejects the sixth attempt', async () => {
    const db = makeDatabase();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await runLogin(db, '000000');
      expect(res.statusCode).toBe(400);
      expect(db.row.attempts).toBe(attempt);
    }
    expect(db.row.used).toBe(true);
    const sixth = await runLogin(db, '000000');
    expect(sixth.statusCode).toBe(400);
    expect(sixth.body.error).toMatch(/too many attempts|no active/i);
    expect(db.row.attempts).toBe(5);
  });

  it('serializes concurrent incorrect attempts and caps the shared counter at five', async () => {
    const db = makeDatabase();
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(db.client as any);
    const responses = await Promise.all(Array.from({ length: 12 }, async () => {
      const res = response();
      await verifyOtpHandler({ method: 'POST', body: {
        email: db.email, otp: '000000', purpose: 'LOGIN', verificationTicket: db.ticket,
      } }, res);
      return res;
    }));
    expect(responses.every((res) => res.statusCode === 400)).toBe(true);
    expect(db.row.attempts).toBe(5);
    expect(db.row.used).toBe(true);
  });

  it('allows only one concurrent successful LOGIN verification', async () => {
    const db = makeDatabase();
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(db.client as any);
    const responses = await Promise.all(Array.from({ length: 2 }, async () => {
      const res = response();
      await verifyOtpHandler({ method: 'POST', body: {
        email: db.email, otp: db.correctOtp, purpose: 'LOGIN', verificationTicket: db.ticket,
      } }, res);
      return res;
    }));
    expect(responses.filter((res) => res.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.statusCode !== 200)).toHaveLength(1);
    expect(db.row.used).toBe(true);
  });

  it('rejects an expired ticket before a valid code can be submitted', async () => {
    const db = makeDatabase();
    db.row.expires_at = new Date(Date.now() - 1_000).toISOString();
    const expiredTicket = createVerificationTicket({
      ticketId: db.ticketId, email: db.email, purpose: 'LOGIN', otpHash: db.row.otp_hash,
      expiresAt: db.row.expires_at,
    });
    const res = await runLogin(db, db.correctOtp, expiredTicket);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/expired|no active/i);
    expect(db.row.attempts).toBe(0);
    expect(db.rpcCalls).toBe(0);
  });

  it('rejects a replayed ticket and a cancelled ticket', async () => {
    const replayDb = makeDatabase();
    const first = await runLogin(replayDb, replayDb.correctOtp);
    const replay = await runLogin(replayDb, replayDb.correctOtp);
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(400);
    expect(replayDb.row.used).toBe(true);

    const cancelledDb = makeDatabase();
    cancelledDb.row.used = true;
    const cancelled = await runLogin(cancelledDb, cancelledDb.correctOtp);
    expect(cancelled.statusCode).toBe(400);
    expect(cancelledDb.row.verified_at).toBeNull();
  });

  it('fails closed for missing durable rows and database/RPC errors', async () => {
    const missingDb = makeDatabase({ rowMissing: true });
    const missing = await runLogin(missingDb, missingDb.correctOtp);
    expect(missing.statusCode).toBe(400);
    expect(missingDb.rpcCalls).toBe(0);

    const failedDb = makeDatabase({ rpcFailure: true });
    const failed = await runLogin(failedDb, failedDb.correctOtp);
    expect(failed.statusCode).toBe(503);
    expect(failedDb.row.used).toBe(false);

    const lookupDb = makeDatabase({ lookupFailure: true });
    const lookupFailure = await runLogin(lookupDb, lookupDb.correctOtp);
    expect(lookupFailure.statusCode).toBe(503);
    expect(lookupDb.rpcCalls).toBe(0);
    expect(lookupDb.row.attempts).toBe(0);
  });

  it('does not accept a signed ticket without a matching durable row', async () => {
    const db = makeDatabase({ rowMissing: true });
    const res = await runLogin(db, db.correctOtp);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).not.toBe(true);
  });

  it('requires the ticket purpose and invitation identity to match the durable request', async () => {
    const db = makeDatabase();
    const invitationTicket = createVerificationTicket({
      ticketId: db.ticketId, email: db.email, purpose: 'INVITATION', otpHash: db.row.otp_hash,
      expiresAt: db.expiresAt, inviteToken: 'different-invitation',
    });
    const res = await runLogin(db, db.correctOtp, invitationTicket);
    expect(res.statusCode).toBe(400);
    expect(db.rpcCalls).toBe(0);
  });

  it('verifies and consumes invitation OTP before activating the matching invitation', async () => {
    const db = makeDatabase();
    db.row.purpose = 'INVITATION';
    const invitationTicket = createVerificationTicket({
      ticketId: db.ticketId, email: db.email, purpose: 'INVITATION', otpHash: db.row.otp_hash,
      expiresAt: db.expiresAt, inviteToken: db.inviteToken,
    });
    vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue(db.client as any);
    const res = response();
    await verifyOtpHandler({ method: 'POST', body: {
      email: db.email, otp: db.correctOtp, purpose: 'INVITATION',
      inviteToken: db.inviteToken, verificationTicket: invitationTicket,
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(db.row.used).toBe(true);
    expect(db.row.verified_at).toBeTruthy();
    expect(db.invitation.status).toBe('ACCEPTED');
  });
});
