import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'admin-user' }, profile: { id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', status: 'ACTIVE' }, error: null } as any,
  rpc: vi.fn(),
}));

vi.mock('../../api/_lib/supabaseServer', () => ({
  authenticateServerRequest: vi.fn(async () => mocks.auth),
  getSupabaseServerClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

import handler from '../../api/_lib/pilotEntitlementsHandler';

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

const organizationId = '22222222-2222-4222-8222-222222222222';
const entitlementId = '33333333-3333-4333-8333-333333333333';

describe('founding pilot entitlement administration API', () => {
  beforeEach(() => {
    vi.stubEnv('FOUNDING_PILOT_GRANTS_ENABLED', 'true');
    mocks.auth = { user: { id: 'admin-user' }, profile: { id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', status: 'ACTIVE' }, error: null };
    mocks.rpc.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('grants only through the server RPC, scoped to one organization and an explicit bounded expiry', async () => {
    mocks.rpc.mockResolvedValue({ data: entitlementId, error: null });
    const res = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, expiresAt: '2027-03-01T00:00:00.000Z', reason: 'Founding pilot invoice verified' } }, res);
    expect(res.statusCode).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith('grant_founding_pilot_entitlement', expect.objectContaining({
      p_organization_id: organizationId,
      p_granted_by: mocks.auth.profile.id,
      p_reason: 'Founding pilot invoice verified',
    }));
    expect(mocks.rpc.mock.calls[0][1].p_expires_at).toBe('2027-03-01T00:00:00.000Z');
  });

  it('revokes only the entitlement under the supplied organization and records the admin actor', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const res = response();
    await handler({ method: 'POST', body: { action: 'revoke', organizationId, entitlementId, reason: 'Pilot agreement ended' } }, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_founding_pilot_entitlement', {
      p_organization_id: organizationId,
      p_entitlement_id: entitlementId,
      p_revoked_by: mocks.auth.profile.id,
      p_reason: 'Pilot agreement ended',
    });
  });

  it('rejects unauthenticated, non-admin and inactive profiles before any database call', async () => {
    mocks.auth = { user: null, profile: null, error: 'unauthorized' };
    const unauthenticated = response();
    await handler({ method: 'POST', body: {} }, unauthenticated);
    expect(unauthenticated.statusCode).toBe(401);

    mocks.auth = { user: { id: 'owner' }, profile: { id: mocks.auth.profile?.id, role: 'OWNER', status: 'ACTIVE' }, error: null };
    const owner = response();
    await handler({ method: 'POST', body: {} }, owner);
    expect(owner.statusCode).toBe(403);

    mocks.auth = { user: { id: 'admin' }, profile: { id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', status: 'DISABLED' }, error: null };
    const disabled = response();
    await handler({ method: 'POST', body: {} }, disabled);
    expect(disabled.statusCode).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps grants inactive by default unless the operator-reviewed feature flag is explicitly enabled', async () => {
    vi.stubEnv('FOUNDING_PILOT_GRANTS_ENABLED', 'false');
    const res = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, expiresAt: '2027-03-01T00:00:00.000Z', reason: 'Founding pilot invoice verified' } }, res);
    expect(res.statusCode).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid org, reason, action, and expiry without calling the database', async () => {
    const invalidOrg = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId: 'other', reason: 'reason long enough', expiresAt: '2027-03-01T00:00:00Z' } }, invalidOrg);
    expect(invalidOrg.statusCode).toBe(400);

    const invalidExpiry = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, reason: 'reason long enough', expiresAt: '2099-03-01T00:00:00Z' } }, invalidExpiry);
    expect(invalidExpiry.statusCode).toBe(400);

    const invalidAction = response();
    await handler({ method: 'POST', body: { action: 'extend', organizationId, reason: 'reason long enough' } }, invalidAction);
    expect(invalidAction.statusCode).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps duplicate/capacity errors and unavailable RPC errors without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'private database detail' } });
    const duplicate = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, expiresAt: '2027-03-01T00:00:00.000Z', reason: 'Founding pilot invoice verified' } }, duplicate);
    expect(duplicate.statusCode).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toContain('private database detail');

    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'private database detail' } });
    const capacity = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, expiresAt: '2027-03-01T00:00:00.000Z', reason: 'Founding pilot invoice verified' } }, capacity);
    expect(capacity.statusCode).toBe(409);
    expect(capacity.body.error).toMatch(/capacity is full/i);
    expect(JSON.stringify(capacity.body)).not.toContain('private database detail');

    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private database detail' } });
    const unavailable = response();
    await handler({ method: 'POST', body: { action: 'grant', organizationId, expiresAt: '2027-03-01T00:00:00.000Z', reason: 'Founding pilot invoice verified' } }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(JSON.stringify(unavailable.body)).not.toContain('private database detail');
  });
});
