import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateServerRequest: vi.fn(),
  getSupabaseServerClient: vi.fn(),
  entitlementRpc: vi.fn(),
  isRealSupabaseServerConfigured: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  profile: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organization_id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Owner One',
    role: 'OWNER',
    status: 'ACTIVE',
  },
  persisted: [] as any[],
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: mocks.authenticateServerRequest,
  getSupabaseServerClient: mocks.getSupabaseServerClient,
  isRealSupabaseServerConfigured: mocks.isRealSupabaseServerConfigured,
}));

import ownerHandler from '../../api/_lib/leads/owner';
import telecallerHandler from '../../api/_lib/leads/telecaller';

function request(method: string, body: any = {}, route = 'owner-list') {
  const req = { method, body, query: { _route: route }, headers: { authorization: 'Bearer test' } };
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) { this.statusCode = code; return this; },
    json(value: any) { this.body = value; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
  };
  return { req, res };
}

const validImport = {
  action: 'import',
  importId: '12345678-1234-4234-8234-123456789abc',
  rows: [{ rowIndex: 1, name: 'Lead One', phone: '+91 98765 43210', source: 'CSV', priority: 'HIGH' }],
};

describe('owner CSV lead import persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persisted = [];
    mocks.profile = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      organization_id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Owner One', role: 'OWNER', status: 'ACTIVE',
    };
    mocks.authenticateServerRequest.mockResolvedValue({ user: { id: mocks.profile.user_id }, profile: mocks.profile, error: null });
    mocks.isRealSupabaseServerConfigured.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({
      data: { imported_count: 1, duplicate_row_indexes: [], distribution: null },
      error: null,
    });
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      then: (resolve: (value: any) => unknown) => resolve({ data: mocks.persisted, error: null }),
    };
    mocks.from.mockReturnValue(query);
    mocks.entitlementRpc.mockResolvedValue({ data: true, error: null });
    mocks.getSupabaseServerClient.mockReturnValue({
      rpc: async (name: string, args: any) => name === 'organization_has_active_paid_entitlement'
        ? mocks.entitlementRpc(name, args)
        : mocks.rpc(name, args),
      from: mocks.from,
    });
  });

  it('persists via the authenticated RPC using the verified organization, and survives a subsequent list reload', async () => {
    mocks.rpc.mockImplementation(async (_name: string, args: any) => {
      const row = args.p_rows[0];
      mocks.persisted.push({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        organization_id: args.p_organization_id,
        name: row.name,
        phone: row.phone,
        status: 'NEW',
      });
      return { data: { imported_count: 1, duplicate_row_indexes: [], distribution: null }, error: null };
    });
    const post = request('POST', { ...validImport, organization_id: '22222222-2222-4222-8222-222222222222' });
    await ownerHandler(post.req, post.res);

    expect(post.res.statusCode).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('import_owner_leads', expect.objectContaining({
      p_organization_id: mocks.profile.organization_id,
      p_actor_profile_id: mocks.profile.id,
      p_rows: [expect.objectContaining({ row_index: 1, phone: '+91 98765 43210' })],
    }));
    expect(JSON.stringify(post.res.body)).not.toContain('+91 98765 43210');

    const reload = request('GET');
    await ownerHandler(reload.req, reload.res);
    expect(reload.res.body.leads).toHaveLength(1);
    expect(reload.res.body.leads[0].name).toBe('Lead One');
  });

  it('rejects non-owner callers before reaching persistence', async () => {
    mocks.profile = { ...mocks.profile, role: 'TELECALLER' };
    mocks.authenticateServerRequest.mockResolvedValue({ user: { id: mocks.profile.user_id }, profile: mocks.profile, error: null });
    const { req, res } = request('POST', validImport);
    await ownerHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('isolates tenant identity from caller-supplied organization fields', async () => {
    const { req, res } = request('POST', { ...validImport, organizationId: '22222222-2222-4222-8222-222222222222' });
    await ownerHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_organization_id).toBe(mocks.profile.organization_id);
  });

  it('reports duplicate and invalid rows separately and sends only valid rows to the RPC', async () => {
    const { req, res } = request('POST', {
      ...validImport,
      rows: [
        { rowIndex: 1, name: 'First', phone: '9876543210' },
        { rowIndex: 2, name: 'Duplicate', phone: '98 765 43210' },
        { rowIndex: 3, name: '', phone: '12345' },
      ],
    });
    await ownerHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.importedCount).toBe(1);
    expect(res.body.duplicateRowIndexes).toEqual([2]);
    expect(res.body.rejectedRows).toEqual([expect.objectContaining({ rowIndex: 3 })]);
    expect(mocks.rpc.mock.calls[0][1].p_rows).toHaveLength(1);
  });

  it('routes manual owner lead creation through the same tenant-locked RPC path', async () => {
    const createdLead = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      organization_id: mocks.profile.organization_id,
      name: 'Manual lead',
      phone: '+91 90000 00001',
    };
    mocks.rpc.mockResolvedValue({ data: { lead: createdLead }, error: null });
    const { req, res } = request('POST', {
      action: 'create',
      name: 'Manual lead',
      phone: '+91 90000 00001',
    }, 'owner-create');
    await ownerHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.lead).toEqual(createdLead);
    expect(mocks.rpc).toHaveBeenCalledWith('create_owner_lead', expect.objectContaining({
      p_organization_id: mocks.profile.organization_id,
      p_actor_profile_id: mocks.profile.id,
      p_phone: '+91 90000 00001',
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('blocks CRM access before lead reads or writes when the organization is not entitled', async () => {
    mocks.entitlementRpc.mockResolvedValueOnce({ data: false, error: null });
    const { req, res } = request('POST', validImport, 'owner-list');
    await ownerHandler(req, res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });
    expect(mocks.entitlementRpc).toHaveBeenCalledWith(
      'organization_has_active_paid_entitlement',
      { p_organization_id: mocks.profile.organization_id },
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns a clear conflict when manual creation races with an existing organization phone', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate phone' } });
    const { req, res } = request('POST', {
      action: 'create',
      name: 'Duplicate lead',
      phone: '919000000001',
    }, 'owner-create');
    await ownerHandler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(mocks.rpc).toHaveBeenCalledWith('create_owner_lead', expect.any(Object));
  });

  it('never returns raw phone values from the telecaller endpoint', async () => {
    mocks.profile = { ...mocks.profile, role: 'TELECALLER' };
    mocks.authenticateServerRequest.mockResolvedValue({ user: { id: mocks.profile.user_id }, profile: mocks.profile, error: null });
    mocks.rpc.mockResolvedValue({ data: [{ id: 'lead-id', name: 'Lead', phone: '+91 98765 43210' }], error: null });
    const { req, res } = request('GET', {}, 'telecaller-list');
    req.query = { _route: 'telecaller-list' };
    await telecallerHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('+91 98765 43210');
  });
});
