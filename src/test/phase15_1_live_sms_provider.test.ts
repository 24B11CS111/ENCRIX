import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSecureOtp,
  hashOtp,
  verifyOtpHash,
  isLiveSmsConfigured,
  sendOtpSms,
  OTP_CONFIG,
} from '../../api/_lib/otpServer';
import { getTwilioServerConfig } from '../../api/_lib/twilioServer';
import { db } from '../services/supabase/db';
import { normalizePhoneNumber, formatMaskedPhone } from '../lib/phoneNormalization';

describe('ENCRIX Phase 15.1: Live OTP SMS Activation & Provider Integration Suite', () => {
  beforeEach(() => {
    db.resetSandbox(true);
    vi.restoreAllMocks();
  });

  describe('1. Cryptographic OTP Generation & Salted Hashing', () => {
    it('generates high-entropy 6-digit numeric OTPs', () => {
      const generated = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const otp = generateSecureOtp();
        expect(otp).toMatch(/^\d{6}$/);
        expect(otp.length).toBe(OTP_CONFIG.LENGTH);
        generated.add(otp);
      }
      // Probability of all 50 being distinct is > 99.9%
      expect(generated.size).toBeGreaterThan(45);
    });

    it('creates SHA-256 HMAC hash tied to phone number', () => {
      const phone1 = '+919876543210';
      const phone2 = '+919876543211';
      const otp = '482910';

      const hash1 = hashOtp(phone1, otp);
      const hash2 = hashOtp(phone2, otp);

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).not.toBe(hash2); // Different phones yield distinct hashes
    });

    it('performs timing-safe comparison rejecting forged or altered hashes', () => {
      const phone = '+919876543210';
      const correctOtp = '654321';
      const wrongOtp = '654322';
      const hash = hashOtp(phone, correctOtp);

      expect(verifyOtpHash(phone, correctOtp, hash)).toBe(true);
      expect(verifyOtpHash(phone, wrongOtp, hash)).toBe(false);
      expect(verifyOtpHash(phone, '123', hash)).toBe(false); // short
      expect(verifyOtpHash(phone, '1234567', hash)).toBe(false); // long
      expect(verifyOtpHash(phone, correctOtp, '')).toBe(false);
    });
  });

  describe('2. Provider Credentials Detection & Configuration Safety', () => {
    it('detects placeholder / test credentials and does not mark them as live', () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;

      try {
        process.env.TWILIO_ACCOUNT_SID = 'synthetic-placeholder-account-sid';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-placeholder-auth-token';
        expect(isLiveSmsConfigured()).toBe(false);

        process.env.TWILIO_ACCOUNT_SID = 'synthetic-mock-account-sid';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-mock-auth-token';
        expect(isLiveSmsConfigured()).toBe(false);

        process.env.TWILIO_ACCOUNT_SID = 'synthetic-test-account-sid';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-test-auth-token';
        expect(isLiveSmsConfigured()).toBe(false);
      } finally {
        process.env.TWILIO_ACCOUNT_SID = originalSid;
        process.env.TWILIO_AUTH_TOKEN = originalToken;
      }
    });

    it('identifies configured Twilio credentials using synthetic test values', () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      const originalPhone = process.env.TWILIO_PHONE_NUMBER;

      try {
        process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-sid-not-a-credential';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-auth-token-not-a-credential';
        process.env.TWILIO_PHONE_NUMBER = '+14155550199';

        expect(isLiveSmsConfigured()).toBe(true);

        const config = getTwilioServerConfig();
        expect(config.accountSid).toBe('synthetic-account-sid-not-a-credential');
        expect(config.callerId).toBe('+14155550199');
      } finally {
        process.env.TWILIO_ACCOUNT_SID = originalSid;
        process.env.TWILIO_AUTH_TOKEN = originalToken;
        process.env.TWILIO_PHONE_NUMBER = originalPhone;
      }
    });

    it('supports TWILIO_CALLER_ID as backwards-compatible fallback for TWILIO_PHONE_NUMBER', () => {
      const originalPhone = process.env.TWILIO_PHONE_NUMBER;
      const originalCaller = process.env.TWILIO_CALLER_ID;

      try {
        delete process.env.TWILIO_PHONE_NUMBER;
        process.env.TWILIO_CALLER_ID = '+15559876543';

        const config = getTwilioServerConfig();
        expect(config.callerId).toBe('+15559876543');
      } finally {
        process.env.TWILIO_PHONE_NUMBER = originalPhone;
        process.env.TWILIO_CALLER_ID = originalCaller;
      }
    });
  });

  describe('3. Professional SMS Content & Twilio Dispatch Formatting', () => {
    it('formats exact compliant verification message without leaking sensitive data', async () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      const originalPhone = process.env.TWILIO_PHONE_NUMBER;

      let capturedUrl = '';
      let capturedBody: any = null;
      let capturedAuth = '';

      const originalFetch = globalThis.fetch;

      try {
        process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-sid-not-a-credential';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-auth-token-not-a-credential';
        process.env.TWILIO_PHONE_NUMBER = '+14155552671';

        globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
          capturedUrl = url;
          capturedBody = new URLSearchParams(init.body);
          capturedAuth = init.headers.Authorization;
          return {
            ok: true,
            status: 201,
            json: async () => ({ sid: 'SM123456789', status: 'queued' }),
          };
        });

        const targetPhone = '+919876543210';
        const code = '583921';
        const result = await sendOtpSms(targetPhone, code);

        expect(result.success).toBe(true);
        expect(result.provider).toBe('TWILIO');
        expect(capturedUrl).toContain('/Accounts/synthetic-account-sid-not-a-credential/Messages.json');
        expect(capturedAuth).toMatch(/^Basic /);

        // Verify SMS Payload
        expect(capturedBody?.get('To')).toBe('+919876543210');
        expect(capturedBody?.get('From')).toBe('+14155552671');
        expect(capturedBody?.get('Body')).toBe(
          'Your ENCRIX verification code is 583921. It expires in 5 minutes. Do not share this code with anyone.'
        );

        // Sensitive information check
        const bodyText = capturedBody?.get('Body') || '';
        expect(bodyText).not.toContain('password');
        expect(bodyText).not.toContain('token');
        expect(bodyText).not.toContain('auth');
        expect(bodyText).not.toContain('secret');
      } finally {
        globalThis.fetch = originalFetch;
        process.env.TWILIO_ACCOUNT_SID = originalSid;
        process.env.TWILIO_AUTH_TOKEN = originalToken;
        process.env.TWILIO_PHONE_NUMBER = originalPhone;
      }
    });
  });

  describe('4. Error Handling & India Regulatory Safeguards', () => {
    it('detects Twilio India Geo Permission / DLT restriction (21408) and throws exact blocker', async () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      const originalPhone = process.env.TWILIO_PHONE_NUMBER;
      const originalFetch = globalThis.fetch;

      try {
        process.env.TWILIO_ACCOUNT_SID = 'synthetic-account-sid-not-a-credential';
        process.env.TWILIO_AUTH_TOKEN = 'synthetic-auth-token-not-a-credential';
        process.env.TWILIO_PHONE_NUMBER = '+14155552671';

        globalThis.fetch = vi.fn().mockImplementation(async () => {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              code: 21408,
              message: "Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +919876543210",
            }),
          };
        });

        await expect(sendOtpSms('+919876543210', '123456')).rejects.toThrow(
          /BLOCKED — SMS PROVIDER \/ INDIA DELIVERY CONFIGURATION REQUIRED/
        );
      } finally {
        globalThis.fetch = originalFetch;
        process.env.TWILIO_ACCOUNT_SID = originalSid;
        process.env.TWILIO_AUTH_TOKEN = originalToken;
        process.env.TWILIO_PHONE_NUMBER = originalPhone;
      }
    });

    it('throws BLOCKED — REAL SMS PROVIDER CREDENTIALS REQUIRED when in production without live credentials', async () => {
      const originalSid = process.env.TWILIO_ACCOUNT_SID;
      const originalToken = process.env.TWILIO_AUTH_TOKEN;
      const originalEnv = process.env.VITE_ENABLE_DEMO_SANDBOX;

      try {
        delete process.env.TWILIO_ACCOUNT_SID;
        delete process.env.TWILIO_AUTH_TOKEN;
        process.env.VITE_ENABLE_DEMO_SANDBOX = 'false'; // Production mode

        await expect(sendOtpSms('+919876543210', '123456')).rejects.toThrow(
          'BLOCKED — REAL SMS PROVIDER CREDENTIALS REQUIRED'
        );
      } finally {
        process.env.TWILIO_ACCOUNT_SID = originalSid;
        process.env.TWILIO_AUTH_TOKEN = originalToken;
        process.env.VITE_ENABLE_DEMO_SANDBOX = originalEnv;
      }
    });
  });

  describe('5. Zero Secret Exposure & Anti-Enumeration Integrity', () => {
    it('ensures db.requestOtp never returns plaintext OTP or salt', () => {
      const res = db.requestOtp({
        phone: '+919876543210',
        purpose: 'LOGIN',
      });

      expect(res.success).toBe(true);
      expect((res as any).otp).toBeUndefined();
      expect((res as any).code).toBeUndefined();
      expect((res as any).salt).toBeUndefined();
      expect((res as any).hash).toBeUndefined();
      expect(res.maskedPhone).toBe('+91 ******3210');
    });

    it('formats phone numbers securely masking digits 3 through 8', () => {
      expect(formatMaskedPhone('+919876543210')).toBe('+91 ******3210');
      expect(formatMaskedPhone('+918800551234')).toBe('+91 ******1234');
      expect(formatMaskedPhone('+14155552671')).toBe('+1 ******2671');
    });

    it('rejects invalid Indian mobile numbers before hitting SMS provider', () => {
      const invalidNumbers = [
        '12345',
        '+9112345',
        '0123456789',
        'abcdefghij',
        '+915555555555', // Starts with 5 (invalid Indian mobile prefix)
      ];

      for (const num of invalidNumbers) {
        const norm = normalizePhoneNumber(num);
        expect(norm.isValid).toBe(false);

        const req = db.requestOtp({ phone: num, purpose: 'LOGIN' });
        expect(req.success).toBe(false);
      }
    });
  });

  describe('6. Telephony Compatibility Preservation', () => {
    it('verifies telephony configuration uses Twilio server credentials without breaking voice webhook URL', () => {
      const config = getTwilioServerConfig();
      expect(config.voiceWebhookUrl).toBeDefined();
      expect(config.statusCallbackUrl).toBeDefined();
      expect(config.callerId).toBeDefined();
    });
  });
});
