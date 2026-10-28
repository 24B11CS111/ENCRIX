import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import followUpsHandler from '../../api/follow-ups';
import ownerLeadsHandler from '../../api/_lib/leads/owner';
import leadDetailHandler from '../../api/_lib/leads/detail';
import teamHandler from '../../api/auth/team';
import voiceHandler from '../../api/telephony/voice';
import telephonyCallHandler from '../../api/telephony/call';
import webhookHandler from '../../api/telephony/webhook';
import sessionHandler from '../../api/auth/session';
import * as twilioServerModule from '../../api/_lib/twilioServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { realtimeManager } from '../../src/services/realtime/realtimeManager';
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
    send(data: any) {
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

describe('ENCRIX Phase 35: Live Integration Readiness & Deployment Audit', () => {
  const originalEnv = { ...process.env };

  const orgA = '11111111-1111-4111-8111-111111111111';
  const orgB = '22222222-2222-4222-8222-222222222222';

  const ownerUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerProfileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const telecallerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const telecallerProfileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  let ownerToken: string;
  let telecallerToken: string;
  let disabledOwnerToken: string;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENCRIX_SESSION_SECRET: 'test-session-secret-key-at-least-32-chars-long!',
      TWILIO_VOICE_WEBHOOK_URL: 'https://encrix.vercel.app/api/telephony/voice',
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

    disabledOwnerToken = createSignedSessionToken({
      userId: ownerUserId,
      profileId: ownerProfileId,
      organizationId: orgA,
      role: 'OWNER',
      fullName: 'Alice Owner',
      email: 'alice@encrix.com',
      status: 'DISABLED',
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Authentication & Tenant Boundary Integrity
  // =========================================================================
  describe('1. Authentication & Tenant Boundary Integrity', () => {
    it('disallows disabled account tokens from accessing protected endpoints', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${disabledOwnerToken}` },
      });

      await followUpsHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toMatch(/inactive or suspended/i);
    });

    it('rejects tampered or forged session tokens with 401', async () => {
      const tampered = `${ownerToken.split('.')[0]}.${ownerToken.split('.')[1]}.invalidsignature`;
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${tampered}` },
      });

      await followUpsHandler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body?.error).toMatch(/Invalid or expired auth token|Unauthorized/i);
    });

    it('ignores client-supplied organization_id in request query and enforces verified tenant context', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        query: { organization_id: orgB }, // Attempt to override tenant
        headers: { Authorization: `Bearer ${ownerToken}` }, // Verified org is orgA
      });

      await ownerLeadsHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
      // All returned leads must strictly match orgA
      const leads = res.body?.leads || [];
      for (const lead of leads) {
        expect(lead.organization_id).toBe(orgA);
      }
    });

    it('returns 404 on cross-tenant lead detail inspection to prevent tenant probing', async () => {
      // Create a lead in orgB
      const orgBProfile: Profile = {
        id: 'orgb-owner-id',
        user_id: 'orgb-user-id',
        organization_id: orgB,
        full_name: 'Org B Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const foreignLead = db.createLead(
        {
          name: 'Foreign Tenant Lead',
          phone: '+15559990000',
          source: 'Direct',
          priority: 'HIGH',
          status: 'NEW',
        },
        orgBProfile
      );

      // Caller from orgA attempts to inspect foreignLead.id
      const { req, res } = createMockReqRes({
        method: 'GET',
        query: { id: foreignLead.id },
        headers: { Authorization: `Bearer ${ownerToken}` },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body?.error).toMatch(/Lead not found or unauthorized/i);
    });

    it('blocks telecallers from accessing team management APIs', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${telecallerToken}` },
      });

      await teamHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body?.error).toMatch(/Only organization owners or administrators can manage team members/i);
    });
  });

  // =========================================================================
  // 2. Session Revocation & Logout
  // =========================================================================
  describe('2. Session Revocation & Logout', () => {
    it('revokes session token via DELETE /api/auth/session and rejects subsequent requests', async () => {
      const ephemeralToken = createSignedSessionToken({
        userId: 'temp-user-id',
        profileId: 'temp-prof-id',
        organizationId: orgA,
        role: 'TELECALLER',
        fullName: 'Temp Caller',
        email: 'temp@encrix.com',
        status: 'ACTIVE',
      });

      // Revoke
      const { req: delReq, res: delRes } = createMockReqRes({
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ephemeralToken}` },
      });

      await sessionHandler(delReq, delRes);
      expect(delRes.statusCode).toBe(200);
      expect(delRes.body?.success).toBe(true);

      // Subsequent session check with revoked token
      const { req: getReq, res: getRes } = createMockReqRes({
        method: 'GET',
        headers: { Authorization: `Bearer ${ephemeralToken}` },
      });

      await sessionHandler(getReq, getRes);
      expect(getRes.statusCode).toBe(401);
      expect(getRes.body?.authenticated).toBe(false);
    });
  });

  // =========================================================================
  // 3. Telephony Webhook Security
  // =========================================================================
  describe('3. Telephony Webhook Security', () => {
    it('voice webhook rejects requests with missing or invalid Twilio signature with 401', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/api/telephony/voice',
        headers: {
          'x-twilio-signature': 'invalid-signature-header',
        },
        body: {
          CallSid: 'CA00000000000000000000000000000000',
        },
      });

      await voiceHandler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body).toMatch(/Unauthorized/i);
    });

    it('rejects status callback with invalid duration characters', async () => {
      vi.spyOn(twilioServerModule, 'verifyTwilioSignature').mockReturnValue(true);

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/api/telephony/webhook',
        headers: {
          'x-twilio-signature': 'any-sig',
        },
        body: {
          CallSid: 'CA11111111111111111111111111111111',
          CallStatus: 'completed',
          CallDuration: 'invalid-duration-text',
        },
      });

      await webhookHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toMatch(/Invalid webhook/i);
    });
  });

  // =========================================================================
  // 4. Realtime Connection Manager Lifecycle
  // =========================================================================
  describe('4. Realtime Connection Manager Lifecycle', () => {
    it('manages organization context and cleans up listeners without residual timers', () => {
      realtimeManager.setOrganization(orgA);
      expect(realtimeManager.getStatus()).toBe('RECONNECTING');

      realtimeManager.setStatus('LIVE');
      expect(realtimeManager.getStatus()).toBe('LIVE');

      const spy = vi.fn();
      const unsub = realtimeManager.onStatusChange(spy);
      expect(spy).toHaveBeenCalledWith('LIVE');

      // Cleanup
      unsub();
      realtimeManager.cleanup();
      expect(realtimeManager.getStatus()).toBe('LIVE');
    });
  });
});
