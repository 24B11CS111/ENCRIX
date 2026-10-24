import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: null as any,
  enrollment: null as any,
  rpc: vi.fn(),
  completionOutcome: 'VERIFIED',
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: vi.fn(async () => ({
    user: state.profile ? { id: state.profile.user_id } : null,
    profile: state.profile,
    error: state.profile ? null : 'Unauthorized',
  })),
  getSupabaseServerClient: () => ({
    rpc: state.rpc,
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: state.enrollment?.consumed_at ? null : state.enrollment,
          error: null,
        }),
        update: () => builder,
      };
      return builder;
    },
  }),
  isRealSupabaseServerConfigured: () => true,
}));

import enrollmentHandler from '../../api/auth/phone-enrollment';

const profile = {
  id: '10000000-0000-4000-8000-000000000001',
  user_id: '20000000-0000-4000-8000-000000000002',
  organization_id: '30000000-0000-4000-8000-000000000003',
  full_name: 'Synthetic Telecaller',
  role: 'TELECALLER',
  status: 'ACTIVE',
};
const migrationPath = resolve(process.cwd(), 'supabase/migrations/20261023120000_secure_caller_enrollment_bridge_persistence.sql');

function request(body: unknown, authorization = 'Bearer synthetic-token') {
  const req = { method: 'POST', headers: { authorization }, body };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  return { req, res };
}

async function sendCode() {
  const send = request({ action: 'send', phone: '+1 (555) 123-4567' });
  await enrollmentHandler(send.req, send.res);
  const fetchCall = (globalThis.fetch as any).mock.calls.at(-1);
  const body = new URLSearchParams(fetchCall[1].body);
  const code = body.get('Body')?.match(/code is (\d{6})/)?.[1];
  if (!code) throw new Error('Test SMS did not contain a generated verification code');
  return { send, code };
}

