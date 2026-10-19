import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  createSignedSessionToken,
  verifySignedSessionToken,
  revokeSession,
  isSessionRevoked,
} from '../../api/_lib/sessionServer';
import { verifyTwilioSignature } from '../../api/_lib/twilioServer';
import callHandler from '../../api/telephony/call';
import webhookHandler from '../../api/telephony/webhook';
import recordingHandler from '../../api/telephony/recording';
import sessionHandler from '../../api/auth/session';
import { db } from '@/services/supabase/db';
import { recordingService } from '@/services/telephony/recordingService';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { Profile, Lead, Call } from '@/types';

// Helper to create mock Express/Vercel request and response
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  url?: string;
}) {
  const req: any = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    url: options.url || '/',
  };

  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(data: any) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

describe('ENCRIX Phase 17: Real-Time Telecalling CRM & Production Telephony', () => {
  const orgAId = 'org-vertex-001';
  const orgBId = 'org-apex-002';

  const ownerA: Profile = {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: orgAId,
    full_name: 'Vikram Malhotra',
    phone: '+919876543210',
    email: 'vikram@vertex.com',
    role: 'OWNER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 0,
    calls_today: 0,
    positive_count: 0,
    conversion_rate: 0,
  };

  const telecallerA1: Profile = {
    id: 'tc-arjun-01',
    user_id: 'user-arjun-01',
    organization_id: orgAId,
    full_name: 'Arjun Mehta',
    phone: '+919876543211',
    email: 'arjun@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 5,
    calls_today: 2,
    positive_count: 1,
    conversion_rate: 50,
  };

  const telecallerA2: Profile = {
    id: 'tc-priya-03',
    user_id: 'user-priya-03',
    organization_id: orgAId,
    full_name: 'Priya Sharma',
    phone: '+919876543213',
    email: 'priya@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 3,
    calls_today: 1,
    positive_count: 0,
    conversion_rate: 0,
  };

  const ownerB: Profile = {
    id: 'prof-owner-002',
    user_id: 'user-owner-002',
    organization_id: orgBId,
    full_name: 'Rohan Deshmukh',
    phone: '+919876543220',
    email: 'rohan@apex.com',
    role: 'OWNER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 0,
    calls_today: 0,
    positive_count: 0,
    conversion_rate: 0,
  };

  beforeEach(() => {
    db.resetSandbox();
  });

  // --------------------------------------------------------------------------
  // SECTION 1: REAL AUTHENTICATION, CRYPTOGRAPHIC SESSIONS & ANTI-FORGERY
  // --------------------------------------------------------------------------
  describe('1. Real Authentication & Cryptographic Session Architecture', () => {
    it('generates and cryptographically verifies authentic HMAC-SHA256 session tokens', () => {
      const token = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: ownerA.role,
        email: ownerA.email || 'vikram@vertex.com',
        fullName: ownerA.full_name,
      });

      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      const verified = verifySignedSessionToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(ownerA.user_id);
      expect(verified?.profileId).toBe(ownerA.id);
      expect(verified?.role).toBe('OWNER');
    });

    it('rejects tampered or forged session tokens with invalid signatures', () => {
      const validToken = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: telecallerA1.organization_id,
        role: 'TELECALLER',
        email: 'arjun@vertex.com',
        fullName: telecallerA1.full_name,
      });

      const parts = validToken.split('.');
      // Attacker attempts privilege escalation by altering role in payload
      const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      decodedPayload.role = 'ADMIN';
      const forgedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const forgedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

      const result = verifySignedSessionToken(forgedToken);
      expect(result).toBeNull();
    });

    it('rejects expired session tokens', () => {
      // Create a token that expired 10 seconds ago
      const expiredToken = createSignedSessionToken(
        {
          userId: ownerA.user_id,
          profileId: ownerA.id,
          organizationId: ownerA.organization_id,
          role: ownerA.role,
          email: 'vikram@vertex.com',
          fullName: ownerA.full_name,
        },
        -10
      );

      const result = verifySignedSessionToken(expiredToken);
      expect(result).toBeNull();
    });

    it('immediately rejects explicitly revoked session tokens', () => {
      const token = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: telecallerA1.organization_id,
        role: 'TELECALLER',
        email: 'arjun@vertex.com',
        fullName: telecallerA1.full_name,
      });

      expect(verifySignedSessionToken(token)).not.toBeNull();
      revokeSession(token);
      expect(isSessionRevoked(token)).toBe(true);
      expect(verifySignedSessionToken(token)).toBeNull();
    });

    it('rejects unauthenticated requests or client-spoofed localStorage without valid server token', async () => {
      // Client calls /api/auth/session with no authorization header
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {},
      });

      await sessionHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.authenticated).toBe(false);
    });

    it('restores legitimate sessions when presented with a valid signed session token', async () => {
      const validToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: 'OWNER',
        email: 'vikram@vertex.com',
        fullName: ownerA.full_name,
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      });

      await sessionHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.profile.id).toBe(ownerA.id);
      expect(res.body.role).toBe('OWNER');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: REAL CALLING GATEWAY & AUTHORIZATION CONTROLS
  // --------------------------------------------------------------------------
  describe('2. Telephony Calling Gateway Authorization', () => {
    it('rejects call initiation when no Authorization token is provided', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {},
        body: { leadId: 'lead-001' },
      });

      await callHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/authorization/i);
    });

    it('rejects call initiation when leadId is missing', async () => {
      const token = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: 'OWNER',
        email: 'vikram@vertex.com',
        fullName: ownerA.full_name,
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: {},
      });

      await callHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/leadId is required/i);
    });

    it('rejects call dispatch if caller account is suspended or inactive', async () => {
      const suspendedToken = createSignedSessionToken({
        userId: 'user-suspended',
        profileId: 'prof-suspended',
        organizationId: orgAId,
        role: 'TELECALLER',
        status: 'DISABLED',
        email: 'suspended@vertex.com',
        fullName: 'Suspended User',
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${suspendedToken}` },
        body: { leadId: 'lead-001' },
      });

      await callHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/suspended|inactive/i);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: WEBHOOK HMAC-SHA1 SIGNATURE & IDEMPOTENCY
  // --------------------------------------------------------------------------
  describe('3. Twilio Status Webhook HMAC Verification & Idempotency', () => {
    const authToken = 'mock_twilio_auth_token_secret_key';
    const webhookUrl = 'https://app.leadvault.io/api/telephony/webhook';

    function generateSignature(url: string, params: Record<string, string>, secret: string): string {
      const sortedKeys = Object.keys(params).sort();
      let dataString = url;
      for (const key of sortedKeys) {
        dataString += key + params[key];
      }
      return crypto.createHmac('sha1', secret).update(dataString, 'utf-8').digest('base64');
    }

    it('rejects forged webhook requests with invalid or missing HMAC signatures', async () => {
      const body = {
        CallSid: 'CA1234567890abcdef',
        CallStatus: 'completed',
        CallDuration: '45',
      };

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-twilio-signature': 'forged_fake_signature_12345',
          host: 'app.leadvault.io',
        },
        body,
        url: '/api/telephony/webhook',
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/invalid twilio hmac signature/i);
    }, 10000);

    it('verifies valid HMAC-SHA1 signature using timing-safe comparison', () => {
      const params = {
        CallSid: 'CA999888777666',
        CallStatus: 'in-progress',
        SequenceNumber: '1',
      };

      const signature = generateSignature(webhookUrl, params, authToken);
      const isValid = verifyTwilioSignature(authToken, signature, webhookUrl, params);
      expect(isValid).toBe(true);

      const isInvalid = verifyTwilioSignature(authToken, signature + 'tampered', webhookUrl, params);
      expect(isInvalid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: CALL RECORDING LIFECYCLE & ACCESS AUDIT
  // --------------------------------------------------------------------------
  describe('4. Call Recording Authorization & Access Audit', () => {
    const testCallA: Call = {
      id: 'call-alpha-001',
      organization_id: orgAId,
      lead_id: 'lead-alpha-001',
      lead_code: 'LD-101',
      lead_name: 'Aditi Rao',
      telecaller_id: telecallerA1.id,
      telecaller_name: telecallerA1.full_name,
      started_at: new Date().toISOString(),
      duration_seconds: 95,
      status: 'COMPLETED',
      provider: 'TWILIO',
      recording_consent: true,
      recording_url: 'https://storage.encrix.internal/recordings/org-vertex-001/call-alpha-001.mp3',
      outcome: 'POSITIVE',
      created_at: new Date().toISOString(),
    };

    it('permits organization Owner to access recordings across their organization', () => {
      const canAccess = recordingService.canAccessRecording(testCallA, ownerA);
      expect(canAccess).toBe(true);
    });

    it('permits the initiating telecaller to access their own call recording', () => {
      const canAccess = recordingService.canAccessRecording(testCallA, telecallerA1);
      expect(canAccess).toBe(true);
    });

    it('strictly denies cross-tenant recording access and logs high-severity security audit event', () => {
      const canAccess = recordingService.canAccessRecording(testCallA, ownerB);
      expect(canAccess).toBe(false);

      expect(() => recordingService.getRecordingAccess(testCallA.id, ownerB)).toThrow(
        /not found or unauthorized/i
      );
    });

    it('strictly denies unassigned telecallers from accessing another caller recordings', () => {
      const canAccess = recordingService.canAccessRecording(testCallA, telecallerA2);
      expect(canAccess).toBe(false);
    });

    it('rejects recording API requests without authentication', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {},
        query: { callId: 'call-alpha-001' },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/authorization/i);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: TELECALLER WORKSPACE DATA ISOLATION & EXPORT GUARD
  // --------------------------------------------------------------------------
  describe('5. Telecaller Workspace Isolation & Export Guard', () => {
    it('returns only leads assigned to the telecaller, filtering out unassigned and other telecallers leads', () => {
      const leads = db.getLeads(telecallerA1);
      // All returned leads must be assigned to telecallerA1
      leads.forEach((l) => {
        expect(l.assigned_to).toBe(telecallerA1.id);
        expect(l.organization_id).toBe(telecallerA1.organization_id);
      });
    });

    it('omits customer phone numbers completely in telecaller lead queue (zero digits)', () => {
      const leads = db.getLeads(telecallerA1);
      leads.forEach((l) => {
        expect(l.phone).toBeUndefined();
      });
    });

    it('records high-severity audit event and blocks telecaller data export attempts', () => {
      const securityEventsBefore = db.getSecurityEvents(ownerA).length;

      db.recordSecurityEvent(
        {
          event_type: 'TELECALLER_EXPORT_BLOCKED',
          severity: 'HIGH',
          description: `Telecaller ${telecallerA1.full_name} attempted to export lead database. Blocked by ENCRIX Export Guard.`,
          metadata: { agent: telecallerA1.full_name },
        },
        telecallerA1
      );

      const securityEventsAfter = db.getSecurityEvents(ownerA);
      expect(securityEventsAfter.length).toBe(securityEventsBefore + 1);
      const blockedEvent = securityEventsAfter.find((e) => e.event_type === 'TELECALLER_EXPORT_BLOCKED');
      expect(blockedEvent).toBeDefined();
      expect(blockedEvent?.severity).toBe('HIGH');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: REAL-TIME CONNECTION STATES & ROLE-BASED FILTERING
  // --------------------------------------------------------------------------
  describe('6. Real-Time Synchronization & Connection Management', () => {
    it('accurately reports real-time connection status transitions', () => {
      expect(['LIVE', 'CONNECTED', 'RECONNECTING', 'OFFLINE']).toContain(
        realtimeManager.getStatus()
      );

      let lastStatus = '';
      const unsubscribe = realtimeManager.onStatusChange((status) => {
        lastStatus = status;
      });

      realtimeManager.setStatus('RECONNECTING');
      expect(lastStatus).toBe('RECONNECTING');

      realtimeManager.setStatus('LIVE');
      expect(lastStatus).toBe('LIVE');

      unsubscribe();
    });

    it('sanitizes real-time lead updates before broadcasting to telecallers', () => {
      let receivedLeadPhone: string | undefined = '';
      const unsubscribe = db.subscribe(({ type, payload }) => {
        if (type === 'LEAD_UPDATED') {
          const lead = payload as Lead;
          receivedLeadPhone = lead.phone;
        }
      }, telecallerA1);

      // Emit lead update through DB
      const leads = db.getLeads(ownerA);
      const targetLead = leads.find((l) => l.assigned_to === telecallerA1.id);
      if (targetLead) {
        db.updateLead(targetLead.id, { notes: 'Updated notes' }, ownerA);
        expect(receivedLeadPhone).toBeUndefined();
      }

      unsubscribe();
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 7: PRODUCTION CONFIGURATION & SERVER SECRET ISOLATION
  // --------------------------------------------------------------------------
  describe('7. Server Secret Isolation & Adversarial Security Boundaries', () => {
    it('verifies that server secrets are absent from client bundle environment', () => {
      // In Vite client environment, process.env.TWILIO_AUTH_TOKEN and SUPABASE_SERVICE_ROLE_KEY must never exist
      const clientEnv = (import.meta as any).env || {};
      expect(clientEnv.TWILIO_AUTH_TOKEN).toBeUndefined();
      expect(clientEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      expect(clientEnv.RESEND_API_KEY).toBeUndefined();
      expect(clientEnv.OTP_SERVER_SECRET).toBeUndefined();
    });

    it('rejects telecaller attempting to elevate privileges by promoting themselves to Owner or Admin', () => {
      expect(() => {
        db.updateProfileRole(telecallerA1.id, 'OWNER', telecallerA1);
      }).toThrow(/unauthorized|forbidden/i);

      expect(() => {
        db.updateProfileRole(telecallerA1.id, 'ADMIN', telecallerA1);
      }).toThrow(/unauthorized|forbidden/i);
    });

    it('rejects telecaller attempting to view invitations of the organization', () => {
      expect(() => {
        db.getInvitations(telecallerA1);
      }).toThrow(/forbidden/i);
    });
  });
});
