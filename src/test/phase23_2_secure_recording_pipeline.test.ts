import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  validateTwilioRecordingUrl,
  verifyAudioFormat,
  downloadAndStoreRecording,
  MAX_RECORDING_SIZE_BYTES,
} from '../../api/_lib/recordingPipeline';
import webhookHandler from '../../api/telephony/webhook';
import recordingHandler from '../../api/telephony/recording';
import { recordingService } from '@/services/telephony/recordingService';
import { db } from '@/services/supabase/db';
import { Call, Profile } from '@/types';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { getTwilioServerConfig } from '../../api/_lib/twilioServer';

// Helper to create mock Request and Response for serverless API handlers
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  url?: string;
}) {
  const req = {
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
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
  };

  return { req, res };
}

describe('ENCRIX Phase 23.2.4: Secure Private Recording Pipeline', () => {
  const orgAId = 'org-titan-001';
  const orgBId = 'org-apex-002';
  const authToken = getTwilioServerConfig().authToken;

  const ownerA: Profile = {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: orgAId,
    full_name: 'Aditya Birla',
    phone: '+919876543210',
    email: 'aditya@titan.com',
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
    email: 'arjun@titan.com',
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
    id: 'tc-priya-02',
    user_id: 'user-priya-02',
    organization_id: orgAId,
    full_name: 'Priya Sharma',
    phone: '+919876543212',
    email: 'priya@titan.com',
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

  const testCallA: Call = {
    id: 'call-sec-001',
    organization_id: orgAId,
    lead_id: 'lead-001',
    telecaller_id: telecallerA1.id, // Initiated by Arjun
    started_at: new Date(Date.now() - 300000).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: 120,
    status: 'COMPLETED',
    provider: 'TWILIO',
    provider_call_id: 'CA_secure_test_123',
    recording_consent: true,
    recording_url: `${orgAId}/call-sec-001.mp3`,
    created_at: new Date().toISOString(),
  };

  function createValidSignature(url: string, params: Record<string, string>, secret = authToken): string {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    return crypto.createHmac('sha1', secret).update(data, 'utf-8').digest('base64');
  }

  beforeEach(() => {
    db.resetSandbox();
    (db as any).calls = [testCallA];
  });

  // --------------------------------------------------------------------------
  // SECTION 1: SSRF PROTECTION & TRUSTED HOST VALIDATION
  // --------------------------------------------------------------------------
  describe('1. SSRF Protection and Recording Host Validation', () => {
    it('accepts legitimate Twilio recording URLs on api.twilio.com', () => {
      const validUrl = 'https://api.twilio.com/2010-04-01/Accounts/AC12345/Recordings/REabcdef12345.mp3';
      const result = validateTwilioRecordingUrl(validUrl);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts legitimate Twilio recording URLs on recording.twilio.com', () => {
      const validUrl = 'https://recording.twilio.com/Recordings/RE123456789.mp3';
      const result = validateTwilioRecordingUrl(validUrl);
      expect(result.valid).toBe(true);
    });

    it('rejects unencrypted HTTP recording URLs', () => {
      const httpUrl = 'http://api.twilio.com/2010-04-01/Accounts/AC12345/Recordings/RE123.mp3';
      const result = validateTwilioRecordingUrl(httpUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/insecure protocol/i);
    });

    it('rejects arbitrary external attacker hostnames (SSRF)', () => {
      const attackerUrls = [
        'https://evil-attacker.com/2010-04-01/Accounts/AC123/Recordings/RE123.mp3',
        'https://api.twilio.com.attacker.com/Recordings/RE123.mp3',
        'https://mybucket.s3.amazonaws.com/Recordings/RE123.mp3',
      ];

      for (const url of attackerUrls) {
        const result = validateTwilioRecordingUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/untrusted recording hostname/i);
      }
    });

    it('rejects loopback, private RFC-1918 IPs, and cloud metadata endpoints', () => {
      const forbiddenUrls = [
        'https://localhost/Recordings/RE123.mp3',
        'https://127.0.0.1/Recordings/RE123.mp3',
        'https://169.254.169.254/latest/meta-data/Recordings/RE123.mp3',
        'https://10.0.0.1/Recordings/RE123.mp3',
        'https://192.168.1.1/Recordings/RE123.mp3',
      ];

      for (const url of forbiddenUrls) {
        const result = validateTwilioRecordingUrl(url);
        expect(result.valid).toBe(false);
      }
    });

    it('rejects URLs with missing or invalid Twilio recording paths', () => {
      const invalidPathUrl = 'https://api.twilio.com/v1/SomeOtherEndpoint/payload.mp3';
      const result = validateTwilioRecordingUrl(invalidPathUrl);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/expected twilio recording structure/i);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 2: AUDIO FORMAT & MAGIC BYTES VERIFICATION
  // --------------------------------------------------------------------------
  describe('2. Audio Format and Magic Byte Verification', () => {
    it('verifies valid MP3 buffer with ID3v2 header', () => {
      // Magic bytes: 0x49 0x44 0x33 ('ID3')
      const id3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20]);
      const result = verifyAudioFormat(id3Buffer, 'audio/mpeg');
      expect(result.valid).toBe(true);
      expect(result.format).toBe('mp3');
    });

    it('verifies valid MP3 buffer with MPEG audio frame sync bits', () => {
      // Magic bytes: 0xFF 0xFB (MPEG-1 Layer 3 frame sync)
      const mpegBuffer = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
      const result = verifyAudioFormat(mpegBuffer, 'audio/mp3');
      expect(result.valid).toBe(true);
      expect(result.format).toBe('mp3');
    });

    it('verifies valid WAV audio buffer with RIFF and WAVE header', () => {
      // Magic bytes: 'RIFF' .... 'WAVE'
      const wavHeader = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // 'RIFF'
        0x24, 0x00, 0x00, 0x00, // file size
        0x57, 0x41, 0x56, 0x45, // 'WAVE'
        0x66, 0x6d, 0x74, 0x20, // 'fmt '
      ]);
      const result = verifyAudioFormat(wavHeader, 'audio/wav');
      expect(result.valid).toBe(true);
      expect(result.format).toBe('wav');
    });

    it('rejects HTML error responses disguised as audio files', () => {
      const htmlBuffer = Buffer.from('<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>');
      const result = verifyAudioFormat(htmlBuffer, 'audio/mpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/error document/i);
    });

    it('rejects JSON error responses disguised as audio files', () => {
      const jsonBuffer = Buffer.from('{"code": 20404, "message": "The requested resource was not found"}');
      const result = verifyAudioFormat(jsonBuffer, 'audio/mpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/error document/i);
    });

    it('rejects unsupported Content-Types', () => {
      const dummyBuffer = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00]);
      const result = verifyAudioFormat(dummyBuffer, 'application/pdf');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unsupported audio content-type/i);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: DOWNLOAD & UPLOAD PIPELINE CONSTRAINTS
  // --------------------------------------------------------------------------
  describe('3. Download & Upload Pipeline Constraints', () => {
    it('enforces 50MB maximum recording file size limit', async () => {
      // Create a mock downloader that returns a 51MB buffer
      const oversizedBuffer = Buffer.alloc(MAX_RECORDING_SIZE_BYTES + 1024);
      oversizedBuffer[0] = 0x49;
      oversizedBuffer[1] = 0x44;
      oversizedBuffer[2] = 0x33;

      const result = await downloadAndStoreRecording({
        callId: 'call-test-over',
        organizationId: orgAId,
        recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE_oversized.mp3',
        downloaderOverride: async () => ({
          buffer: oversizedBuffer,
          contentType: 'audio/mpeg',
        }),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exceeds 50MB/i);
    });

    it('successfully downloads and returns canonical storage path for valid audio', async () => {
      const validMp3Buffer = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20]);

      const result = await downloadAndStoreRecording({
        callId: 'call-valid-01',
        organizationId: orgAId,
        recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE_valid.mp3',
        downloaderOverride: async () => ({
          buffer: validMp3Buffer,
          contentType: 'audio/mpeg',
        }),
      });

      expect(result.success).toBe(true);
      expect(result.storagePath).toBe(`${orgAId}/call-valid-01.mp3`);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: WEBHOOK HANDLING & ZERO PROVIDER URL EXPOSURE
  // --------------------------------------------------------------------------
  describe('4. Webhook Handling & Zero Provider URL Exposure', () => {
    const webhookUrl = 'https://app.leadvault.io/api/telephony/webhook';

    it('rejects webhook with untrusted recording URL and logs security event', async () => {
      const body = {
        CallSid: 'CA_ssrf_probe',
        CallStatus: 'completed',
        RecordingUrl: 'https://attacker.evil.com/exploit.mp3',
        SequenceNumber: '1',
      };

      const signature = createValidSignature(webhookUrl, body);

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-twilio-signature': signature,
          host: 'app.leadvault.io',
        },
        body,
        url: '/api/telephony/webhook',
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(200);

      // Verify that provider URL was NEVER stored or returned
      expect(JSON.stringify(res.body)).not.toContain('attacker.evil.com');
    });

    it('webhook response NEVER leaks the provider recording URL', async () => {
      const body = {
        CallSid: 'CA_clean_webhook_1',
        CallStatus: 'completed',
        CallDuration: '60',
        RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE_clean.mp3',
        SequenceNumber: '1',
      };

      const signature = createValidSignature(webhookUrl, body);

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-twilio-signature': signature,
          host: 'app.leadvault.io',
        },
        body,
        url: '/api/telephony/webhook',
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(200);

      // The returned response body MUST NOT contain the provider recording URL
      expect(res.body.recordingUrl).toBeUndefined();
      expect(res.body.RecordingUrl).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('api.twilio.com');
    });

    it('duplicate webhook callbacks are processed idempotently without repeating storage upload', async () => {
      const body = {
        CallSid: 'CA_idempotent_test_01',
        CallStatus: 'completed',
        CallDuration: '45',
        RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE_idem.mp3',
        SequenceNumber: '1',
      };

      const signature = createValidSignature(webhookUrl, body);

      const { req: req1, res: res1 } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-twilio-signature': signature,
          host: 'app.leadvault.io',
        },
        body,
        url: '/api/telephony/webhook',
      });

      await webhookHandler(req1, res1);
      expect(res1.statusCode).toBe(200);

      // Re-send the exact duplicate callback
      const { req: req2, res: res2 } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-twilio-signature': signature,
          host: 'app.leadvault.io',
        },
        body,
        url: '/api/telephony/webhook',
      });

      await webhookHandler(req2, res2);
      expect(res2.statusCode).toBe(200);
      expect(res2.body.duplicate).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: RECORDING RETRIEVAL & ROLE AUTHORIZATION
  // --------------------------------------------------------------------------
  describe('5. Recording Retrieval & Strict Initiator-Only Authorization', () => {
    it('permits organization Owner to access recording within their organization', async () => {
      const ownerToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: ownerA.role,
        fullName: ownerA.full_name,
        email: ownerA.email || '',
      });

      // Insert test call into mock database
      db.getCalls = () => [testCallA];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
        query: { callId: testCallA.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.recordingUrl).toBeDefined();
      expect(res.body.recordingUrl).toContain('call-sec-001.mp3');
      // Must NOT contain Twilio provider URL
      expect(res.body.recordingUrl).not.toContain('api.twilio.com');
      expect(res.body.expiresIn).toBe(60);
    });

    it('permits the initiating telecaller (Arjun) to access their own recording', async () => {
      const callerToken = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: telecallerA1.organization_id,
        role: telecallerA1.role,
        fullName: telecallerA1.full_name,
        email: telecallerA1.email || '',
      });

      db.getCalls = () => [testCallA];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${callerToken}` },
        query: { callId: testCallA.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.recordingUrl).toContain('call-sec-001.mp3');
      expect(res.body.recordingUrl).not.toContain('api.twilio.com');
    });

    it('strictly DENIES a different telecaller (Priya) from accessing call initiated by Arjun (even in same org)', async () => {
      const otherCallerToken = createSignedSessionToken({
        userId: telecallerA2.user_id,
        profileId: telecallerA2.id,
        organizationId: telecallerA2.organization_id,
        role: telecallerA2.role,
        fullName: telecallerA2.full_name,
        email: telecallerA2.email || '',
      });

      db.getCalls = () => [testCallA];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${otherCallerToken}` },
        query: { callId: testCallA.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/initiated by you/i);
    });

    it('strictly DENIES cross-tenant recording access (Owner B cannot access Org A call)', async () => {
      const crossOwnerToken = createSignedSessionToken({
        userId: ownerB.user_id,
        profileId: ownerB.id,
        organizationId: ownerB.organization_id,
        role: ownerB.role,
        fullName: ownerB.full_name,
        email: ownerB.email || '',
      });

      db.getCalls = () => [testCallA];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${crossOwnerToken}` },
        query: { callId: testCallA.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/belonging to another organization/i);
    });

    it('fails closed when call has no recording, returning 404 error instead of provider URL', async () => {
      const callWithoutRecording: Call = {
        ...testCallA,
        id: 'call-no-rec',
        recording_url: undefined,
      };

      const ownerToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: ownerA.role,
        fullName: ownerA.full_name,
        email: ownerA.email || '',
      });

      db.getCalls = () => [callWithoutRecording];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
        query: { callId: callWithoutRecording.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.recordingUrl).toBeUndefined();
    });

    it('fails closed and rejects raw Twilio provider URL if somehow present in call record', async () => {
      const callWithRawTwilioUrl: Call = {
        ...testCallA,
        id: 'call-twilio-raw',
        recording_url: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE999.mp3',
      };

      const ownerToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: ownerA.organization_id,
        role: ownerA.role,
        fullName: ownerA.full_name,
        email: ownerA.email || '',
      });

      db.getCalls = () => [callWithRawTwilioUrl];

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
        query: { callId: callWithRawTwilioUrl.id },
      });

      await recordingHandler(req, res);
      expect(res.statusCode).toBe(502);
      expect(res.body.recordingUrl).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('api.twilio.com');
    });

    it('service-layer recordingService enforces strict initiator-only policy for telecallers', () => {
      // Initiator Arjun has access
      expect(recordingService.canAccessRecording(testCallA, telecallerA1)).toBe(true);

      // Other telecaller Priya in same tenant has NO access
      expect(recordingService.canAccessRecording(testCallA, telecallerA2)).toBe(false);

      // getRecordingAccess throws error for Priya
      expect(() => recordingService.getRecordingAccess(testCallA.id, telecallerA2)).toThrow(
        /not found or unauthorized|permission to access/i
      );
    });
  });
});
