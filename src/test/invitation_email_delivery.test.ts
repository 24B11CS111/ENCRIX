import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  authResult: null as any,
  realDb: true,
  rows: [] as any[],
  sendInvitationEmail: vi.fn(),
}));
vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: async () => fixtures.authResult,
  getSupabaseServerClient: () => makeClient(),
  isRealSupabaseServerConfigured: () => fixtures.realDb,
}));
vi.mock('../../api/_lib/paidEntitlement.js', () => ({ requirePaidEntitlement: async () => true }));
vi.mock('../../api/_lib/emailDelivery.js', () => ({
  sendInvitationEmail: (...args: any[]) => fixtures.sendInvitationEmail(...args),
  sendFollowUpReminderEmail: vi.fn(),
}));

import handler from '../../api/_lib/authHandlers/invite';
import { clearServerInvitations, storeServerInvitation } from '../../api/_lib/invitationServer';

function makeClient() {
  return {
    from(table: string) {
      if (table === 'profiles') return {
        select: () => {
          const query: any = { eq: () => query, ilike: () => query, maybeSingle: async () => ({ data: null, error: null }) };
          return query;
        },
      };
      if (table === 'organizations') return {
        select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'org-1', name: 'Northwind' }, error: null }) }) }),
      };
      if (table === 'organization_invitations') return {
        update: (updates: any) => {
          let selected = [...fixtures.rows];
          const query: any = {
            eq: (field: string, value: any) => { selected = selected.filter((row) => row[field] === value); return query; },
            lte: (field: string, value: any) => { selected = selected.filter((row) => String(row[field]) <= String(value)); return query; },
            then: (resolve: any) => {
              for (const row of selected) Object.assign(row, updates);
              return Promise.resolve({ data: selected, error: null }).then(resolve);
            },
          };
          return query;
        },
        select: () => {
          let selected = [...fixtures.rows];
          const query: any = {
            eq: (field: string, value: any) => { selected = selected.filter((row) => row[field] === value); return query; },
            ilike: (field: string, value: string) => { selected = selected.filter((row) => String(row[field]).toLowerCase() === value.toLowerCase()); return query; },
            gt: (field: string, value: any) => { selected = selected.filter((row) => String(row[field]) > String(value)); return query; },
            maybeSingle: async () => ({ data: selected[0] || null, error: null }),
          };
          return query;
        },
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              const duplicate = fixtures.rows.some((existing) => existing.organization_id === row.organization_id && existing.email === row.email && existing.status === 'PENDING');
              if (duplicate) return { data: null, error: { code: '23505' } };
              const inserted = { ...row, id: `invite-${fixtures.rows.length + 1}`, created_at: new Date().toISOString() };
              fixtures.rows.push(inserted);
              return { data: inserted, error: null };
            },
          }),
        }),
      };
      return { insert: async () => ({ data: null, error: null }) };
    },
  };
}

function request(method = 'POST', body: any = {}, query: any = {}) {
  return {
    req: { method, body, query, headers: { host: 'staging.example.test', 'x-forwarded-proto': 'https' } },
    res: {
      statusCode: 200,
      body: null as any,
      headers: {} as Record<string, string>,
      status(code: number) { this.statusCode = code; return this; },
      json(value: any) { this.body = value; return this; },
      setHeader(key: string, value: string) { this.headers[key] = value; },
    },
  };
}

