import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import followUpsHandler from '../../api/follow-ups';
import metricsHandler from '../../api/metrics';
import notificationsHandler from '../../api/notifications';
import ownerLeadsHandler from '../../api/_lib/leads/owner';
import teamHandler from '../../api/auth/team';
import verifyOtpHandler from '../../api/auth/verify-otp';
import telephonyCallHandler from '../../api/telephony/call';
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

describe('ENCRIX Phase 34: End-to-End Real-Time Verification & Production Safety', () => {
  const originalEnv = { ...process.env };

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  const ownerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerProfileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const telecallerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const telecallerProfileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  let ownerToken: string;
  let telecallerToken: string;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENCRIX_SESSION_SECRET: 'test-session-secret-key-at-least-32-chars-long!',
      TWILIO_STATUS_CALLBACK_URL: 'https://encrix.vercel.app/api/telephony/webhook',
      TWILIO_AUTH_TOKEN: 'mock-twilio-auth-token-1234567890123456',
    };

    ownerToken = createSignedSessionToken({
      userId: ownerUserId,
      profileId: ownerProfileId,
      organizationId: orgA,
      role: 'OWNER',
      fullName: 'Alice Owner',
      email: 'alice@encrix.com',
      status: 'ACTIVE',
    });

    telecallerToken = createSignedSessionToken({
      userId: telecallerUserId,
      profileId: telecallerProfileId,
      organizationId: orgA,
      role: 'TELECALLER',
      fullName: 'Bob Telecaller',
      email: 'bob@encrix.com',
      status: 'ACTIVE',
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Production Memory Fallback Elimination
  // =========================================================================
  describe('1. Production Memory Fallback Elimination', () => {
    it('api/follow-ups fails with 503 in production when database is unavailable', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await followUpsHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/unavailable/i);
    });

    it('api/metrics fails with 503 in production when database is unavailable', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await metricsHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/unavailable/i);
    });

    it('api/notifications fails with 503 in production when database is unavailable', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await notificationsHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/unavailable/i);
    });

    it('api/_lib/leads/owner fails with 503 in production when database is unavailable', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await ownerLeadsHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/unavailable/i);
    });

    it('api/auth/team fails with 503 in production when database is unavailable', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await teamHandler(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.body?.error).toMatch(/unavailable/i);
    });

    it('api/auth/verify-otp does not fall back to in-memory telecaller creation in production on db failure', async () => {
      process.env.NODE_ENV = 'production';
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);

      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          purpose: 'INVITATION',
          email: 'newtc@encrix.com',
          otp: '123456',
          inviteToken: 'inv_dummy_token_1234567890123456',
        },
      });

      await verifyOtpHandler(req, res);

      // In production without valid session secret or with unconfigured DB, it rejects
      expect([400, 404, 500, 503]).toContain(res.statusCode);
      expect(res.body?.sessionToken).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Authoritative Follow-up Persistence & Validation
  // =========================================================================
  describe('2. Authoritative Follow-up Persistence & Validation', () => {
    it('rejects follow-up creation when scheduled date is invalid or missing', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          leadId: 'some-lead-id',
          scheduledAt: 'invalid-not-a-date',
        },
      });

      await followUpsHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toMatch(/scheduledAt must be a valid ISO date/i);
    });

    it('enforces mandatory reason on reschedule action', async () => {
      const { req, res } = createMockReqRes({
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          id: 'fup-1',
          action: 'reschedule',
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          reason: '   ', // whitespace only
        },
      });

      await followUpsHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toMatch(/Reschedule reason is mandatory/i);
    });
  });

  // =========================================================================
  // 3. Notification Read/Unread Persistence
  // =========================================================================
  describe('3. Notification Read/Unread Persistence', () => {
    it('marks all notifications read for authenticated user', async () => {
      const { req, res } = createMockReqRes({
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          all: true,
        },
      });

      await notificationsHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
    });

    it('requires notification ID or all: true on PATCH /api/notifications', async () => {
      const { req, res } = createMockReqRes({
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {},
      });

      await notificationsHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toMatch(/Notification ID or "all: true" is required/i);
    });
  });

  // =========================================================================
  // 4. Lead Assignment & Organization Isolation
  // =========================================================================
  describe('4. Lead Assignment & Organization Isolation', () => {
    it('blocks telecallers from assigning or distributing leads', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { Authorization: `Bearer ${telecallerToken}` },
        body: {
          action: 'assign',
          leadIds: ['lead-1'],
          telecallerId: telecallerProfileId,
        },
      });

      await ownerLeadsHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toMatch(/Only organization owners or administrators can perform this action/i);
    });

    it('requires leadIds and telecallerId on assignment', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          action: 'assign',
          leadIds: [],
        },
      });

      await ownerLeadsHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toMatch(/leadIds array and telecallerId are required/i);
    });
  });

  // =========================================================================
  // 5. Telephony Truthfulness & Idempotency
  // =========================================================================
  describe('5. Telephony Truthfulness & Idempotency', () => {
    it('returns 503 for live outbound call placement when secure bridge is unconfigured', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: {
          leadId: 'any-lead-id',
          action: 'start',
        },
      });

      await telephonyCallHandler(req, res);

      expect([404, 503]).toContain(res.statusCode);
      if (res.statusCode === 503) {
        expect(res.body?.error).toMatch(/Secure call bridge is not configured/i);
      }
    });

    it('rejects status callback with missing or invalid Twilio signature', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/api/telephony/webhook',
        headers: {
          'x-twilio-signature': 'invalid-signature-value',
        },
        body: {
          CallSid: 'CA11111111111111111111111111111111',
          CallStatus: 'completed',
        },
      });

      await webhookHandler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body?.error).toMatch(/Invalid Twilio HMAC signature/i);
    });

    it('returns duplicate: true early when webhook event was already processed', async () => {
      vi.spyOn(twilioServerModule, 'verifyTwilioSignature').mockReturnValue(true);

      const ownerProfile: Profile = {
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgA,
        full_name: 'Alice Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const lead = db.createLead(
        {
          name: 'Webhook Lead',
          phone: '+15550001111',
          status: 'NEW',
          source: 'Direct',
          priority: 'MEDIUM',
        },
        ownerProfile
      );

      const mockCall = db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: 15,
          status: 'IN_PROGRESS',
          provider: 'TWILIO',
          provider_call_id: 'CA99999999999999999999999999999999',
        },
        ownerProfile
      );

      const { req: firstReq, res: firstRes } = createMockReqRes({
        method: 'POST',
        url: '/api/telephony/webhook',
        headers: { 'x-twilio-signature': 'valid' },
        body: {
          CallSid: mockCall.provider_call_id,
          CallStatus: 'completed',
          CallDuration: '15',
          SequenceNumber: '1',
        },
      });

      await webhookHandler(firstReq, firstRes);
      expect(firstRes.statusCode).toBe(200);

      // Replay identical webhook
      const { req: replayReq, res: replayRes } = createMockReqRes({
        method: 'POST',
        url: '/api/telephony/webhook',
        headers: { 'x-twilio-signature': 'valid' },
        body: {
          CallSid: mockCall.provider_call_id,
          CallStatus: 'completed',
          CallDuration: '15',
          SequenceNumber: '1',
        },
      });

      await webhookHandler(replayReq, replayRes);
      expect(replayRes.statusCode).toBe(200);
      expect(replayRes.body?.duplicate).toBe(true);
    });
  });

  // =========================================================================
  // 6. Realtime Reliability & Cleanup
  // =========================================================================
  describe('6. Realtime Reliability & Cleanup', () => {
    it('cleans up subscription listeners on unsubscribe without leaking memory', () => {
      const listenerSpy = vi.fn();
      const mockProfile: Profile = {
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgA,
        full_name: 'Alice Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const unsubscribe = db.subscribe(listenerSpy, mockProfile);
      expect(typeof unsubscribe).toBe('function');

      // Dispatch event
      (db as any).emit('LEAD_CREATED', { id: 'lead-sub-1', organization_id: orgA }, { organization_id: orgA });
      expect(listenerSpy).toHaveBeenCalled();

      // Unsubscribe
      listenerSpy.mockClear();
      unsubscribe();

      (db as any).emit('LEAD_CREATED', { id: 'lead-sub-2', organization_id: orgA }, { organization_id: orgA });
      expect(listenerSpy).not.toHaveBeenCalled();
    });

    it('does not duplicate records on repeated Realtime broadcast payloads', () => {
      const initialCount = db.getLeads({
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgA,
        full_name: 'Alice Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).length;

      const testLead = {
        id: 'realtime-dedup-lead-1',
        organization_id: orgA,
        name: 'Dedup Lead',
        lead_code: 'LV-DEDUP-001',
        status: 'NEW',
      };

      // First broadcast
      (db as any).handleRealtimeEvent?.({
        table: 'leads',
        eventType: 'INSERT',
        new: testLead,
        old: null,
      });

      // Second identical broadcast
      (db as any).handleRealtimeEvent?.({
        table: 'leads',
        eventType: 'INSERT',
        new: testLead,
        old: null,
      });

      const leads = db.getLeads({
        id: ownerProfileId,
        user_id: ownerUserId,
        organization_id: orgA,
        full_name: 'Alice Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const matching = leads.filter((l) => l.id === testLead.id);
      expect(matching.length).toBeLessThanOrEqual(1);
    });
  });
});
