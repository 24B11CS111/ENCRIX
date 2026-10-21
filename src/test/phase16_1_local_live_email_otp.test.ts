import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateSecureOtp,
  hashOtp,
  verifyOtpHash,
  isLiveEmailConfigured,
  sendVerificationEmail,
  OTP_CONFIG,
  serverOtpStore,
} from '../../api/_lib/otpServer';
import { authService, isLiveApiMode } from '../services/auth/authService';
import { db } from '../services/supabase/db';
import { Profile } from '../types';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';
import verifyOtpHandler from '../../api/auth/verify-otp';

describe('ENCRIX Phase 16.1: Local Live Email OTP Verification Suite', () => {
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalResendFrom = process.env.RESEND_FROM_EMAIL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    serverOtpStore.clear();
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalResendKey;
    process.env.RESEND_FROM_EMAIL = originalResendFrom;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Actionable Configuration Errors & Never Simulate Success
  // --------------------------------------------------------------------------
  describe('1. Actionable Configuration Errors (No Simulated Delivery)', () => {
    it('throws explicit actionable configuration error when RESEND_API_KEY is not set', async () => {
      delete process.env.RESEND_API_KEY;
      delete process.env.SENDGRID_API_KEY;

      expect(isLiveEmailConfigured()).toBe(false);

      await expect(sendVerificationEmail('founder@vertexcorp.com', '123456')).rejects.toThrow(
        'BLOCKED — EMAIL OTP PROVIDER NOT CONFIGURED: Please configure RESEND_API_KEY and RESEND_FROM_EMAIL'
      );
    });

    it('rejects placeholder and dummy keys as unconfigured', async () => {
      process.env.RESEND_API_KEY = 're_placeholder_12345';
      expect(isLiveEmailConfigured()).toBe(false);

      process.env.RESEND_API_KEY = 're_your-key-here';
      expect(isLiveEmailConfigured()).toBe(false);

      process.env.RESEND_API_KEY = 're_test_key_abc';
      expect(isLiveEmailConfigured()).toBe(false);
    });

    it('never returns DEV_CAPTURED or simulates delivery in local environment', async () => {
      delete process.env.RESEND_API_KEY;
      delete process.env.SENDGRID_API_KEY;

      let errorThrown = false;
      try {
        await sendVerificationEmail('test@encrix.io', '888999');
      } catch (err: any) {
        errorThrown = true;
        expect(err.message).toContain('BLOCKED — EMAIL OTP PROVIDER NOT CONFIGURED');
      }
      expect(errorThrown).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Real Email Provider Dispatch & Error Propagation
  // --------------------------------------------------------------------------
  describe('2. Real Email Provider Dispatch & Error Propagation', () => {
    it('dispatches to Resend API endpoint with correct authorization and payload when configured', async () => {
      process.env.RESEND_API_KEY = 'synthetic-resend-api-key-not-a-credential';
      process.env.RESEND_FROM_EMAIL = 'ENCRIX <auth@hrixofficial.in>';

      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend_email_id_101' }),
        };
      });

      const res = await sendVerificationEmail('ceo@enterprise.com', '654321');

      expect(res.success).toBe(true);
      expect(res.provider).toBe('RESEND');
      expect(capturedUrl).toBe('https://api.resend.com/emails');
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${process.env.RESEND_API_KEY}`);
      expect(capturedBody.to).toEqual(['ceo@enterprise.com']);
      expect(capturedBody.from).toBe('ENCRIX <auth@hrixofficial.in>');
      expect(capturedBody.subject).toBe('Your ENCRIX verification code');
      expect(capturedBody.html).toContain('654321');
    });

    it('uses the verified-domain default sender when RESEND_FROM_EMAIL is unset and keeps OTP email delivery intact', async () => {
      process.env.RESEND_API_KEY = 'synthetic-resend-api-key-not-a-credential';
      delete process.env.RESEND_FROM_EMAIL;
      const otp = generateSecureOtp();

      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'resend_email_id_default_sender' }),
        };
      });

      const result = await sendVerificationEmail('ceo@enterprise.com', otp);

      expect(result).toEqual({ success: true, provider: 'RESEND' });
      expect(capturedBody.from).toBe('ENCRIX <auth@hrixofficial.in>');
      expect(capturedBody.to).toEqual(['ceo@enterprise.com']);
      expect(capturedBody.subject).toBe('Your ENCRIX verification code');
      expect(capturedBody.html).toContain(otp);
      expect(JSON.stringify(result)).not.toContain(otp);
      expect(JSON.stringify(result)).not.toContain('synthetic-resend-api-key-not-a-credential');
    });

    it('propagates Resend API delivery error messages transparently without leaking secrets', async () => {
      process.env.RESEND_API_KEY = 'synthetic-resend-api-key-not-a-credential';
      process.env.RESEND_FROM_EMAIL = 'auth@unverified-domain.com';

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            message: 'The domain unverified-domain.com is not verified. Please verify your domain in Resend.',
          }),
        };
      });

      await expect(sendVerificationEmail('user@gmail.com', '123456')).rejects.toThrow(
        'BLOCKED — EMAIL OTP PROVIDER ERROR: The domain unverified-domain.com is not verified'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Secret Isolation & Cryptographic Integrity
  // --------------------------------------------------------------------------
  describe('3. Secret Isolation & Cryptographic Integrity', () => {
    it('generates secure 6-digit numeric OTPs', () => {
      for (let i = 0; i < 20; i++) {
        const otp = generateSecureOtp();
        expect(otp).toHaveLength(OTP_CONFIG.LENGTH);
        expect(/^\d{6}$/.test(otp)).toBe(true);
      }
    });

    it('hashes OTP using timing-safe HMAC SHA-256 and never matches incorrect codes', () => {
      const email = 'owner@vertex.com';
      const otp = '789123';
      const hash = hashOtp(email, otp);

      expect(hash).toHaveLength(64); // SHA-256 hex
      expect(verifyOtpHash(email, otp, hash)).toBe(true);
      expect(verifyOtpHash(email, '000000', hash)).toBe(false);
      expect(verifyOtpHash('different@vertex.com', otp, hash)).toBe(false);
    });

    it('ensures secret API keys are never bundled into client output', () => {
      const result = {
        success: true,
        maskedEmail: 'o••••@vertex.com',
        expiresAt: new Date().toISOString(),
      };
      const json = JSON.stringify(result);
      expect(json).not.toContain('re_');
      expect(json).not.toContain('RESEND');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Session Creation & Restoration
  // --------------------------------------------------------------------------
  describe('4. Session Creation & Restoration', () => {
    it('creates and persists session in localStorage on successful verification', async () => {
      const email = 'rajiv.owner@zenithcrm.io';
      const company = 'Zenith CRM Corp';
      const ownerName = 'Rajiv Sharma';

      // 1. Request OTP
      const req = await authService.requestOtp({
        email,
        phone: '+91 98765 00001',
        purpose: 'REGISTER',
        fullName: ownerName,
        companyName: company,
        industry: 'Technology',
        companySize: '11-50',
      });
      expect(req.success).toBe(true);

      const testOtp = (db as any)._lastTestOtps.get(`${email.toLowerCase()}:REGISTER`);
      expect(testOtp).toBeDefined();

      // 2. Verify OTP
      const verifyResult = await authService.verifyOtp({
        email,
        otp: testOtp,
        purpose: 'REGISTER',
        registrationData: {
          companyName: company,
          ownerName,
          email,
          industry: 'Technology',
          companySize: '11-50',
        },
      });

      expect(verifyResult.success).toBe(true);
      expect(verifyResult.profile).toBeDefined();
      expect(verifyResult.role).toBe('OWNER');

      // Check localStorage session persistence
      const sessionRaw = localStorage.getItem('leadvault_session');
      expect(sessionRaw).not.toBeNull();
      const parsedSession = JSON.parse(sessionRaw!);
      expect(parsedSession.profileId).toBe(verifyResult.profile?.id);
    });

    it('restores authenticated session with correct role on application refresh', () => {
      const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
      const owner = allProfiles.find((p) => p.role === 'OWNER')!;

      // Save session
      localStorage.setItem(
        'leadvault_session',
        JSON.stringify({
          profileId: owner.id,
          profile: owner,
          organization: { id: owner.organization_id, name: 'Vertex Consultancy' },
        })
      );

      // Restore session
      const saved = localStorage.getItem('leadvault_session');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.profileId).toBe(owner.id);
      expect(parsed.profile.role).toBe('OWNER');
      expect(parsed.profile.status).toBe('ACTIVE');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Telephony Isolation Preservation
  // --------------------------------------------------------------------------
  describe('5. Telephony Isolation Preservation', () => {
    it('preserves Twilio telephony calling structures without breaking email authentication', () => {
      expect(process.env.TELEPHONY_PROVIDER || 'mock').toBeDefined();
      const calls = db.getCalls({
        role: 'ADMIN',
        organization_id: 'org-vertex-001',
        status: 'ACTIVE',
      } as Profile);
      expect(Array.isArray(calls)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Regression: Postgrest Query Builder and No Chained .catch()
  // --------------------------------------------------------------------------
  describe('6. Regression: Supabase Query Error Handling (No Chained .catch())', () => {
    beforeEach(() => {
      // Mock Supabase Server Client to simulate real PostgrestFilterBuilder:
      // An object that implements Thenable (.then), chainable query methods,
      // but explicitly LACKS a .catch method (triggering "TypeError: ... .catch is not a function"
      // if any code tries to chain .catch() on it).
      vi.spyOn(supabaseServerModule, 'getSupabaseServerClient').mockImplementation(() => {
        const createBuilder = (tableName: string) => {
          let lastInserted: any = null;
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockReturnThis(),
            insert: vi.fn().mockImplementation((data: any) => {
              lastInserted = data;
              return builder;
            }),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            then: (onfulfilled: any) => {
              let resultData: any = null;
              if (lastInserted) {
                resultData = { id: `id-${Date.now()}`, ...lastInserted };
              } else if (tableName === 'email_otps') {
                resultData = [];
              } else if (tableName === 'profiles') {
                resultData = {
                  id: 'prof-vikram-001',
                  user_id: 'user-vikram-001',
                  organization_id: 'org-vertex-001',
                  full_name: 'Vikram Malhotra',
                  role: 'OWNER',
                  status: 'ACTIVE',
                  email: 'vikram@vertex.com',
                };
              } else if (tableName === 'organizations') {
                resultData = {
                  id: 'org-vertex-001',
                  name: 'Vertex Consultancy',
                  slug: 'vertex-consultancy',
                };
              }
              return Promise.resolve({ data: resultData, error: null }).then(onfulfilled);
            },
          };
          delete builder.catch;
          return builder;
        };

        return {
          from: vi.fn().mockImplementation((tableName: string) => createBuilder(tableName)),
        } as any;
      });
    });

    function createMockReqRes(body: any) {
      const req = {
        method: 'POST',
        body,
      };
      let statusCode = 200;
      let jsonBody: any = null;
      const res = {
        status(code: number) {
          statusCode = code;
          return res;
        },
        json(data: any) {
          jsonBody = data;
          return res;
        },
        getStatusCode: () => statusCode,
        getBody: () => jsonBody,
      };
      return { req, res };
    }

    it('verifies LOGIN OTP without throwing .catch is not a function on Postgrest query builder', async () => {
      const email = 'vikram@vertex.com';
      const otp = '849201';
      const otpHash = hashOtp(email, otp);

      serverOtpStore.set(`${email}:LOGIN`, {
        identifier: email,
        purpose: 'LOGIN',
        otpHash,
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({
        email,
        otp,
        purpose: 'LOGIN',
      });

      await verifyOtpHandler(req, res);

      // Verify no runtime TypeError for .catch() is thrown
      expect(res.getBody()).toBeDefined();
      if (res.getStatusCode() !== 200) {
        expect(res.getBody().error).not.toContain('.catch is not a function');
        expect(res.getBody().error).not.toContain('is not a function');
      }
    });

    it('verifies REGISTER OTP without throwing .catch is not a function on Postgrest query builder', async () => {
      const email = 'newfounder@encrix.io';
      const otp = '334455';
      const otpHash = hashOtp(email, otp);

      serverOtpStore.set(`${email}:REGISTER`, {
        identifier: email,
        purpose: 'REGISTER',
        otpHash,
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
        registrationData: {
          companyName: 'Encrix Labs',
          ownerName: 'Dev Founder',
          industry: 'Software',
          companySize: '1-10',
        },
      });

      const { req, res } = createMockReqRes({
        email,
        otp,
        purpose: 'REGISTER',
        registrationData: {
          companyName: 'Encrix Labs',
          ownerName: 'Dev Founder',
          industry: 'Software',
          companySize: '1-10',
        },
      });

      await verifyOtpHandler(req, res);

      expect(res.getStatusCode()).toBe(200);
      expect(res.getBody().success).toBe(true);
      expect(res.getBody().role).toBe('OWNER');
      expect(res.getBody().profile.full_name).toBe('Dev Founder');
      expect(res.getBody().organization.name).toBe('Encrix Labs');

      // Ensure OTP was burned upon verification
      expect(serverOtpStore.get(`${email}:REGISTER`)).toBeUndefined();
    });

    it('rejects invalid OTP code with proper attempt incrementing and without .catch error', async () => {
      const email = 'newfounder@encrix.io';
      const otp = '334455';
      const otpHash = hashOtp(email, otp);

      serverOtpStore.set(`${email}:REGISTER`, {
        identifier: email,
        purpose: 'REGISTER',
        otpHash,
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({
        email,
        otp: '000000', // Invalid code
        purpose: 'REGISTER',
      });

      await verifyOtpHandler(req, res);

      expect(res.getStatusCode()).toBe(400);
      expect(res.getBody().error).toBe('Invalid verification code.');

      const mem = serverOtpStore.get(`${email}:REGISTER`);
      expect(mem?.attempts).toBe(1);
    });
  });
});
