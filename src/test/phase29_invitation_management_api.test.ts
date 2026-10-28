import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import invitationsHandler from '../../api/auth/invitations';
import inviteHandler from '../../api/auth/invite';
import sendOtpHandler from '../../api/auth/send-otp';
import verifyOtpHandler from '../../api/auth/verify-otp';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import {
  clearServerInvitations,
  storeServerInvitation,
  getServerInvitation,
} from '../../api/_lib/invitationServer';
import { serverOtpStore, hashOtp } from '../../api/_lib/otpServer';
import { authService } from '../../src/services/auth/authService';

function createMockReqRes(options: {
  method?: string;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}) {
  const headers = { ...(options.headers || {}) };
  const req = {
    method: options.method || 'GET',
    query: options.query || {},
    body: options.body || {},
    headers,
  };

  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
  };

  return { req, res };
}

describe('ENCRIX Phase 29: Production-Ready Invitation Management API', () => {
  const originalEnv = { ...process.env };

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';
  const ownerUserId = '33333333-3333-4333-8333-333333333333';
  const ownerProfileId = '44444444-4444-4444-8444-444444444444';
  const telecallerUserId = '55555555-5555-4555-8555-555555555555';
  const telecallerProfileId = '66666666-6666-4666-8666-666666666666';

  let mockInvitationsDb: any[] = [];
  let mockSupabase: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    clearServerInvitations();
    serverOtpStore.clear();

    process.env = { ...originalEnv };
    process.env.OTP_SERVER_SECRET = 'c8f7e2a1b4d3e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0';
    process.env.SESSION_SERVER_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.VITE_SUPABASE_URL;

    // Seed mock DB table
    mockInvitationsDb = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        organization_id: orgA,
        full_name: 'Caller Alpha',
        email: 'alpha@encrix.io',
        phone_number: '+919876543210',
        invited_by: ownerProfileId,
        role: 'TELECALLER',
        status: 'PENDING',
        token: 'inv_alpha_pending_token_12345',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        organization_id: orgA,
        full_name: 'Caller Beta',
        email: 'beta@encrix.io',
        phone_number: '+919876543211',
        invited_by: ownerProfileId,
        role: 'TELECALLER',
        status: 'ACCEPTED',
        token: 'inv_beta_accepted_token_12345',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        organization_id: orgB,
        full_name: 'Caller Gamma (Org B)',
        email: 'gamma@orgb.io',
        phone_number: '+919876543212',
        invited_by: '99999999-9999-4999-8999-999999999999',
        role: 'TELECALLER',
        status: 'PENDING',
        token: 'inv_gamma_pending_token_12345',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date(Date.now() - 1800000).toISOString(),
      },
    ];

    // Build mock Supabase client
    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field: string, val: string) => ({
                single: vi.fn(async () => {
                  if (val === ownerProfileId) {
                    return {
                      data: {
                        id: ownerProfileId,
                        user_id: ownerUserId,
                        organization_id: orgA,
                        full_name: 'Owner Jane',
                        role: 'OWNER',
                        status: 'ACTIVE',
                        email: 'owner@encrix.io',
                      },
                      error: null,
                    };
                  }
                  if (val === telecallerProfileId) {
                    return {
                      data: {
                        id: telecallerProfileId,
                        user_id: telecallerUserId,
                        organization_id: orgA,
                        full_name: 'Caller Bob',
                        role: 'TELECALLER',
                        status: 'ACTIVE',
                        email: 'caller@encrix.io',
                      },
                      error: null,
                    };
                  }
                  return { data: null, error: { message: 'Profile not found' } };
                }),
                maybeSingle: vi.fn(async () => {
                  return { data: null, error: null };
                }),
              })),
            })),
          };
        }

        if (table === 'organization_invitations') {
          return {
            select: vi.fn((cols: string) => {
              const colList = cols && cols !== '*' ? cols.split(',').map((c) => c.trim()) : null;
              let filtered = [...mockInvitationsDb];

              const projectRow = (row: any) => {
                if (!row || !colList) return row;
                const projected: any = {};
                for (const c of colList) {
                  if (c in row) projected[c] = row[c];
                }
                return projected;
              };

              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((row) => row[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                maybeSingle: vi.fn(async () => {
                  return { data: projectRow(filtered[0]) || null, error: null };
                }),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: projectRow(filtered[0]), error: null };
                  return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
                }),
                then: (resolve: any) => resolve({ data: filtered.map(projectRow), error: null }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newRow = {
                    ...row,
                    id: row.id || 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                    created_at: new Date().toISOString(),
                  };
                  mockInvitationsDb.push(newRow);
                  return { data: newRow, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              let requiredStatus: string | null = null;
              let requiredOrg: string | null = null;

              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') targetId = val;
                  if (field === 'status') requiredStatus = val;
                  if (field === 'organization_id') requiredOrg = val;
                  return builder;
                }),
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => {
                    const idx = mockInvitationsDb.findIndex((row) => {
                      if (targetId && row.id !== targetId) return false;
                      if (requiredStatus && row.status !== requiredStatus) return false;
                      if (requiredOrg && row.organization_id !== requiredOrg) return false;
                      return true;
                    });
                    if (idx === -1) {
                      return { data: null, error: null };
                    }
                    mockInvitationsDb[idx] = { ...mockInvitationsDb[idx], ...updates };
                    return { data: mockInvitationsDb[idx], error: null };
                  }),
                })),
              };
              return builder;
            }),
          };
        }

        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: orgA, name: 'ENCRIX Organization A' },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'security_events' || table === 'activity_logs') {
          return {
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }

        return {};
      }),
    };

    vi.spyOn(supabaseServerModule, 'getSupabaseServerClient').mockReturnValue(mockSupabase);
    vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createOwnerSession(overrides?: Partial<Parameters<typeof createSignedSessionToken>[0]>) {
    return createSignedSessionToken({
      userId: ownerUserId,
      profileId: ownerProfileId,
      organizationId: orgA,
      role: 'OWNER',
      email: 'owner@encrix.io',
      fullName: 'Owner Jane',
      status: 'ACTIVE',
      ...overrides,
    });
  }

  function createTelecallerSession(overrides?: Partial<Parameters<typeof createSignedSessionToken>[0]>) {
    return createSignedSessionToken({
      userId: telecallerUserId,
      profileId: telecallerProfileId,
      organizationId: orgA,
      role: 'TELECALLER',
      email: 'caller@encrix.io',
      fullName: 'Caller Bob',
      status: 'ACTIVE',
      ...overrides,
    });
  }

  // =========================================================================
  // 1. Unauthenticated requests are rejected
  // =========================================================================
  it('1. rejects unauthenticated requests with 401 Unauthorized', async () => {
    // GET /api/auth/invitations
    const { req: getReq, res: getRes } = createMockReqRes({ method: 'GET' });
    await invitationsHandler(getReq, getRes);
    expect(getRes.statusCode).toBe(401);
    expect(getRes.body.error).toContain('Authorization');

    // DELETE /api/auth/invitations
    const { req: delReq, res: delRes } = createMockReqRes({
      method: 'DELETE',
      body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
    await invitationsHandler(delReq, delRes);
    expect(delRes.statusCode).toBe(401);

    // POST /api/auth/invite
    const { req: postReq, res: postRes } = createMockReqRes({
      method: 'POST',
      body: { fullName: 'New Caller', email: 'caller@encrix.io' },
    });
    await inviteHandler(postReq, postRes);
    expect(postRes.statusCode).toBe(401);
  });

  // =========================================================================
  // 2. Inactive accounts are rejected
  // =========================================================================
  it('2. rejects inactive / disabled / suspended accounts with 403', async () => {
    const disabledToken = createOwnerSession({ status: 'DISABLED' });

    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { Authorization: `Bearer ${disabledToken}` },
    });
    await invitationsHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('Account is not active');
  });

  // =========================================================================
  // 3. Telecallers cannot list or revoke invitations
  // =========================================================================
  it('3. telecallers cannot list or revoke invitations (role-based rejection)', async () => {
    const telecallerToken = createTelecallerSession();

    // Listing attempt by telecaller
    const { req: listReq, res: listRes } = createMockReqRes({
      method: 'GET',
      headers: { Authorization: `Bearer ${telecallerToken}` },
    });
    await invitationsHandler(listReq, listRes);
    expect(listRes.statusCode).toBe(403);
    expect(listRes.body.error).toContain('Only organization owners or administrators can manage invitations');

    // Revoking attempt by telecaller
    const { req: revokeReq, res: revokeRes } = createMockReqRes({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${telecallerToken}` },
      body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
    await invitationsHandler(revokeReq, revokeRes);
    expect(revokeRes.statusCode).toBe(403);
    expect(revokeRes.body.error).toContain('Only organization owners or administrators can manage invitations');
  });

  // =========================================================================
  // 4. Owners can list only their own organization's invitations
  // =========================================================================
  it('4. owners can list only their own organization invitations (tenant isolation)', async () => {
    const ownerToken = createOwnerSession();

    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body.invitations).toBeDefined();

    // Must include orgA invitations
    const orgAInvs = res.body.invitations.filter((i: any) => i.organization_id === orgA);
    expect(orgAInvs.length).toBe(2);

    // Must strictly exclude orgB invitations
    const orgBInvs = res.body.invitations.filter((i: any) => i.organization_id === orgB);
    expect(orgBInvs.length).toBe(0);

    // Verify phone numbers are not unnecessarily returned
    for (const inv of res.body.invitations) {
      expect(inv.phone_number).toBeUndefined();
      expect(inv.inviteUrl).toContain('/accept-invitation?token=');
    }
  });

  // =========================================================================
  // 5. An owner cannot revoke an invitation belonging to another organization
  // =========================================================================
  it('5. an owner cannot revoke an invitation belonging to another organization', async () => {
    const ownerToken = createOwnerSession(); // orgA

    // Target Gamma in orgB
    const { req, res } = createMockReqRes({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('Pending invitation not found or you do not have permission to revoke it');

    // Confirm Gamma is still PENDING in DB
    const gamma = mockInvitationsDb.find((r) => r.id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(gamma.status).toBe('PENDING');
  });

  // =========================================================================
  // 6. Only pending invitations can be revoked
  // =========================================================================
  it('6. only pending invitations can be revoked (rejects accepted/revoked)', async () => {
    const ownerToken = createOwnerSession();

    // Target Beta (already ACCEPTED in orgA)
    const { req, res } = createMockReqRes({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('Pending invitation not found');

    // Confirm Beta status remained ACCEPTED
    const beta = mockInvitationsDb.find((r) => r.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(beta.status).toBe('ACCEPTED');
  });

  // =========================================================================
  // 7. Malformed invitation IDs are rejected
  // =========================================================================
  it('7. malformed invitation IDs are rejected with 400', async () => {
    const ownerToken = createOwnerSession();

    const badIds = ['not-a-uuid', '12345', 'DROP TABLE organization_invitations', '', null];
    for (const badId of badIds) {
      const { req, res } = createMockReqRes({
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: { id: badId },
      });
      await invitationsHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('A valid invitation ID is required');
    }
  });

  // =========================================================================
  // 8. Unsupported HTTP methods return 405 with Allow header
  // =========================================================================
  it('8. unsupported HTTP methods return 405 with Allow: GET, DELETE', async () => {
    const { req: postReq, res: postRes } = createMockReqRes({ method: 'POST' });
    await invitationsHandler(postReq, postRes);
    expect(postRes.statusCode).toBe(405);
    expect(postRes.headers['Allow']).toBe('GET, DELETE');

    const { req: putReq, res: putRes } = createMockReqRes({ method: 'PUT' });
    await invitationsHandler(putReq, putRes);
    expect(putRes.statusCode).toBe(405);
    expect(putRes.headers['Allow']).toBe('GET, DELETE');
  });

  // =========================================================================
  // 9. Database errors return safe responses
  // =========================================================================
  it('9. database errors return safe responses without exposing internals', async () => {
    const ownerToken = createOwnerSession();

    // Mock DB failure
    mockSupabase.from = vi.fn(() => ({
      select: vi.fn(() => {
        const queryBuilder: any = {
          order: vi.fn(() => queryBuilder),
          eq: vi.fn(() => queryBuilder),
          then: (resolve: any) =>
            resolve({ data: null, error: { code: 'PGRST500', message: 'connection timeout' } }),
        };
        return queryBuilder;
      }),
    }));

    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Unable to load invitations from the database.');
    expect(res.body.message).toBeUndefined();
    expect(res.body.stack).toBeUndefined();
  });

  // =========================================================================
  // 10. Missing Supabase configuration fails closed
  // =========================================================================
  it('10. missing Supabase configuration fails closed with 503', async () => {
    const ownerToken = createOwnerSession();

    // Supabase unavailable
    vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('Invitation management requires a configured database');
  });

  // =========================================================================
  // 11. Public invitation lookup rejects revoked and expired invitations
  // =========================================================================
  it('11. public invitation lookup rejects revoked and expired invitations', async () => {
    // 11a. Revoked invitation
    mockInvitationsDb.push({
      id: 'revoked-uuid-1',
      organization_id: orgA,
      full_name: 'Revoked Person',
      email: 'revoked@encrix.io',
      token: 'inv_public_revoked_token',
      status: 'REVOKED',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const { req: revReq, res: revRes } = createMockReqRes({
      method: 'GET',
      query: { token: 'inv_public_revoked_token' },
    });
    await inviteHandler(revReq, revRes);
    expect(revRes.statusCode).toBe(403);
    expect(revRes.body.code).toBe('REVOKED');
    expect(revRes.body.error).toContain('revoked');

    // 11b. Expired invitation
    mockInvitationsDb.push({
      id: 'expired-uuid-1',
      organization_id: orgA,
      full_name: 'Expired Person',
      email: 'expired@encrix.io',
      token: 'inv_public_expired_token',
      status: 'PENDING',
      expires_at: new Date(Date.now() - 5000).toISOString(), // expired
      created_at: new Date(Date.now() - 10000).toISOString(),
    });

    const { req: expReq, res: expRes } = createMockReqRes({
      method: 'GET',
      query: { token: 'inv_public_expired_token' },
    });
    await inviteHandler(expReq, expRes);
    expect(expRes.statusCode).toBe(410);
    expect(expRes.body.code).toBe('EXPIRED');
    expect(expRes.body.error).toContain('expired');
  });

  // =========================================================================
  // 12. OTP sending and verification reject revoked invitations
  // =========================================================================
  it('12. OTP sending and verification reject revoked invitations', async () => {
    const revokedToken = 'inv_otp_revoked_token';
    mockInvitationsDb.push({
      id: 'revoked-otp-uuid',
      organization_id: orgA,
      full_name: 'Revoked Caller',
      email: 'revokedcaller@encrix.io',
      token: revokedToken,
      status: 'REVOKED',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    // Attempt to request OTP for revoked invitation
    const { req: sReq, res: sRes } = createMockReqRes({
      method: 'POST',
      body: {
        purpose: 'INVITATION',
        email: 'revokedcaller@encrix.io',
        inviteToken: revokedToken,
      },
    });
    await sendOtpHandler(sReq, sRes);
    expect(sRes.statusCode).toBe(403);
    expect(sRes.body.error).toContain('revoked');

    // Attempt to verify OTP for revoked invitation
    const { req: vReq, res: vRes } = createMockReqRes({
      method: 'POST',
      body: {
        purpose: 'INVITATION',
        email: 'revokedcaller@encrix.io',
        otp: '123456',
        inviteToken: revokedToken,
      },
    });
    await verifyOtpHandler(vReq, vRes);
    expect(vRes.statusCode).toBe(403);
    expect(vRes.body.error).toContain('revoked');
  });

  // =========================================================================
  // 13. Email verification cannot be redirected to a different email
  // =========================================================================
  it('13. email verification cannot be redirected to a different email address', async () => {
    const validPendingToken = 'inv_alpha_pending_token_12345'; // registered for alpha@encrix.io

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        purpose: 'INVITATION',
        email: 'attacker@evil.com', // mismatch
        inviteToken: validPendingToken,
      },
    });
    await sendOtpHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('Email address does not match this invitation');
  });

  // =========================================================================
  // 14. Invitation creation does not report success when persistence fails
  // =========================================================================
  it('14. invitation creation does not report success when database persistence fails', async () => {
    const ownerToken = createOwnerSession();

    // Mock insert failure
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: ownerProfileId, user_id: ownerUserId, organization_id: orgA, role: 'OWNER', status: 'ACTIVE' },
                error: null,
              })),
              maybeSingle: vi.fn(async () => ({ data: null, error: null })),
            })),
          })),
        };
      }
      if (table === 'organization_invitations') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: null,
                error: { code: '23505', message: 'Unique constraint violation on token' },
              })),
            })),
          })),
        };
      }
      return {};
    });

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { fullName: 'New Caller', email: 'caller@encrix.io' },
    });
    await inviteHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain('Database failed to persist invitation');
    expect(res.body.success).toBeUndefined();
  });

  // =========================================================================
  // 15. Successful revocation persists REVOKED status
  // =========================================================================
  it('15. successful revocation persists REVOKED status atomically', async () => {
    const ownerToken = createOwnerSession();

    // Target Alpha (pending in orgA)
    const { req, res } = createMockReqRes({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
    await invitationsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.invitation.status).toBe('REVOKED');

    // Verify row in database is now REVOKED
    const alpha = mockInvitationsDb.find((r) => r.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(alpha.status).toBe('REVOKED');

    // Attempting to revoke again immediately fails with 404 (only PENDING can be revoked)
    const { req: secondReq, res: secondRes } = createMockReqRes({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });
    await invitationsHandler(secondReq, secondRes);
    expect(secondRes.statusCode).toBe(404);
  });

  // =========================================================================
  // 16. Invitation listing and revocation remain functional after fresh page load
  // =========================================================================
  it('16. invitation listing and revocation remain functional through authService', async () => {
    process.env.TEST_LIVE_API = 'true';
    const ownerToken = createOwnerSession();
    authService.setSessionToken(ownerToken);

    // Mock fetch for client service
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const headers = init?.headers || {};

      const { req, res } = createMockReqRes({
        method,
        body,
        headers,
      });

      await invitationsHandler(req, res);

      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        json: async () => res.body,
      } as Response;
    });

    // 16a. Load invitations via authService
    const listResult = await authService.getInvitations();
    expect(listResult.success).toBe(true);
    expect(listResult.invitations?.length).toBe(2);

    // 16b. Revoke Alpha via authService
    const revokeResult = await authService.revokeInvitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(revokeResult.success).toBe(true);

    // 16c. Reload invitations (simulating post-revoke refresh or page reload)
    const refreshResult = await authService.getInvitations();
    expect(refreshResult.success).toBe(true);
    const alphaAfter = refreshResult.invitations?.find((i) => i.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(alphaAfter?.status).toBe('REVOKED');

    fetchSpy.mockRestore();
    authService.clearSessionToken();
  });
});
