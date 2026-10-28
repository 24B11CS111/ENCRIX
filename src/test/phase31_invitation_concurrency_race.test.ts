import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import verifyOtpHandler from '../../api/auth/verify-otp';
import invitationsHandler from '../../api/auth/invitations';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import {
  clearServerInvitations,
  storeServerInvitation,
  getServerInvitation,
} from '../../api/_lib/invitationServer';
import { serverOtpStore, hashOtp } from '../../api/_lib/otpServer';

function createMockReqRes(options: {
  method?: string;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}) {
  const headers = { ...(options.headers || {}) };
  const req = {
    method: options.method || 'POST',
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

describe('ENCRIX Phase 31: Invitation Revocation & Concurrency Race Validation', () => {
  const originalEnv = { ...process.env };

  const orgId = '11111111-1111-4111-8111-111111111111';
  const ownerUserId = '22222222-2222-4222-8222-222222222222';
  const ownerProfileId = '33333333-3333-4333-8333-333333333333';

  let mockInvitationsDb: any[] = [];
  let mockProfilesDb: any[] = [];
  let mockEmailOtpsDb: any[] = [];
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

    mockProfilesDb = [
      {
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgId,
        full_name: 'Owner Alice',
        role: 'OWNER',
        status: 'ACTIVE',
        email: 'alice@encrix.io',
      },
    ];

    mockInvitationsDb = [];
    mockEmailOtpsDb = [];

    // Build comprehensive mock Supabase client simulating atomic operations
    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn((cols?: string) => {
              let filtered = [...mockProfilesDb];
              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  filtered = filtered.filter((p) => p[field] === val);
                  return builder;
                }),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: filtered[0], error: null };
                  return { data: null, error: { message: 'Profile not found' } };
                }),
                maybeSingle: vi.fn(async () => {
                  return { data: filtered[0] || null, error: null };
                }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newProfile = {
                    ...row,
                    id: row.id || `prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    created_at: new Date().toISOString(),
                  };
                  mockProfilesDb.push(newProfile);
                  return { data: newProfile, error: null };
                }),
              })),
            })),
          };
        }

        if (table === 'organizations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: orgId, name: 'ENCRIX Corp', status: 'ACTIVE' },
                  error: null,
                })),
              })),
            })),
          };
        }

        if (table === 'organization_invitations') {
          return {
            select: vi.fn((cols?: string) => {
              let filtered = [...mockInvitationsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((row) => row[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                maybeSingle: vi.fn(async () => {
                  return { data: filtered[0] || null, error: null };
                }),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: filtered[0], error: null };
                  return { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
                }),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newRow = {
                    ...row,
                    id: row.id || `inv-${Date.now()}`,
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

        if (table === 'email_otps') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockEmailOtpsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((r) => r[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                limit: vi.fn(async () => ({
                  data: filtered.slice(0, 1),
                  error: null,
                })),
              };
              return builder;
            }),
            insert: vi.fn(async (row: any) => {
              mockEmailOtpsDb.push(row);
              return { data: row, error: null };
            }),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') targetId = val;
                  return builder;
                }),
                then: (resolve: any) => {
                  if (targetId) {
                    const item = mockEmailOtpsDb.find((r) => r.id === targetId);
                    if (item) Object.assign(item, updates);
                  }
                  resolve({ data: null, error: null });
                },
              };
              return builder;
            }),
          };
        }

        if (table === 'security_events' || table === 'activity_logs') {
          return {
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }

        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => null) })) })),
        };
      }),
    };

    vi.spyOn(supabaseServerModule, 'getSupabaseServerClient').mockImplementation(() => mockSupabase);
    vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  function seedOtp(email: string, otp: string, purpose = 'INVITATION') {
    const normalizedEmail = email.toLowerCase().trim();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpHash = hashOtp(normalizedEmail, otp);

    mockEmailOtpsDb.push({
      id: `otp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email: normalizedEmail,
      purpose,
      otp_hash: otpHash,
      attempts: 0,
      resend_after: new Date(Date.now() - 1000).toISOString(),
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    });

    serverOtpStore.set(`${normalizedEmail}:${purpose}`, {
      identifier: normalizedEmail,
      purpose,
      otpHash,
      attempts: 0,
      resendAfter: new Date(Date.now() - 1000).toISOString(),
      expiresAt,
      used: false,
      createdAt: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: Revoked invitation cannot complete acceptance
  // ---------------------------------------------------------------------------
  it('1. returns 403 when trying to accept an invitation that is already marked REVOKED in the database', async () => {
    const invId = '44444444-4444-4444-8444-444444444444';
    const token = 'inv_token_already_revoked_123';
    const email = 'caller.revoked@encrix.io';

    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Revoked Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'REVOKED',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    seedOtp(email, '123456', 'INVITATION');

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '123456',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('This invitation has been revoked by the organization owner');

    // Confirm no profile was created
    const profile = mockProfilesDb.find((p) => p.email === email);
    expect(profile).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Revocation via DELETE /api/auth/invitations prevents telecaller account activation
  // ---------------------------------------------------------------------------
  it('2. revoking a pending invitation via DELETE /api/auth/invitations prevents telecaller account activation', async () => {
    const invId = '55555555-5555-4555-8555-555555555555';
    const token = 'inv_token_to_be_revoked_789';
    const email = 'caller.targeted@encrix.io';

    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Targeted Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'PENDING',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    // Step A: Owner revokes the invitation
    const ownerToken = createSignedSessionToken({
      userId: ownerUserId,
      profileId: ownerProfileId,
      organizationId: orgId,
      fullName: 'Owner Alice',
      email: 'alice@encrix.io',
      role: 'OWNER',
    });

    const { req: revokeReq, res: revokeRes } = createMockReqRes({
      method: 'DELETE',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { id: invId },
    });

    await invitationsHandler(revokeReq, revokeRes);
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.body.success).toBe(true);
    expect(revokeRes.body.invitation.status).toBe('REVOKED');
    expect(mockInvitationsDb[0].status).toBe('REVOKED');

    // Step B: Telecaller tries to accept using OTP and the revoked token
    seedOtp(email, '654321', 'INVITATION');

    const { req: verifyReq, res: verifyRes } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '654321',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(verifyReq, verifyRes);

    expect(verifyRes.statusCode).toBe(403);
    expect(verifyRes.body.error).toContain('revoked');

    // Verify zero telecaller profiles created
    const createdProfile = mockProfilesDb.find((p) => p.email === email);
    expect(createdProfile).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 3: Concurrent revocation race during acceptance (atomic conditional update fails)
  // ---------------------------------------------------------------------------
  it('3. safely handles race condition where invitation is revoked concurrently before the atomic database update', async () => {
    const invId = '66666666-6666-4666-8666-666666666666';
    const token = 'inv_token_race_revocation_456';
    const email = 'caller.race@encrix.io';

    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Race Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'PENDING',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    seedOtp(email, '999888', 'INVITATION');

    // Simulate concurrent revocation occurring right after pre-flight select:
    // When update is called, the invitation in DB is already REVOKED, so .eq('status', 'PENDING') fails!
    const originalFrom = mockSupabase.from;
    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'organization_invitations') {
        const defaultTable = originalFrom(table);
        return {
          ...defaultTable,
          select: defaultTable.select,
          update: vi.fn((updates: any) => {
            // Emulate concurrent revocation before the update arrives at the database
            mockInvitationsDb[0].status = 'REVOKED';

            let targetId: string | null = null;
            let requiredStatus: string | null = null;

            const builder: any = {
              eq: vi.fn((field: string, val: string) => {
                if (field === 'id') targetId = val;
                if (field === 'status') requiredStatus = val;
                return builder;
              }),
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  // Because status is now REVOKED, requiredStatus='PENDING' matches 0 rows!
                  if (mockInvitationsDb[0].status !== requiredStatus) {
                    return { data: null, error: null };
                  }
                  return { data: mockInvitationsDb[0], error: null };
                }),
              })),
            };
            return builder;
          }),
        };
      }
      return originalFrom(table);
    });

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '999888',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req, res);

    // Failed conditional update must reject and NOT create profile
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('This invitation has already been accepted');

    // Confirm telecaller was NOT created
    const profile = mockProfilesDb.find((p) => p.email === email);
    expect(profile).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 4: Concurrent acceptance race (double submit / simultaneous requests)
  // ---------------------------------------------------------------------------
  it('4. prevents duplicate activation and duplicate profile creation during concurrent acceptance requests', async () => {
    const invId = '77777777-7777-4777-8777-777777777777';
    const token = 'inv_token_concurrent_double_submit';
    const email = 'caller.concurrent@encrix.io';

    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Concurrent Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'PENDING',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    seedOtp(email, '112233', 'INVITATION');

    // Request 1: First request executes and marks status = ACCEPTED
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '112233',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req1, res1);
    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.role).toBe('TELECALLER');
    expect(res1.body.sessionToken).toBeDefined();

    // Verify invitation is now ACCEPTED in DB
    expect(mockInvitationsDb[0].status).toBe('ACCEPTED');

    // Request 2: Concurrent/duplicate request with same credentials
    seedOtp(email, '112233', 'INVITATION');
    const { req: req2, res: res2 } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '112233',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req2, res2);

    // Request 2 must fail because status is no longer PENDING
    expect(res2.statusCode).toBe(400);
    expect(res2.body.error).toContain('This invitation has already been accepted');

    // Confirm exactly ONE telecaller profile exists for this email
    const telecallerProfiles = mockProfilesDb.filter((p) => p.email === email);
    expect(telecallerProfiles.length).toBe(1);
    expect(telecallerProfiles[0].role).toBe('TELECALLER');
    expect(telecallerProfiles[0].status).toBe('ACTIVE');
  });

  // ---------------------------------------------------------------------------
  // Test 5: In-memory store isolation (failed database update cannot be bypassed by memory)
  // ---------------------------------------------------------------------------
  it('5. failed conditional database update cannot be bypassed by stale in-memory invitation state', async () => {
    const invId = '88888888-8888-4888-8888-888888888888';
    const token = 'inv_token_stale_memory_test';
    const email = 'caller.stale@encrix.io';

    // Seed database with status REVOKED
    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Stale Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'REVOKED',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    // Seed in-memory store with stale 'PENDING' status
    storeServerInvitation({
      id: invId,
      token,
      organization_id: orgId,
      full_name: 'Stale Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    seedOtp(email, '445566', 'INVITATION');

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '445566',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req, res);

    // Supabase is configured, so database state REVOKED must take precedence over memory
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain('revoked');

    // Verify no telecaller profile was created
    const profile = mockProfilesDb.find((p) => p.email === email);
    expect(profile).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Test 6: Existing successful invitation acceptance remains functional
  // ---------------------------------------------------------------------------
  it('6. successfully completes onboarding for a valid pending invitation with matching email and OTP', async () => {
    const invId = '99999999-9999-4999-8999-999999999999';
    const token = 'inv_token_happy_path_12345';
    const email = 'happy.caller@encrix.io';

    mockInvitationsDb.push({
      id: invId,
      organization_id: orgId,
      full_name: 'Happy Caller',
      email,
      invited_by: ownerProfileId,
      role: 'TELECALLER',
      status: 'PENDING',
      token,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString(),
    });

    seedOtp(email, '789012', 'INVITATION');

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        email,
        otp: '789012',
        purpose: 'INVITATION',
        inviteToken: token,
      },
    });

    await verifyOtpHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('TELECALLER');
    expect(res.body.sessionToken).toBeDefined();
    expect(res.body.profile.full_name).toBe('Happy Caller');

    // Check DB record updated to ACCEPTED
    expect(mockInvitationsDb[0].status).toBe('ACCEPTED');

    // Check profile created in DB
    const createdProfile = mockProfilesDb.find((p) => p.email === email);
    expect(createdProfile).toBeDefined();
    expect(createdProfile.role).toBe('TELECALLER');
    expect(createdProfile.status).toBe('ACTIVE');
    expect(createdProfile.organization_id).toBe(orgId);
  });
});
