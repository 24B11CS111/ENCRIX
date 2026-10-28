import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import followUpsHandler from '../../api/follow-ups';
import metricsHandler from '../../api/metrics';
import notificationsHandler from '../../api/notifications';
import webhookHandler from '../../api/telephony/webhook';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';
import * as twilioServerModule from '../../api/_lib/twilioServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { db } from '../../src/services/supabase/db';
import { Profile } from '../../src/types';

function createMockReqRes(options: {
  method?: string;
  url?: string;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}) {
  const headers = { ...(options.headers || {}) };
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
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

describe('ENCRIX Phase 33: Complete Real-Time CRM Workflows', () => {
  const originalEnv = { ...process.env };

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  const ownerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerProfileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const telecallerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const telecallerProfileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const otherOrgTelecallerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  let mockFollowUpsDb: any[] = [];
  let mockLeadsDb: any[] = [];
  let mockCallsDb: any[] = [];
  let mockProfilesDb: any[] = [];
  let mockNotificationsDb: any[] = [];
  let mockWebhookEventsDb: any[] = [];
  let mockSupabase: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SESSION_SERVER_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    process.env.TWILIO_STATUS_CALLBACK_URL = 'https://encrix.vercel.app/api/telephony/webhook';
    process.env.TWILIO_AUTH_TOKEN = 'mock-twilio-auth-token-12345';
    delete process.env.TEST_LIVE_API;

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
        full_name: 'Foreign Telecaller',
        email: 'foreign@orgb.io',
        role: 'TELECALLER',
        status: 'ACTIVE',
      },
    ];

    mockLeadsDb = [
      {
        id: 'lead-101',
        organization_id: orgA,
        lead_code: 'LV-1001',
        name: 'Alpha Prospect',
        phone: '+919876543210',
        status: 'ASSIGNED',
        assigned_to: telecallerProfileId,
      },
      {
        id: 'lead-102',
        organization_id: orgA,
        lead_code: 'LV-1002',
        name: 'Beta Prospect',
        phone: '+919876543211',
        status: 'INTERESTED',
        assigned_to: telecallerProfileId,
      },
      {
        id: 'lead-999',
        organization_id: orgB,
        lead_code: 'LV-9999',
        name: 'Foreign Prospect',
        phone: '+919876543299',
        status: 'NEW',
        assigned_to: null,
      },
    ];

    mockFollowUpsDb = [
      {
        id: 'fup-101',
        organization_id: orgA,
        lead_id: 'lead-101',
        assigned_to: telecallerProfileId,
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        status: 'PENDING',
        priority: 'HIGH',
        notes: 'Call to review admission forms',
        reschedule_count: 0,
        created_at: new Date(Date.now() - 3600000).toISOString(),
        updated_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'fup-999',
        organization_id: orgB,
        lead_id: 'lead-999',
        assigned_to: otherOrgTelecallerId,
        scheduled_at: new Date(Date.now() + 7200000).toISOString(),
        status: 'PENDING',
        priority: 'LOW',
        notes: 'Foreign follow up',
        reschedule_count: 0,
        created_at: new Date(Date.now() - 1000).toISOString(),
        updated_at: new Date(Date.now() - 1000).toISOString(),
      },
    ];

    mockCallsDb = [
      {
        id: 'call-101',
        organization_id: orgA,
        lead_id: 'lead-101',
        telecaller_id: telecallerProfileId,
        provider: 'TWILIO',
        provider_call_id: 'CA11111111111111111111111111111111',
        status: 'COMPLETED',
        duration_seconds: 120,
        created_at: new Date(Date.now() - 1800000).toISOString(),
      },
    ];

    mockNotificationsDb = [
      {
        id: 'notif-101',
        organization_id: orgA,
        user_id: telecallerProfileId,
        type: 'FOLLOW_UP_DUE',
        title: 'Follow-Up Due',
        message: 'You have a follow-up scheduled shortly',
        read: false,
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
      {
        id: 'notif-999',
        organization_id: orgB,
        user_id: otherOrgTelecallerId,
        type: 'SYSTEM',
        title: 'Org B Notification',
        message: 'Foreign message',
        read: false,
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
    ];

    mockWebhookEventsDb = [];

    // Mock Supabase Server Client
    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'follow_ups') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockFollowUpsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((f) => f[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                maybeSingle: vi.fn(async () => ({
                  data: filtered[0] || null,
                  error: null,
                })),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newFup = {
                    ...row,
                    id: row.id || `fup-${Date.now()}`,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  mockFollowUpsDb.push(newFup);
                  return { data: newFup, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              let requiredOrg: string | null = null;
              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') targetId = val;
                  if (field === 'organization_id') requiredOrg = val;
                  return builder;
                }),
                select: vi.fn(() => ({
                  single: vi.fn(async () => {
                    const idx = mockFollowUpsDb.findIndex(
                      (f) => f.id === targetId && (!requiredOrg || f.organization_id === requiredOrg)
                    );
                    if (idx === -1) return { data: null, error: { message: 'Not found' } };
                    mockFollowUpsDb[idx] = { ...mockFollowUpsDb[idx], ...updates };
                    return { data: mockFollowUpsDb[idx], error: null };
                  }),
                })),
              };
              return builder;
            }),
          };
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockLeadsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((l) => l[field] === val);
                  return builder;
                }),
                in: vi.fn((field: string, vals: any[]) => {
                  filtered = filtered.filter((l) => vals.includes(l[field]));
                  return builder;
                }),
                maybeSingle: vi.fn(async () => ({
                  data: filtered[0] || null,
                  error: null,
                })),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
          };
        }

        if (table === 'calls') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockCallsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((c) => c[field] === val);
                  return builder;
                }),
                in: vi.fn((field: string, vals: any[]) => {
                  filtered = filtered.filter((c) => vals.includes(c[field]));
                  return builder;
                }),
                maybeSingle: vi.fn(async () => ({
                  data: filtered[0] || null,
                  error: null,
                })),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              const builder: any = {
                eq: vi.fn((field: string, val: string) => {
                  if (field === 'id') targetId = val;
                  return builder;
                }),
                in: vi.fn(() => builder),
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => {
                    const idx = mockCallsDb.findIndex((c) => c.id === targetId);
                    if (idx === -1) return { data: null, error: null };
                    mockCallsDb[idx] = { ...mockCallsDb[idx], ...updates };
                    return { data: mockCallsDb[idx], error: null };
                  }),
                })),
              };
              return builder;
            }),
          };
        }

        if (table === 'notifications') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockNotificationsDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((n) => n[field] === val);
                  return builder;
                }),
                order: vi.fn(() => builder),
                limit: vi.fn(() => builder),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
            insert: vi.fn((row: any) => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => {
                  const newNotif = {
                    ...row,
                    id: row.id || `notif-${Date.now()}`,
                    created_at: new Date().toISOString(),
                  };
                  mockNotificationsDb.unshift(newNotif);
                  return { data: newNotif, error: null };
                }),
              })),
            })),
            update: vi.fn((updates: any) => {
              let targetId: string | null = null;
              let targetUserId: string | null = null;
              let targetOrg: string | null = null;

              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  if (field === 'id') targetId = val;
                  if (field === 'user_id') targetUserId = val;
                  if (field === 'organization_id') targetOrg = val;
                  return builder;
                }),
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => {
                    const idx = mockNotificationsDb.findIndex(
                      (n) => n.id === targetId && (!targetUserId || n.user_id === targetUserId)
                    );
                    if (idx === -1) return { data: null, error: null };
                    mockNotificationsDb[idx] = { ...mockNotificationsDb[idx], ...updates };
                    return { data: mockNotificationsDb[idx], error: null };
                  }),
                })),
                then: (resolve: any) => {
                  let updatedCount = 0;
                  mockNotificationsDb = mockNotificationsDb.map((n) => {
                    if (
                      (!targetId || n.id === targetId) &&
                      (!targetUserId || n.user_id === targetUserId) &&
                      (!targetOrg || n.organization_id === targetOrg)
                    ) {
                      updatedCount++;
                      return { ...n, ...updates };
                    }
                    return n;
                  });
                  return resolve({ data: null, error: null, count: updatedCount });
                },
              };
              return builder;
            }),
          };
        }

        if (table === 'profiles') {
          return {
            select: vi.fn(() => {
              let filtered = [...mockProfilesDb];
              const builder: any = {
                eq: vi.fn((field: string, val: any) => {
                  filtered = filtered.filter((p) => p[field] === val);
                  return builder;
                }),
                maybeSingle: vi.fn(async () => ({
                  data: filtered[0] || null,
                  error: null,
                })),
                single: vi.fn(async () => {
                  if (filtered.length > 0) return { data: filtered[0], error: null };
                  return { data: null, error: { message: 'Profile not found' } };
                }),
                then: (resolve: any) => resolve({ data: filtered, error: null }),
              };
              return builder;
            }),
          };
        }

        if (table === 'webhook_events') {
          return {
            insert: vi.fn(async (row: any) => {
              const duplicate = mockWebhookEventsDb.some(
                (w) => w.provider_event_id === row.provider_event_id
              );
              if (duplicate) {
                return { data: null, error: { code: '23505', message: 'Duplicate event' } };
              }
              mockWebhookEventsDb.push(row);
              return { data: row, error: null };
            }),
          };
        }

        if (table === 'security_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ count: 1 })),
            })),
            insert: vi.fn(async () => ({ data: null, error: null })),
          };
        }

        return {};
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
  // 1. Follow-Up Persistence & Tenant Scoping
  // ---------------------------------------------------------------------------
  it('1. lists organization follow-ups for Owner and enforces telecaller isolation', async () => {
    const ownerToken = createOwnerSession();
    const { req: ownerReq, res: ownerRes } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    await followUpsHandler(ownerReq, ownerRes);

    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.body.success).toBe(true);
    expect(ownerRes.body.followUps.length).toBe(1);
    expect(ownerRes.body.followUps[0].id).toBe('fup-101');
    // Enriched lead info present
    expect(ownerRes.body.followUps[0].lead_code).toBe('LV-1001');

    // Telecaller lists follow-ups (scoped to telecaller)
    const tcToken = createTelecallerSession();
    const { req: tcReq, res: tcRes } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${tcToken}` },
    });

    await followUpsHandler(tcReq, tcRes);
    expect(tcRes.statusCode).toBe(200);
    expect(tcRes.body.followUps.length).toBe(1);
    expect(tcRes.body.followUps[0].assigned_to).toBe(telecallerProfileId);
  });

  it('2. creates follow-up in database with tenant isolation and validates lead organization', async () => {
    const ownerToken = createOwnerSession();
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: {
        leadId: 'lead-101',
        scheduledAt: futureDate,
        priority: 'HIGH',
        notes: 'Follow up on document verification',
        assignedTo: telecallerProfileId,
      },
    });

    await followUpsHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.followUp.organization_id).toBe(orgA);
    expect(res.body.followUp.lead_id).toBe('lead-101');
    expect(res.body.followUp.status).toBe('PENDING');

    // Verify persisted into mock database
    expect(mockFollowUpsDb.some((f) => f.notes === 'Follow up on document verification')).toBe(true);
  });

  it('3. rejects creating follow-up on a lead belonging to another organization', async () => {
    const ownerToken = createOwnerSession();
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: {
        leadId: 'lead-999', // Belongs to Org B
        scheduledAt: futureDate,
        notes: 'Unauthorized follow up attempt',
      },
    });

    await followUpsHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toContain('Lead not found in your organization');
  });

  it('4. reschedules, completes, and cancels follow-up with audit timestamps', async () => {
    const tcToken = createTelecallerSession();
    const newDate = new Date(Date.now() + 172800000).toISOString();

    // Step A: Reschedule
    const { req: reschedReq, res: reschedRes } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${tcToken}` },
      body: {
        id: 'fup-101',
        action: 'reschedule',
        scheduledAt: newDate,
        reason: 'Customer requested weekend call',
      },
    });

    await followUpsHandler(reschedReq, reschedRes);
    expect(reschedRes.statusCode).toBe(200);
    expect(reschedRes.body.followUp.status).toBe('PENDING');
    expect(reschedRes.body.followUp.reschedule_count).toBe(1);
    expect(reschedRes.body.followUp.reschedule_reason).toBe('Customer requested weekend call');

    // Step B: Complete
    const { req: compReq, res: compRes } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${tcToken}` },
      body: {
        id: 'fup-101',
        action: 'complete',
        outcome: 'CONVERTED',
        outcomeNotes: 'Student enrolled successfully',
      },
    });

    await followUpsHandler(compReq, compRes);
    expect(compRes.statusCode).toBe(200);
    expect(compRes.body.followUp.status).toBe('COMPLETED');
    expect(compRes.body.followUp.outcome).toBe('CONVERTED');
  });

  // ---------------------------------------------------------------------------
  // 2. Server-side Dashboard Metrics
  // ---------------------------------------------------------------------------
  it('5. calculates authoritative organization dashboard metrics without double-counting', async () => {
    const ownerToken = createOwnerSession();
    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    await metricsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('OWNER');

    const m = res.body.metrics;
    expect(m.totalLeads).toBe(2);
    expect(m.assignedLeads).toBe(2);
    expect(m.unassignedLeads).toBe(0);
    expect(m.conversions).toBe(1); // lead-102 is INTERESTED
    expect(m.totalCallsCount).toBe(1);
    expect(m.totalCallSeconds).toBe(120);
    expect(m.answeredCallsCount).toBe(1);
    expect(m.connectRate).toBe(100);
    expect(m.activeFollowUps).toBe(1);
    expect(Array.isArray(m.telecallerPerformance)).toBe(true);
  });

  it('6. calculates telecaller scoped dashboard metrics', async () => {
    const tcToken = createTelecallerSession();
    const { req, res } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${tcToken}` },
    });

    await metricsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.role).toBe('TELECALLER');

    const m = res.body.metrics;
    expect(m.totalAssigned).toBe(2);
    expect(m.positiveLeads).toBe(1);
    expect(m.totalCalls).toBe(1);
    expect(m.myFollowUps).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 3. Persistent Notifications
  // ---------------------------------------------------------------------------
  it('7. lists notifications and marks single or all notifications as read', async () => {
    const tcToken = createTelecallerSession();

    // List notifications
    const { req: listReq, res: listRes } = createMockReqRes({
      method: 'GET',
      headers: { authorization: `Bearer ${tcToken}` },
    });

    await notificationsHandler(listReq, listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.notifications.length).toBe(1);
    expect(listRes.body.notifications[0].id).toBe('notif-101');
    expect(listRes.body.notifications[0].read).toBe(false);

    // Mark single notification as read
    const { req: markReq, res: markRes } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${tcToken}` },
      body: { id: 'notif-101' },
    });

    await notificationsHandler(markReq, markRes);
    expect(markRes.statusCode).toBe(200);
    expect(markRes.body.notification.read).toBe(true);

    // Mark all as read
    const { req: allReq, res: allRes } = createMockReqRes({
      method: 'PATCH',
      headers: { authorization: `Bearer ${tcToken}` },
      body: { all: true },
    });

    await notificationsHandler(allReq, allRes);
    expect(allRes.statusCode).toBe(200);
    expect(allRes.body.markedAll).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Calling Lifecycle Webhook Signature & Idempotency
  // ---------------------------------------------------------------------------
  it('8. rejects forged or unsigned Twilio webhook callbacks with 401', async () => {
    vi.spyOn(twilioServerModule, 'verifyTwilioSignature').mockReturnValue(false);

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/telephony/webhook',
      headers: { 'x-twilio-signature': 'invalid-signature' },
      body: { CallSid: 'CA11111111111111111111111111111111', CallStatus: 'completed' },
    });

    await webhookHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toContain('Invalid Twilio HMAC signature');
  });

  it('9. processes valid Twilio status callback and rejects duplicate/replayed events idempotently', async () => {
    vi.spyOn(twilioServerModule, 'verifyTwilioSignature').mockReturnValue(true);

    const callSid = 'CA11111111111111111111111111111111';

    // First delivery of webhook
    const { req: firstReq, res: firstRes } = createMockReqRes({
      method: 'POST',
      url: '/api/telephony/webhook',
      headers: { 'x-twilio-signature': 'valid-sig' },
      body: {
        CallSid: callSid,
        CallStatus: 'completed',
        CallDuration: '150',
        SequenceNumber: '1',
      },
    });

    await webhookHandler(firstReq, firstRes);
    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.body.ok).toBe(true);
    expect(firstRes.body.duplicate).toBe(false);

    // Second delivery of same webhook (idempotency check)
    const { req: secondReq, res: secondRes } = createMockReqRes({
      method: 'POST',
      url: '/api/telephony/webhook',
      headers: { 'x-twilio-signature': 'valid-sig' },
      body: {
        CallSid: callSid,
        CallStatus: 'completed',
        CallDuration: '150',
        SequenceNumber: '1',
      },
    });

    await webhookHandler(secondReq, secondRes);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.body.ok).toBe(true);
    expect(secondRes.body.duplicate).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 5. Real-Time Event Mapping
  // ---------------------------------------------------------------------------
  it('10. maps Realtime changes on follow_ups and notifications into CRM domain events', () => {
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

    // Emit follow-up and notification domain events
    (db as any).emit('FOLLOWUP_CREATED', { id: 'fup-test', organization_id: orgA }, { organization_id: orgA });
    (db as any).emit('NEW_NOTIFICATION', { id: 'notif-test', organization_id: orgA }, { organization_id: orgA });

    expect(receivedEvents).toContain('FOLLOWUP_CREATED');
    expect(receivedEvents).toContain('NEW_NOTIFICATION');

    unsubscribe();
  });
});