beforeEach(() => {
  state.profile = profile;
  state.enrollment = null;
  state.completionOutcome = 'VERIFIED';
  state.rpc.mockReset();
  vi.stubEnv('SUPABASE_URL', 'https://synthetic-project.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', randomBytes(48).toString('hex'));
  vi.stubEnv('OTP_SERVER_SECRET', randomBytes(48).toString('hex'));
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'a'.repeat(32)}`);
  vi.stubEnv('TWILIO_AUTH_TOKEN', randomBytes(48).toString('hex'));
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+15550000000');
  state.rpc.mockImplementation(async (name: string, args: Record<string, any>) => {
    if (name === 'begin_caller_phone_enrollment') {
      state.enrollment = {
        id: '40000000-0000-4000-8000-000000000004',
        profile_id: args.p_profile_id,
        phone_number: args.p_phone_number,
        otp_hash: args.p_otp_hash,
        consumed_at: null,
      };
      return { data: [{ outcome: 'CREATED', enrollment_id: state.enrollment.id }], error: null };
    }
    if (name === 'complete_caller_phone_enrollment') {
      const outcome = args.p_code_matches ? state.completionOutcome : 'INVALID';
      if (outcome === 'VERIFIED' || outcome === 'REPLAYED' || outcome === 'EXPIRED' || outcome === 'MAX_ATTEMPTS') {
        state.enrollment.consumed_at = new Date().toISOString();
      }
      return { data: outcome, error: null };
    }
    return { data: null, error: { code: '42883' } };
  });
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ sid: `SM${'b'.repeat(32)}` }) }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('server-controlled caller phone enrollment', () => {
  it('rejects unauthenticated requests without contacting storage or SMS', async () => {
    state.profile = null;
    const call = request({ action: 'send', phone: '+15551234567' });
    await enrollmentHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes a number, persists only an OTP hash, and never returns the code or phone', async () => {
    const { send, code } = await sendCode();
    expect(send.res.statusCode).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('begin_caller_phone_enrollment', expect.objectContaining({
      p_profile_id: profile.id,
      p_organization_id: profile.organization_id,
      p_phone_number: '+15551234567',
      p_otp_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(send.res.body)).not.toContain(code);
    expect(JSON.stringify(send.res.body)).not.toContain('+15551234567');
  });

  it('rejects invalid numbers before persistence or delivery', async () => {
    const call = request({ action: 'send', phone: 'not-a-number' });
    await enrollmentHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when live SMS delivery is not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    vi.stubEnv('TWILIO_PHONE_NUMBER', '');
    const call = request({ action: 'send', phone: '+15551234567' });
    await enrollmentHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps wrong, expired, replayed, and over-attempt results to failures', async () => {
    const verify = async (outcome: string, candidate: string) => {
      state.completionOutcome = outcome;
      const call = request({ action: 'verify', code: candidate });
      await enrollmentHandler(call.req, call.res);
      return call.res;
    };

    let enrollment = await sendCode();
    const wrongCode = enrollment.code === '000000' ? '000001' : '000000';
    expect((await verify('INVALID', wrongCode)).statusCode).toBe(400);

    enrollment = await sendCode();
    expect((await verify('EXPIRED', enrollment.code)).statusCode).toBe(400);

    enrollment = await sendCode();
    expect((await verify('MAX_ATTEMPTS', enrollment.code)).statusCode).toBe(429);

    enrollment = await sendCode();
    expect((await verify('VERIFIED', enrollment.code)).body).toEqual({ success: true, verified: true });
    const replay = request({ action: 'verify', code: enrollment.code });
    await enrollmentHandler(replay.req, replay.res);
    expect(replay.res.statusCode).toBe(400);

    expect(state.rpc).toHaveBeenCalledWith('complete_caller_phone_enrollment', expect.objectContaining({
      p_profile_id: profile.id,
      p_code_matches: true,
    }));
  });

  it('rejects inactive or non-telecaller profiles', async () => {
    state.profile = { ...profile, role: 'OWNER' };
    const call = request({ action: 'send', phone: '+15551234567' });
    await enrollmentHandler(call.req, call.res);
    expect(call.res.statusCode).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('caller and bridge persistence migration contract', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('restricts enrollment and bridge records to service_role and protects profile verification fields', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.caller_phone_enrollments FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.call_bridges FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/NEW\.phone_verified IS DISTINCT FROM OLD\.phone_verified/i);
    expect(sql).toMatch(/NEW\.phone IS DISTINCT FROM OLD\.phone/i);
    expect(sql).toMatch(/complete_caller_phone_enrollment[\s\S]*?phone_verified = TRUE/i);
    expect(sql).toMatch(/expires_at <= v_now[\s\S]*?RETURN 'EXPIRED'/i);
    expect(sql).toMatch(/attempts >= 5[\s\S]*?RETURN 'MAX_ATTEMPTS'/i);
    expect(sql).toMatch(/consumed_at IS NOT NULL THEN RETURN 'REPLAYED'/i);
  });

  it('binds bridge records to the same tenant and telecaller with idempotency and provider-leg uniqueness', () => {
    expect(sql).toMatch(/FOREIGN KEY \(call_id, organization_id, telecaller_id\)[\s\S]*?REFERENCES public\.calls\(id, organization_id, telecaller_id\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(telecaller_id, organization_id\)[\s\S]*?REFERENCES public\.profiles\(id, organization_id\)/i);
    expect(sql).toMatch(/UNIQUE \(organization_id, telecaller_id, idempotency_key\)/i);
    expect(sql).toMatch(/caller_provider_call_id VARCHAR\(34\) UNIQUE/i);
    expect(sql).toMatch(/customer_provider_call_id VARCHAR\(34\) UNIQUE/i);
    expect(sql).toMatch(/caller_provider_call_id IS NULL OR caller_provider_call_id ~ '\^CA/);
    expect(sql).toMatch(/customer_provider_call_id IS NULL OR customer_provider_call_id ~ '\^CA/);
    const recordingsMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261006000000_production_telephony_recordings.sql'), 'utf8');
    expect(recordingsMigration).toMatch(/provider_event_id VARCHAR\(150\) NOT NULL UNIQUE/i);
    expect(sql).toMatch(/webhook_events_call_sid_idx/i);
  });
});
