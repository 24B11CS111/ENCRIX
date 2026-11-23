import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  profile: null as any,
  rpcResult: { data: false as unknown, error: null as unknown },
  rpc: vi.fn(),
  insertedInvitations: [] as any[],
  sendInvitationEmail: vi.fn(),
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: async () => ({
    user: { id: 'user-owner' },
    profile: fixtures.profile,
    error: null,
  }),
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
    return {
      select: () => {
        const query: any = {
          ilike: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      },
    };
  }
  if (table === 'organizations') {
    return {
      select: () => ({
        eq: (_column: string, value: string) => ({
          single: async () => ({ data: { id: value, name: 'HRIX Business Workspace' }, error: null }),
        }),
      }),
    };
  }
  if (table === 'organization_invitations') {
    return {
      update: () => {
        const query: any = {
          eq: () => query,
          lte: () => query,
          then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
        };
        return query;
      },
      select: () => {
        const query: any = {
          eq: () => query,
          ilike: () => query,
          gt: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      },
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            const inserted = { ...row, id: 'inv-test-id-1', created_at: new Date().toISOString() };
            fixtures.insertedInvitations.push(inserted);
            return { data: inserted, error: null };
          },
        }),
      }),
    };
  }
  return { insert: async () => ({ data: null, error: null }) };
}

function createRequest(body: Record<string, unknown> = {}) {
  return {
    req: {
      method: 'POST',
      body,
      query: {},
      headers: { host: 'encrix.example.test', 'x-forwarded-proto': 'https' },
    },
    res: {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: any) {
        this.body = value;
        return this;
      },
      setHeader() {},
    },
  };
}

describe('Plan & Entitlement Rules Matrix for Telecaller Invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServerInvitations();
    fixtures.profile = {
      id: 'owner-prof-uuid',
      user_id: 'user-owner-uuid',
      organization_id: 'org-hrix-uuid',
      role: 'OWNER',
      status: 'ACTIVE',
      email: 'owner@hrix.test',
    };
    fixtures.rpcResult = { data: false, error: null };
    fixtures.rpc.mockImplementation(async () => fixtures.rpcResult);
    fixtures.insertedInvitations = [];
    fixtures.sendInvitationEmail.mockResolvedValue({ id: 'msg-uuid-1' });
    process.env.APP_URL = 'https://encrix.example.test';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.APP_URL;
  });

  it('1. Free / Unpaid plan organizations are strictly blocked with 402 ACTIVE_SUBSCRIPTION_REQUIRED', async () => {
    // Unpaid organization: RPC returns boolean false
    fixtures.rpcResult = { data: false, error: null };
    const { req, res } = createRequest({
      fullName: 'New Telecaller',
      email: 'telecaller@hrix.test',
      phone: '+1 555-010-1234',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });
    expect(fixtures.insertedInvitations).toHaveLength(0);
    expect(fixtures.sendInvitationEmail).not.toHaveBeenCalled();
    expect(fixtures.rpc).toHaveBeenCalledWith('organization_has_active_paid_entitlement', {
      p_organization_id: 'org-hrix-uuid',
    });
  });

  it('2. Missing or crashing RPC on production fails closed with 503 PAID_ENTITLEMENT_UNAVAILABLE', async () => {
    // Database schema missing or RPC failure returns an error
    fixtures.rpcResult = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    const { req, res } = createRequest({
      fullName: 'New Telecaller',
      email: 'telecaller@hrix.test',
      phone: '+1 555-010-1234',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'PAID_ENTITLEMENT_UNAVAILABLE' });
    expect(fixtures.insertedInvitations).toHaveLength(0);
    expect(fixtures.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('3. Business plan organizations with active subscription are allowed to invite telecallers (HTTP 200)', async () => {
    // Paid business organization: RPC returns boolean true
    fixtures.rpcResult = { data: true, error: null };
    const { req, res } = createRequest({
      fullName: 'Ramesh Telecaller',
      email: 'ramesh@hrix.test',
      phone: '+1 555-010-5678',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.invitation).toBeDefined();
    expect(res.body.invitation.email).toBe('ramesh@hrix.test');
    expect(fixtures.insertedInvitations).toHaveLength(1);
    expect(fixtures.insertedInvitations[0].organization_id).toBe('org-hrix-uuid');
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('4. Founding pilot organizations with active grant are allowed to invite telecallers (HTTP 200)', async () => {
    // Founding pilot grant: RPC evaluates pilot table and returns boolean true
    fixtures.rpcResult = { data: true, error: null };
    const { req, res } = createRequest({
      fullName: 'Pilot Telecaller',
      email: 'pilot.tc@hrix.test',
    });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fixtures.insertedInvitations).toHaveLength(1);
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('5. Inactive profiles, non-owner roles, and unassigned organizations are blocked before checking entitlement', async () => {
    // Non-owner role (Telecaller)
    fixtures.profile = { ...fixtures.profile, role: 'TELECALLER' };
    const { req: tcReq, res: tcRes } = createRequest({ fullName: 'Another', email: 'test@hrix.test' });
    await handler(tcReq, tcRes);
    expect(tcRes.statusCode).toBe(403);
    expect(tcRes.body.error).toContain('Forbidden');
    expect(fixtures.rpc).not.toHaveBeenCalled();

    // Inactive profile
    fixtures.profile = { ...fixtures.profile, role: 'OWNER', status: 'DISABLED' };
    const { req: inactReq, res: inactRes } = createRequest({ fullName: 'Another', email: 'test@hrix.test' });
    await handler(inactReq, inactRes);
    expect(inactRes.statusCode).toBe(403);
    expect(inactRes.body.error).toContain('inactive or suspended');
    expect(fixtures.rpc).not.toHaveBeenCalled();

    // Missing organization
    fixtures.profile = { ...fixtures.profile, role: 'OWNER', status: 'ACTIVE', organization_id: null };
    const { req: noOrgReq, res: noOrgRes } = createRequest({ fullName: 'Another', email: 'test@hrix.test' });
    await handler(noOrgReq, noOrgRes);
    expect(noOrgRes.statusCode).toBe(403);
    expect(noOrgRes.body.error).toContain('not assigned to an organization');
    expect(fixtures.rpc).not.toHaveBeenCalled();
  });
});
