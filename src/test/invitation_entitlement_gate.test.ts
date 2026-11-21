import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  profile: null as any,
  rpcResult: { data: false as unknown, error: null as unknown },
  rpc: vi.fn(),
  insertedInvitations: [] as any[],
  sendInvitationEmail: vi.fn(),
  orgIds: [] as string[],
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: async () => ({ user: { id: 'user-1' }, profile: fixtures.profile, error: null }),
  getSupabaseServerClient: () => ({
    rpc: (...args: any[]) => fixtures.rpc(...args),
    from: (table: string) => makeTable(table),
  }),
  isRealSupabaseServerConfigured: () => true,
}));
vi.mock('../../api/_lib/emailDelivery.js', () => ({
  sendInvitationEmail: (...args: any[]) => fixtures.sendInvitationEmail(...args),
  sendFollowUpReminderEmail: vi.fn(),
}));

import handler from '../../api/_lib/authHandlers/invite';
import { clearServerInvitations } from '../../api/_lib/invitationServer';

function makeTable(table: string): any {
  if (table === 'profiles') {
    return { select: () => {
      const query: any = { ilike: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    } };
  }
  if (table === 'organizations') {
    return { select: () => ({ eq: (_column: string, value: string) => {
      fixtures.orgIds.push(value);
      return { single: async () => ({ data: { id: value, name: 'Test Organization' }, error: null }) };
    } }) };
  }
  if (table === 'organization_invitations') {
    return {
      update: () => {
        const query: any = { eq: () => query, lte: () => query, then: (resolve: any) => Promise.resolve({ error: null }).then(resolve) };
        return query;
      },
      select: () => {
        const query: any = { eq: () => query, ilike: () => query, gt: () => query, maybeSingle: async () => ({ data: null, error: null }) };
        return query;
      },
      insert: (row: any) => ({ select: () => ({ single: async () => {
        const inserted = { ...row, id: 'invite-1', created_at: new Date().toISOString() };
        fixtures.insertedInvitations.push(inserted);
        return { data: inserted, error: null };
      } }) }),
    };
  }
  return { insert: async () => ({ data: null, error: null }) };
}

function request(body: Record<string, unknown> = {}) {
  return {
    req: { method: 'POST', body, query: {}, headers: { host: 'pilot.example.test', 'x-forwarded-proto': 'https' } },
    res: {
      statusCode: 200,
      body: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(value: any) { this.body = value; return this; },
      setHeader() {},
    },
  };
}

describe('invite endpoint paid-entitlement integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServerInvitations();
    fixtures.profile = { id: 'owner-profile', user_id: 'user-1', organization_id: 'org-owner', role: 'OWNER', status: 'ACTIVE' };
    fixtures.rpcResult = { data: false, error: null };
    fixtures.rpc.mockImplementation(async (...args: any[]) => {
      fixtures.orgIds.push(args[1]?.p_organization_id);
      return fixtures.rpcResult;
    });
    fixtures.insertedInvitations = [];
    fixtures.orgIds = [];
    fixtures.sendInvitationEmail.mockResolvedValue({ id: 'synthetic-email-id' });
    process.env.APP_URL = 'https://pilot.example.test';
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => { delete process.env.APP_URL; });

  it('fails safely when the entitlement RPC is missing and persists nothing', async () => {
    fixtures.rpcResult = { data: null, error: { code: '42883', message: 'internal test fixture only' } };
    const { req, res } = request({ fullName: 'Pilot Caller', email: 'caller@example.test' });
    await handler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'PAID_ENTITLEMENT_UNAVAILABLE' });
    expect(fixtures.insertedInvitations).toHaveLength(0);
    expect(fixtures.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it.each(['inactive or unpaid', 'expired'])('rejects a valid boolean denial for an %s organization', async () => {
    fixtures.rpcResult = { data: false, error: null };
    const { req, res } = request({ fullName: 'Pilot Caller', email: 'caller@example.test' });
    await handler(req, res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });
    expect(fixtures.insertedInvitations).toHaveLength(0);
  });

  it('allows a database-approved entitlement and ignores a caller-supplied organization ID', async () => {
    fixtures.rpcResult = { data: true, error: null };
    const { req, res } = request({
      fullName: 'Pilot Caller', email: 'caller@example.test', organizationId: 'org-victim',
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(fixtures.rpc).toHaveBeenCalledWith('organization_has_active_paid_entitlement', {
      p_organization_id: 'org-owner',
    });
    expect(fixtures.insertedInvitations[0]?.organization_id).toBe('org-owner');
    expect(fixtures.orgIds).not.toContain('org-victim');
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects telecallers before checking entitlement or writing an invitation', async () => {
    fixtures.profile = { ...fixtures.profile, role: 'TELECALLER' };
    const { req, res } = request({ fullName: 'Pilot Caller', email: 'caller@example.test' });
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(fixtures.rpc).not.toHaveBeenCalled();
    expect(fixtures.insertedInvitations).toHaveLength(0);
  });
});