describe('invitation email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearServerInvitations();
    fixtures.realDb = true;
    fixtures.rows = [];
    fixtures.authResult = { profile: {
      id: 'owner-profile', organization_id: 'org-1', full_name: 'Owner', role: 'OWNER', status: 'ACTIVE',
    }, error: null };
    fixtures.sendInvitationEmail.mockResolvedValue({ id: 'email-id' });
    process.env.APP_URL = 'https://staging.example.test';
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => { delete process.env.APP_URL; });

  it('sends the email-bound organization invitation and reports delivery only after provider success', async () => {
    const { req, res } = request('POST', { fullName: 'Test Caller', email: 'Caller@Example.test' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.emailSent).toBe(true);
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipient: 'caller@example.test',
      recipientName: 'Test Caller',
      organizationName: 'Northwind',
      expiresAt: expect.any(String),
      inviteUrl: expect.stringMatching(/^https:\/\/staging\.example\.test\/accept-invitation\?token=inv_/),
    }));
    expect(fixtures.rows[0]).toMatchObject({ organization_id: 'org-1', email: 'caller@example.test', role: 'TELECALLER', status: 'PENDING' });
  });

  it('rejects an invalid address without persisting or sending', async () => {
    const { req, res } = request('POST', { fullName: 'Test Caller', email: 'not-an-email' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(fixtures.rows).toHaveLength(0);
    expect(fixtures.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('reuses one unexpired pending invitation on duplicate requests', async () => {
    const first = request('POST', { fullName: 'Test Caller', email: 'caller@example.test' });
    await handler(first.req, first.res);
    const second = request('POST', { fullName: 'Test Caller', email: 'caller@example.test' });
    await handler(second.req, second.res);
    expect(first.res.statusCode).toBe(200);
    expect(second.res.statusCode).toBe(200);
    expect(fixtures.rows).toHaveLength(1);
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledTimes(2);
    expect(second.res.body.invitation.id).toBe(first.res.body.invitation.id);
    expect(second.res.body.invitation.inviteUrl).toBe(first.res.body.invitation.inviteUrl);
  });

  it('expires stale pending rows before creating a replacement invitation', async () => {
    fixtures.rows.push({
      id: 'expired-pending', organization_id: 'org-1', email: 'stale@example.test',
      full_name: 'Old Caller', phone_number: null, invited_by: 'owner-profile', role: 'TELECALLER',
      status: 'PENDING', token: 'inv_expired_pending_token', expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const { req, res } = request('POST', { fullName: 'New Caller', email: 'stale@example.test' });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(fixtures.rows[0].status).toBe('EXPIRED');
    expect(fixtures.rows.filter((row) => row.email === 'stale@example.test' && row.status === 'PENDING')).toHaveLength(1);
    expect(fixtures.sendInvitationEmail).toHaveBeenCalledTimes(1);
  });

  it('does not claim delivery on provider failure and safely retries the persisted link', async () => {
    fixtures.sendInvitationEmail.mockRejectedValueOnce(Object.assign(new Error('private provider data'), { code: 'EMAIL_PROVIDER_UNAVAILABLE' }));
    const first = request('POST', { fullName: 'Test Caller', email: 'caller@example.test' });
    await handler(first.req, first.res);
    expect(first.res.statusCode).toBe(502);
    expect(first.res.body.emailSent).toBeUndefined();
    expect(JSON.stringify(first.res.body)).not.toContain('private provider data');
    expect(first.res.body.invitation).toBeUndefined();
    const second = request('POST', { fullName: 'Test Caller', email: 'caller@example.test' });
    await handler(second.req, second.res);
    expect(second.res.statusCode).toBe(200);
    expect(fixtures.rows).toHaveLength(1);
  });

  it('rejects an unauthorized inviter before persistence or email delivery', async () => {
    fixtures.authResult = { profile: { id: 'telecaller', organization_id: 'org-1', role: 'TELECALLER', status: 'ACTIVE' }, error: null };
    const { req, res } = request('POST', { fullName: 'Test Caller', email: 'caller@example.test' });
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(fixtures.rows).toHaveLength(0);
    expect(fixtures.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it('rejects expired invitation links as single-use links', async () => {
    fixtures.realDb = false;
    storeServerInvitation({
      id: 'expired', organization_id: 'org-1', full_name: 'Test Caller', email: 'caller@example.test',
      invited_by: 'owner', role: 'TELECALLER', status: 'PENDING', token: 'inv_expired_token_123456',
      expires_at: new Date(Date.now() - 60_000).toISOString(), created_at: new Date().toISOString(),
    });
    const { req, res } = request('GET', {}, { token: 'inv_expired_token_123456' });
    await handler(req, res);
    expect(res.statusCode).toBe(410);
  });
});
