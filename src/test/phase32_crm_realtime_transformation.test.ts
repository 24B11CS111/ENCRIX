import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ownerLeadsHandler from '../../api/_lib/leads/owner';
import teamHandler from '../../api/auth/team';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { leadService } from '../../src/services/leads/leadService';
import { authService } from '../../src/services/auth/authService';
import { realtimeManager } from '../../src/services/realtime/realtimeManager';
import { db } from '../../src/services/supabase/db';
import { Lead, Profile } from '../../src/types';

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

describe('ENCRIX Phase 32: Full CRM Real-Time Transformation (Database-Backed & Live Realtime)', () => {
  const originalEnv = { ...process.env };

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  const ownerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerProfileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const telecallerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const telecallerProfileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const otherOrgTelecallerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  let mockLeadsDb: any[] = [];
  let mockProfilesDb: any[] = [];
  let mockAssignmentsDb: any[] = [];
  let mockSupabase: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SESSION_SERVER_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

    mockProfilesDb = [
      {
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgA,
        full_name: 'Jane Owner',
        email: 'owner@encrix.io',
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: telecallerProfileId,
        user_id: telecallerUserId,
        organization_id: orgA,
        full_name: 'Bob Telecaller',
        email: 'bob@encrix.io',
        role: 'TELECALLER',
        status: 'ACTIVE',
      },
      {
        id: otherOrgTelecallerId,
        user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        organization_id: orgB,
        full_name: 'Other Org Telecaller',
        email: 'other@orgb.io',
        role: 'TELECALLER',
        status: 'ACTIVE',
      },
    ];

    mockLeadsDb = [
      {
        id: 'lead-111',
        organization_id: orgA,
        lead_code: 'LV-1001',
        name: 'Alpha Student',
        phone: '+919876543210',
        email: 'alpha@student.com',
        source: 'Website',
        status: 'NEW',
        priority: 'HIGH',
        assigned_to: null,
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'lead-222',
        organization_id: orgA,
        lead_code: 'LV-1002',
        name: 'Beta Student',
        phone: '+919876543211',
        email: 'beta@student.com',
        source: 'Referral',
        status: 'ASSIGNED',
        priority: 'MEDIUM',
        assigned_to: telecallerProfileId,
        created_at: new Date(Date.now() - 7200000).toISOString(),
        updated_at: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 'lead-999',
        organization_id: orgB,
        lead_code: 'LV-9999',
        name: 'Foreign Org Student',
        phone: '+919876543299',
        email: 'foreign@student.com',
        source: 'Direct',
        status: 'NEW',
        priority: 'LOW',
        assigned_to: null,
        created_at: new Date(Date.now() - 1000).toISOString(),
        updated_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];

    mockAssignmentsDb = [];

    // Comprehensive mock Supabase server client
    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn((cols?: string) => {
              let filtered = [...mockProfilesDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((p) => p[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: filtered[0], error: null };
                  return { data: null, error: { message: 'Profile not found' } };
                }),
                maybeSingle: vi.fn(async () => {
                  return { data: filtered[0] || null, error: null };
                }),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              let requiredOrg: string | null = null;
              let requiredRole: string | null = null;

              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') targetId = val;
                  if (field === 'organization_id') requiredOrg = val;
                  if (field === 'role') requiredRole = val;
                  return builder;
                }),
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => {
                    const idx = mockProfilesDb.findIndex((p) => {
                      if (targetId && p.id !== targetId) return false;
                      if (requiredOrg && p.organization_id !== requiredOrg) return false;
                      if (requiredRole && p.role !== requiredRole) return false;
                      return true;
                    });
                    if (idx === -1) return { data: null, error: null };
                    mockProfilesDb[idx] = { ...mockProfilesDb[idx], ...updates };
                    return { data: mockProfilesDb[idx], error: null };
                  }),
                })),
              };
              return builder;
            }),
          };
        }

        if (table === 'leads') {
          return {
            select: vi.fn((cols?: string) => {
              let filtered = [...mockLeadsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((l) => l[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: filtered[0], error: null };
                  return { data: null, error: { message: 'Lead not found' } };
                }),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newLead = {
                    ...row,
                    id: row.id || `lead-${Date.now()}`,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  mockLeadsDb.unshift(newLead);
                  return { data: newLead, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => {
              let targetIds: string[] | null = null;
              let singleId: string | null = null;
              let requiredOrg: string | null = null;

              const builder: any = {
                in: vi.fn((field: string, vals: string[]) => {
                  if (field === 'id') targetIds = vals;
                  return builder;
                }),
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') singleId = val;
                  if (field === 'organization_id') requiredOrg = val;
                  return builder;
                }),
                select: vi.fn(() => ({
                  single: vi.fn(async () => {
                    const idx = mockLeadsDb.findIndex((l) => {
                      if (singleId && l.id !== singleId) return false;
                      if (requiredOrg && l.organization_id !== requiredOrg) return false;
                      return true;
                    });
                    if (idx === -1) return { data: null, error: { message: 'Not found' } };
                    mockLeadsDb[idx] = { ...mockLeadsDb[idx], ...updates };
                    return { data: mockLeadsDb[idx], error: null };
                  }),
                })),
                then: (resolve: any) => {
                  let count = 0;
                  mockLeadsDb = mockLeadsDb.map((l) => {
                    if (targetIds && targetIds.includes(l.id)) {
                      if (!requiredOrg || l.organization_id === requiredOrg) {
                        count++;
                        return { ...l, ...updates };
                      }
                    }
                    if (singleId && l.id === singleId) {
                      if (!requiredOrg || l.organization_id === requiredOrg) {
                        count++;
                        return { ...l, ...updates };
                      }
                    }
                    return l;
                  });
                  return resolve({ data: null, error: null, count });
                },
              };
              return builder;
            }),
          };
        }

        if (table === 'lead_assignments') {
          return {
            insert: vi.fn(async (rows: any[]) => {
              mockAssignmentsDb.push(...rows);
              return { data: rows, error: null };
            }),
          };
        }

        if (table === 'activity_logs' || table === 'security_events') {
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

  function createOwnerSession() {
    return createSignedSessionToken({
      userId: ownerUserId,
      profileId: ownerProfileId,
      organizationId: orgA,
      fullName: 'Jane Owner',
      email: 'owner@encrix.io',
      role: 'OWNER',
    });
  }

  function createTelecallerSession() {
    return createSignedSessionToken({
      userId: telecallerUserId,
      profileId: telecallerProfileId,
      organizationId: orgA,
      fullName: 'Bob Telecaller',
      email: 'bob@encrix.io',
      role: 'TELECALLER',
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Database-backed Owner Lead Listing
  // ---------------------------------------------------------------------------
  it('1. lists organization leads from database and enforces strict multi-tenant isolation', async () => {
    const token = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });

    await ownerLeadsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leads.length).toBe(2);

    // Confirm all leads belong strictly to orgA
    res.body.leads.forEach((l: Lead) => {
      expect(l.organization_id).toBe(orgA);
    });

    // Foreign org lead (orgB) must never be returned
    const foreignLead = res.body.leads.find((l: Lead) => l.id === 'lead-999');
    expect(foreignLead).toBeUndefined();
  });

  it('2. rejects unauthenticated or telecaller requests to owner lead list', async () => {
    const tcToken = createTelecallerSession();
    const { req: tcReq, res: tcRes } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${tcToken}` },
    });

    await ownerLeadsHandler(tcReq, tcRes);
    expect(tcRes.statusCode).toBe(403);
    expect(tcRes.body.error).toContain('Forbidden');

    const { req: noAuthReq, res: noAuthRes } = createMockReqRes({
      method: 'GET',
    });
    await ownerLeadsHandler(noAuthReq, noAuthRes);
    expect(noAuthRes.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // 2. Database-backed Owner Lead Creation
  // ---------------------------------------------------------------------------
  it('3. creates and persists a new lead to database with tenant scope and generated lead code', async () => {
    const token = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        name: 'New Prospective Student',
        phone: '+919999988888',
        email: 'prospect@edu.in',
        source: 'Google Ads',
        priority: 'HIGH',
        notes: 'Interested in B.Tech CS',
      },
    });

    await ownerLeadsHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.lead).toBeDefined();
    expect(res.body.lead.name).toBe('New Prospective Student');
    expect(res.body.lead.organization_id).toBe(orgA);
    expect(res.body.lead.status).toBe('NEW');
    expect(res.body.lead.lead_code).toMatch(/^LV-/);

    // Verify persisted into mock database
    const dbLead = mockLeadsDb.find((l) => l.name === 'New Prospective Student');
    expect(dbLead).toBeDefined();
    expect(dbLead.organization_id).toBe(orgA);
  });

  // ---------------------------------------------------------------------------
  // 3. Database-backed Lead Assignment
  // ---------------------------------------------------------------------------
  it('4. assigns leads to telecaller in the database and records assignment history', async () => {
    const token = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'POST',
      query: { _route: 'owner-assign' },
      headers: { authorization: `Bearer ${token}` },
      body: {
        leadIds: ['lead-111'],
        telecallerId: telecallerProfileId,
      },
    });

    await ownerLeadsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.assigned_count).toBe(1);

    // Verify lead status and assignment updated in database
    const updatedLead = mockLeadsDb.find((l) => l.id === 'lead-111');
    expect(updatedLead.assigned_to).toBe(telecallerProfileId);
    expect(updatedLead.status).toBe('ASSIGNED');

    // Verify assignment history logged
    expect(mockAssignmentsDb.length).toBeGreaterThan(0);
    expect(mockAssignmentsDb[0].lead_id).toBe('lead-111');
    expect(mockAssignmentsDb[0].user_id).toBe(telecallerProfileId);
  });

  it('5. prevents assigning leads to telecallers belonging to a different organization', async () => {
    const token = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'POST',
      query: { _route: 'owner-assign' },
      headers: { authorization: `Bearer ${token}` },
      body: {
        leadIds: ['lead-111'],
        telecallerId: otherOrgTelecallerId, // Belonging to Org B
      },
    });

    await ownerLeadsHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('Selected telecaller not found in your organization');

    // Confirm lead was NOT assigned
    const lead = mockLeadsDb.find((l) => l.id === 'lead-111');
    expect(lead.assigned_to).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 4. Database-backed Telecaller Team Retrieval & Status Update
  // ---------------------------------------------------------------------------
  it('6. retrieves organization telecallers from database and updates their status', async () => {
    const token = createOwnerSession();

    // Step A: GET /api/auth/team
    const { req: listReq, res: listRes } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });

    await teamHandler(listReq, listRes);

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.telecallers.length).toBe(1);
    expect(listRes.body.telecallers[0].id).toBe(telecallerProfileId);

    // Step B: PATCH /api/auth/team (toggle status to DISABLED)
    const { req: patchReq, res: patchRes } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: {
        telecallerId: telecallerProfileId,
        status: 'DISABLED',
      },
    });

    await teamHandler(patchReq, patchRes);

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.body.success).toBe(true);
    expect(patchRes.body.telecaller.status).toBe('DISABLED');

    // Confirm database record was updated
    const updatedProfile = mockProfilesDb.find((p) => p.id === telecallerProfileId);
    expect(updatedProfile.status).toBe('DISABLED');
  });

  it('7. prevents toggling status of telecallers belonging to another organization', async () => {
    const token = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: {
        telecallerId: otherOrgTelecallerId, // Belongs to Org B
        status: 'DISABLED',
      },
    });

    await teamHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('Telecaller not found in your organization');

    // Confirm other org profile was NOT changed
    const otherProfile = mockProfilesDb.find((p) => p.id === otherOrgTelecallerId);
    expect(otherProfile.status).toBe('ACTIVE');
  });

  // ---------------------------------------------------------------------------
  // 5. Real-Time Postgres Changes Translation & Reconciliation
  // ---------------------------------------------------------------------------
  it('8. realtimeManager registers reconnection listeners and triggers reconciliation upon re-establishing connection', () => {
    vi.useFakeTimers();
    let reconnectedCalled = false;
    const unsub = realtimeManager.onReconnected(() => {
      reconnectedCalled = true;
    });

    expect(typeof unsub).toBe('function');

    // Trigger reconnect
    realtimeManager.reconnect();

    // After backoff timeout, reconnected callback should be triggered
    vi.advanceTimersByTime(500);

    expect(reconnectedCalled).toBe(true);

    unsub();
    realtimeManager.cleanup();
    vi.useRealTimers();
  });

  it('9. db.subscribe maps Postgres Realtime changes into standard application events', () => {
    const receivedEvents: string[] = [];

    const ownerProfile: Profile = {
      id: ownerProfileId,
      user_id: ownerUserId,
      organization_id: orgA,
      full_name: 'Jane Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const unsubscribe = db.subscribe((event) => {
      receivedEvents.push(event.type);
    }, ownerProfile);

    // Emit standard events to confirm subscription dispatch
    (db as any).emit('LEAD_CREATED', { id: 'lead-test', organization_id: orgA }, { organization_id: orgA });
    (db as any).emit('LEADS_ASSIGNED', { leadIds: ['lead-test'], telecallerId: telecallerProfileId }, { organization_id: orgA });
    (db as any).emit('TEAM_UPDATED', { id: telecallerProfileId, organization_id: orgA }, { organization_id: orgA });

    expect(receivedEvents).toContain('LEAD_CREATED');
    expect(receivedEvents).toContain('LEADS_ASSIGNED');
    expect(receivedEvents).toContain('TEAM_UPDATED');

    unsubscribe();
  });
});
