import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'user-owner' }, profile: { id: 'profile-owner', organization_id: '5ed8c7cb-63ab-4c78-848a-cd754f5716e3', role: 'OWNER', status: 'ACTIVE' }, error: null as string | null },
  row: null as any,
  saveError: null as any,
  lookupError: null as any,
  revokeError: null as any,
  saved: true,
  revoked: true,
  accountValidation: 'VALID' as 'VALID' | 'INVALID' | 'UNAVAILABLE',
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  rpcPayload: null as any,
}));

vi.mock('../../api/_lib/supabaseServer', () => ({
  authenticateServerRequest: vi.fn(async () => mocks.auth),
  getSupabaseServerClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));
vi.mock('../../api/_lib/twilioRest', () => ({
  validateOrganizationTwilioAccount: vi.fn(async () => mocks.accountValidation),
}));

import handler from '../../api/telephony/config';

function response() {
  return {
    statusCode: 0,
    body: null as any,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

describe('organization Twilio configuration API', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_CREDENTIAL_ENCRYPTION_KEYS', JSON.stringify({ test: Buffer.alloc(32, 7).toString('base64') }));
    vi.stubEnv('TWILIO_CREDENTIALS_ACTIVE_KEY_ID', 'test');
    mocks.auth = { user: { id: 'user-owner' }, profile: { id: 'profile-owner', organization_id: '5ed8c7cb-63ab-4c78-848a-cd754f5716e3', role: 'OWNER', status: 'ACTIVE' }, error: null };
    mocks.row = null;
    mocks.rpcPayload = null;
    mocks.saveError = mocks.lookupError = mocks.revokeError = null;
    mocks.saved = mocks.revoked = true;
    mocks.accountValidation = 'VALID';
    mocks.rpc.mockReset().mockImplementation(async (name: string, args: any) => {
      mocks.rpcPayload = { name, args };
      if (name === 'save_organization_twilio_credentials') return { data: mocks.saved, error: mocks.saveError };
      if (name === 'revoke_organization_twilio_credentials') return { data: mocks.revoked, error: mocks.revokeError };
      return { data: null, error: null };
    });
    mocks.maybeSingle.mockReset().mockImplementation(async () => ({ data: mocks.row, error: mocks.lookupError }));
    mocks.eq.mockReset().mockImplementation(() => query);
    mocks.select.mockReset().mockImplementation(() => query);
    mocks.from.mockReset().mockImplementation(() => query);
  });

  const query: any = {
    select: (...args: any[]) => mocks.select(...args),
    eq: (...args: any[]) => mocks.eq(...args),
    maybeSingle: (...args: any[]) => mocks.maybeSingle(...args),
  };

  it('returns only non-secret configuration metadata to an owner', async () => {
    const credentials = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), phoneNumber: '+14155552671' };
    mocks.row = { twilio_phone_number: credentials.phoneNumber, status: 'ACTIVE', updated_at: '2026-01-01T00:00:00Z' };
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer owner-token' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ configured: true, phoneNumberMasked: '••••2671', updatedAt: '2026-01-01T00:00:00Z' });
    expect(JSON.stringify(res.body)).not.toContain(credentials.accountSid);
    expect(JSON.stringify(res.body)).not.toContain(credentials.authToken);
    expect(mocks.select).toHaveBeenCalledWith('twilio_phone_number, status, updated_at');
  });

  it('encrypts credentials before the transactional save RPC and returns only a masked number', async () => {
    const credentials = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), phoneNumber: '+14155552671' };
    const res = response();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer owner-token' }, body: credentials }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ configured: true, phoneNumberMasked: '••••2671' });
    const saved = (mocks as any).rpcPayload;
    expect(saved.name).toBe('save_organization_twilio_credentials');
    expect(saved.args.p_organization_id).toBe('5ed8c7cb-63ab-4c78-848a-cd754f5716e3');
    expect(saved.args.p_updated_by).toBe('profile-owner');
    expect(saved.args.p_auth_token).toBeUndefined();
    expect(saved.args.p_ciphertext).toBeTruthy();
    expect(saved.args.p_key_id).toBe('test');
    expect(JSON.stringify(saved)).not.toContain(credentials.authToken);
    expect(JSON.stringify(res.body)).not.toContain(credentials.phoneNumber);
  });

  it('rejects telecallers and inactive owners before touching configuration storage', async () => {
    const res = response();
    mocks.auth.profile = { ...mocks.auth.profile!, role: 'TELECALLER' };
    await handler({ method: 'PUT', headers: { authorization: 'Bearer telecaller-token' }, body: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();

    const disabled = response();
    mocks.auth.profile = { ...mocks.auth.profile!, role: 'OWNER', status: 'SUSPENDED' };
    await handler({ method: 'GET', headers: { authorization: 'Bearer owner-token' } }, disabled);
    expect(disabled.statusCode).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials and handles a number already used by another organization', async () => {
    const invalid = response();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer owner-token' }, body: { accountSid: 'ACbad', authToken: 'bad', phoneNumber: '123' } }, invalid);
    expect(invalid.statusCode).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.accountValidation = 'INVALID';
    const providerInvalid = response();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer owner-token' }, body: { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), phoneNumber: '+14155552671' } }, providerInvalid);
    expect(providerInvalid.statusCode).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.accountValidation = 'VALID';
    mocks.saveError = { code: '23505' };
    const duplicate = response();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer owner-token' }, body: { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), phoneNumber: '+14155552671' } }, duplicate);
    expect(duplicate.statusCode).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toMatch(/AC[a-f0-9]{32}|b{32}/i);

    mocks.saveError = null;
    mocks.saved = false;
    const activeCall = response();
    await handler({ method: 'PUT', headers: { authorization: 'Bearer owner-token' }, body: { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), phoneNumber: '+14155552671' } }, activeCall);
    expect(activeCall.statusCode).toBe(409);
    expect(activeCall.body.error).toMatch(/active calls/i);
  });

  it('disables a stored configuration through the transaction that protects active calls', async () => {
    const res = response();
    await handler({ method: 'DELETE', headers: { authorization: 'Bearer owner-token' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ configured: false });
    expect(mocks.rpcPayload).toEqual({
      name: 'revoke_organization_twilio_credentials',
      args: { p_organization_id: '5ed8c7cb-63ab-4c78-848a-cd754f5716e3', p_updated_by: 'profile-owner' },
    });

    mocks.revoked = false;
    const activeCall = response();
    await handler({ method: 'DELETE', headers: { authorization: 'Bearer owner-token' } }, activeCall);
    expect(activeCall.statusCode).toBe(409);
    expect(activeCall.body.error).toMatch(/active calls/i);
  });
});
