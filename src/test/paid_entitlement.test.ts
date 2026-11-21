import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPaidEntitlement, requirePaidEntitlement } from '../../api/_lib/paidEntitlement.js';

const profile = { id: 'profile-1', organization_id: 'org-authoritative', role: 'OWNER', status: 'ACTIVE' };

function rpcClient(result: { data: unknown; error?: unknown }) {
  return { rpc: vi.fn(async () => ({ data: result.data, error: result.error ?? null })) };
}

describe('paid organization entitlement authorization', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts only the authoritative server result and scopes it to the resolved organization', async () => {
    const client = rpcClient({ data: true });
    await expect(checkPaidEntitlement(profile, client)).resolves.toEqual({ allowed: true });
    expect(client.rpc).toHaveBeenCalledWith('organization_has_active_paid_entitlement', {
      p_organization_id: 'org-authoritative',
    });
  });

  it.each([
    ['unpaid', false],
    ['pending payment', false],
    ['failed payment', false],
    ['expired period', false],
    ['fully refunded payment', false],
    ['invalid plan or payment identity', false],
    ['valid partial refund', true],
  ])('uses the database decision for %s state', async (_state, decision) => {
    await expect(checkPaidEntitlement(profile, rpcClient({ data: decision }))).resolves.toEqual(
      decision ? { allowed: true } : { allowed: false, reason: 'not_entitled' },
    );
  });

  it.each(['SUSPENDED', 'DISABLED', 'PENDING', 'PENDING_VERIFICATION'])(
    'denies a %s profile without querying billing state', async (status) => {
      const client = rpcClient({ data: true });
      await expect(checkPaidEntitlement({ ...profile, status }, client)).resolves.toEqual({
        allowed: false,
        reason: 'inactive_profile',
      });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it('fails closed on database errors, malformed responses and missing organization scope', async () => {
    await expect(checkPaidEntitlement(profile, rpcClient({ data: true, error: new Error('database down') })))
      .resolves.toEqual({ allowed: false, reason: 'unavailable' });
    await expect(checkPaidEntitlement(profile, {
      rpc: vi.fn(async () => { throw new Error('database connection unavailable'); }),
    })).resolves.toEqual({ allowed: false, reason: 'unavailable' });
    await expect(checkPaidEntitlement(profile, rpcClient({ data: null })))
      .resolves.toEqual({ allowed: false, reason: 'unavailable' });
    const client = rpcClient({ data: true });
    await expect(checkPaidEntitlement({ ...profile, organization_id: null }, client))
      .resolves.toEqual({ allowed: false, reason: 'missing_organization' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns consistent API responses for non-entitled and unavailable states', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await expect(requirePaidEntitlement(res, profile, rpcClient({ data: false }))).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });

    res.status.mockClear();
    res.json.mockClear();
    await expect(requirePaidEntitlement(res, profile, rpcClient({ data: null, error: true }))).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'PAID_ENTITLEMENT_UNAVAILABLE' });
  });

  it('treats absent paid and pilot access as not entitled while pilot grant administration is disabled', async () => {
    vi.stubEnv('FOUNDING_PILOT_GRANTS_ENABLED', 'false');
    const client = rpcClient({ data: false });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await expect(checkPaidEntitlement(profile, client)).resolves.toEqual({
      allowed: false,
      reason: 'not_entitled',
    });
    await expect(requirePaidEntitlement(res, profile, client)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });
    expect(client.rpc).toHaveBeenCalledWith('organization_has_active_paid_entitlement', {
      p_organization_id: profile.organization_id,
    });
  });

  it('preserves forbidden responses for inactive profiles and missing organization scope', async () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await expect(requirePaidEntitlement(res, { ...profile, status: 'DISABLED' }, rpcClient({ data: true })))
      .resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'ACCOUNT_NOT_ACTIVE' });

    res.status.mockClear();
    res.json.mockClear();
    await expect(requirePaidEntitlement(res, { ...profile, organization_id: null }, rpcClient({ data: true })))
      .resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'ORGANIZATION_REQUIRED' });
  });

  it('rechecks authoritative state for each request so expiry and renewal do not use a stale cache', async () => {
    const decisions = [true, false, true];
    const client = { rpc: vi.fn(async () => ({ data: decisions.shift(), error: null })) };
    await expect(checkPaidEntitlement(profile, client)).resolves.toEqual({ allowed: true });
    await expect(checkPaidEntitlement(profile, client)).resolves.toMatchObject({ allowed: false });
    await expect(checkPaidEntitlement(profile, client)).resolves.toEqual({ allowed: true });
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it('concurrent requests each consult the database rather than sharing cached entitlement state', async () => {
    let callCount = 0;
    const client = { rpc: vi.fn(async () => ({ data: ++callCount === 1, error: null })) };
    const results = await Promise.all([
      checkPaidEntitlement(profile, client),
      checkPaidEntitlement(profile, client),
    ]);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.allowed).sort()).toEqual([false, true]);
  });
});
