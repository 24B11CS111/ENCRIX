import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import refreshHandler from '../../api/_lib/publicRoutes/realtimeRefresh';
import * as supabaseServer from '../../api/_lib/supabaseServer';
import { Profile } from '@/types';

vi.mock('../../api/_lib/paidEntitlement.js', () => ({
  requirePaidEntitlement: vi.fn(async () => true),
}));

function createResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
}

describe('authenticated lead refresh polling endpoint', () => {
  const owner: Profile = {
    id: 'owner-profile', user_id: 'owner-user', organization_id: 'org-safe',
    full_name: 'Owner', role: 'OWNER', status: 'ACTIVE',
    created_at: '', updated_at: '',
  };
  let profile: Profile | null;
  let query: any;
  let authSpy: ReturnType<typeof vi.spyOn>;
  let clientSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    profile = owner;
    query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { revision: 8 }, error: null }),
    };
    authSpy = vi.spyOn(supabaseServer, 'authenticateServerRequest').mockImplementation(async () => ({
      user: profile ? { id: profile.user_id } : null,
      profile: profile as any,
      error: profile ? null : 'Unauthorized',
    }));
    clientSpy = vi.spyOn(supabaseServer, 'getSupabaseServerClient').mockReturnValue({
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: vi.fn(() => query),
    } as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { role: 'OWNER' as const, expectedRecipient: null },
    { role: 'ADMIN' as const, expectedRecipient: null },
    { role: 'TELECALLER' as const, expectedRecipient: 'own-profile' },
  ])('derives organization and cursor scope from the authenticated $role profile', async ({ role, expectedRecipient }) => {
    profile = { ...owner, role, id: role === 'TELECALLER' ? 'own-profile' : owner.id };
    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer verified-session' },
      query: { organization_id: 'attacker-org', profile_id: 'attacker-profile' },
    };
    const res = createResponse();

    await refreshHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ revision: 8 });
    expect(res.headers['Cache-Control']).toBe('no-store, private');
    expect(clientSpy).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-safe');
    if (expectedRecipient) expect(query.eq).toHaveBeenCalledWith('recipient_profile_id', expectedRecipient);
    else expect(query.is).toHaveBeenCalledWith('recipient_profile_id', null);
  });

  it('rejects anonymous and inactive identities before querying signals', async () => {
    profile = null;
    const denied = createResponse();
    await refreshHandler({ method: 'GET', headers: {} }, denied);
    expect(denied.statusCode).toBe(401);
    expect(clientSpy).not.toHaveBeenCalled();

    profile = { ...owner, status: 'DISABLED' };
    const inactive = createResponse();
    await refreshHandler({ method: 'GET', headers: { authorization: 'Bearer signed' } }, inactive);
    expect(inactive.statusCode).toBe(403);
    expect(clientSpy).not.toHaveBeenCalled();
  });

  it('does not expose signal rows and reports database errors as unavailable', async () => {
    query.maybeSingle.mockResolvedValue({
      data: { revision: 8, organization_id: 'org-safe', recipient_profile_id: null, phone: 'must-not-return' },
      error: { message: 'database unavailable' },
    });
    const res = createResponse();
    await refreshHandler({ method: 'GET', headers: { authorization: 'Bearer signed' } }, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('must-not-return');
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('allows only GET', async () => {
    const res = createResponse();
    await refreshHandler({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
    expect(authSpy).not.toHaveBeenCalled();
  });
});
