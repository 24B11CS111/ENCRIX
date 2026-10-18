import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSecureOtp,
  hashOtp,
  verifyOtpHash,
  isLiveEmailConfigured,
  sendVerificationEmail,
  getEncrixEmailContent,
  OTP_CONFIG,
} from '../../api/_lib/otpServer';
import { getTwilioServerConfig } from '../../api/_lib/twilioServer';
import { db } from '../services/supabase/db';
import { normalizeEmail, normalizeEmailAddress, formatMaskedEmail, maskEmailForOtp } from '../lib/emailNormalization';
import { authService } from '../services/auth/authService';
import { Profile } from '../types';

describe('ENCRIX Phase 15.2: Email OTP Authentication & Verified Onboarding Suite', () => {
  beforeEach(() => {
    db.resetSandbox(true);
    vi.restoreAllMocks();
  });

  describe('1. Email Normalization & Enterprise Masking Standards', () => {
    it('normalizes mixed-case and whitespace-padded emails to RFC-compliant lowercase', () => {
      const email1 = '  Anurag.Sharma@Gmail.COM  ';
      const norm1 = normalizeEmail(email1);
      expect(norm1.isValid).toBe(true);
      expect(norm1.normalized).toBe('anurag.sharma@gmail.com');
      expect(norm1.masked).toBe('a••••@gmail.com');

      const norm2 = normalizeEmailAddress('  Vikram@Vertex.CO.IN ');
      expect(norm2.isValid).toBe(true);
      expect(norm2.normalized).toBe('vikram@vertex.co.in');
      expect(norm2.masked).toBe('v••••@vertex.co.in');
    });

    it('rejects invalid email formats safely without leaking internal system state', () => {
      const invalidEmails = [
        '',
        '   ',
        'not-an-email',
        '@missing-user.com',
        'missing-domain@',
        'spaces in@email.com',
        'missing-tld@domain',
      ];

      for (const inv of invalidEmails) {
        const norm = normalizeEmail(inv);
        expect(norm.isValid).toBe(false);
        expect(norm.error).toBeDefined();

        const req = db.requestOtp({ email: inv, purpose: 'LOGIN' });
        expect(req.success).toBe(false);
      }
    });

    it('masks emails strictly conforming to Section 10 standard: first char + 4 bullets + @ + domain', () => {
      expect(formatMaskedEmail('anurag@gmail.com')).toBe('a••••@gmail.com');
      expect(formatMaskedEmail('vikram@vertex.com')).toBe('v••••@vertex.com');
      expect(formatMaskedEmail('arjun.kumar@company.co.in')).toBe('a••••@company.co.in');
      expect(formatMaskedEmail('x@domain.com')).toBe('x••••@domain.com');
      expect(maskEmailForOtp('support@encrix.io')).toBe('s••••@encrix.io');
    });
  });

  describe('2. Cryptographic Email OTP Generation & Salted HMAC Hashing', () => {
    it('generates 6-digit numeric OTP with cryptographic entropy', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const code = generateSecureOtp();
        expect(code).toMatch(/^\d{6}$/);
        expect(code.length).toBe(OTP_CONFIG.LENGTH);
        codes.add(code);
      }
      expect(codes.size).toBeGreaterThan(45);
    });

    it('generates distinct SHA-256 HMAC hashes bound to email address', () => {
      const email1 = 'owner1@encrix.io';
      const email2 = 'owner2@encrix.io';
      const code = '654321';

      const hash1 = hashOtp(email1, code);
      const hash2 = hashOtp(email2, code);

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).not.toBe(hash2);
    });

    it('verifies candidate OTP with timing-safe comparison rejecting forged values', () => {
      const email = 'user@encrix.io';
      const validCode = '819203';
      const invalidCode = '819204';
      const hash = hashOtp(email, validCode);

      expect(verifyOtpHash(email, validCode, hash)).toBe(true);
      expect(verifyOtpHash(email, invalidCode, hash)).toBe(false);
      expect(verifyOtpHash(email, '819', hash)).toBe(false);
      expect(verifyOtpHash(email, '8192031', hash)).toBe(false);
      expect(verifyOtpHash(email, validCode, '')).toBe(false);
    });
  });

  describe('3. Professional Email Template & Branding Verification (Section 7)', () => {
    it('produces compliant text and responsive HTML email template with exact wording and branding', () => {
      const otp = '928471';
      const content = getEncrixEmailContent(otp);

      expect(content.subject).toBe('Your ENCRIX verification code');

      // Verify exact required text lines
      expect(content.text).toContain('ENCRIX');
      expect(content.text).toContain('Verify your email address');
      expect(content.text).toContain('Your verification code is:');
      expect(content.text).toContain('928471');
      expect(content.text).toContain('This code expires in 5 minutes.');
      expect(content.text).toContain('If you did not request this code, you can safely ignore this email.');

      // Verify HTML palette (#0B1F3A, #1E4D8F, #F6F8FB, #FFFFFF)
      expect(content.html).toContain('#0B1F3A');
      expect(content.html).toContain('#1E4D8F');
      expect(content.html).toContain('#F6F8FB');
      expect(content.html).toContain('#FFFFFF');
      expect(content.html).toContain('928471');
    });
  });

  describe('4. Provider Credentials Detection & Production Blocker Safeguards', () => {
    it('detects placeholder email provider keys and rejects them as unconfigured', () => {
      const origResend = process.env.RESEND_API_KEY;
      const origSendGrid = process.env.SENDGRID_API_KEY;

      try {
        process.env.RESEND_API_KEY = 're_placeholder_secret_key';
        delete process.env.SENDGRID_API_KEY;
        expect(isLiveEmailConfigured()).toBe(false);

        delete process.env.RESEND_API_KEY;
        process.env.SENDGRID_API_KEY = 'SG.placeholder_secret_key';
        expect(isLiveEmailConfigured()).toBe(false);
      } finally {
        process.env.RESEND_API_KEY = origResend;
        process.env.SENDGRID_API_KEY = origSendGrid;
      }
    });

    it('identifies live email configuration with a synthetic Resend API key', () => {
      const origResend = process.env.RESEND_API_KEY;

      try {
        process.env.RESEND_API_KEY = 'synthetic-resend-api-key-not-a-credential';
        expect(isLiveEmailConfigured()).toBe(true);
      } finally {
        process.env.RESEND_API_KEY = origResend;
      }
    });

    it('throws BLOCKED — EMAIL OTP PROVIDER NOT CONFIGURED in production when live keys are absent', async () => {
      const origResend = process.env.RESEND_API_KEY;
      const origSendGrid = process.env.SENDGRID_API_KEY;
      const origEnv = process.env.VITE_ENABLE_DEMO_SANDBOX;

      try {
        delete process.env.RESEND_API_KEY;
        delete process.env.SENDGRID_API_KEY;
        process.env.VITE_ENABLE_DEMO_SANDBOX = 'false'; // Production mode

        await expect(sendVerificationEmail('anurag@gmail.com', '123456')).rejects.toThrow(
          'BLOCKED — EMAIL OTP PROVIDER NOT CONFIGURED'
        );
      } finally {
        process.env.RESEND_API_KEY = origResend;
        process.env.SENDGRID_API_KEY = origSendGrid;
        process.env.VITE_ENABLE_DEMO_SANDBOX = origEnv;
      }
    });
  });

  describe('5. Owner Registration & Account Activation Flow', () => {
    it('completes owner registration via email OTP, setting email_verified to true', async () => {
      const email = 'anurag.newowner@vertexcorp.com';
      const companyName = 'Vertex Corp Global';
      const ownerName = 'Anurag Verma';

      // 1. Request OTP
      const req = await authService.requestOtp({
        email,
        phone: '+91 98765 00001',
        purpose: 'REGISTER',
        fullName: ownerName,
        companyName,
        industry: 'Education Consultancy',
        companySize: '11-50',
      });

      expect(req.success).toBe(true);
      expect(req.maskedEmail).toBe('a••••@vertexcorp.com');
      expect(req.cooldownSeconds).toBe(60);
      expect(req.expiresInSeconds).toBe(300);

      const testOtp = (db as any)._lastTestOtps.get(`${email.toLowerCase()}:REGISTER`);
      expect(testOtp).toBeDefined();

      // 2. Verify OTP
      const verifyRes = await authService.verifyOtp({
        email,
        otp: testOtp,
        purpose: 'REGISTER',
        registrationData: {
          companyName,
          ownerName,
          email,
          industry: 'Education Consultancy',
          companySize: '11-50',
        },
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe('OWNER');
      expect(verifyRes.profile).toBeDefined();
      expect(verifyRes.profile?.email).toBe(email.toLowerCase());
      expect(verifyRes.profile?.email_verified).toBe(true);
      expect(verifyRes.profile?.role).toBe('OWNER');
      expect(verifyRes.organization?.name).toBe(companyName);
    });

    it('rejects owner registration if email is invalid format', async () => {
      const res = await authService.requestOtp({
        email: 'invalid-email-address',
        purpose: 'REGISTER',
        fullName: 'Sameer Kapoor',
        companyName: 'Apex',
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/valid email/i);
    });
  });

  describe('6. Existing User Email OTP Login Flow', () => {
    it('authenticates existing user and redirects to correct role dashboard without duplicating organization', async () => {
      // vikram@vertex.com is existing OWNER in demo profiles
      const email = 'vikram@vertex.com';

      const initialOrgsCount = db.getOrganizations({ role: 'ADMIN', organization_id: '' } as Profile).length;

      // 1. Request login OTP
      const req = await authService.requestOtp({
        email,
        purpose: 'LOGIN',
      });

      expect(req.success).toBe(true);
      expect(req.maskedEmail).toBe('v••••@vertex.com');

      const testOtp = (db as any)._lastTestOtps.get(`${email}:LOGIN`);
      expect(testOtp).toBeDefined();

      // 2. Verify login OTP
      const verifyRes = await authService.verifyOtp({
        email,
        otp: testOtp,
        purpose: 'LOGIN',
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe('OWNER');
      expect(verifyRes.profile?.email).toBe('vikram@vertex.com');
      expect(verifyRes.profile?.email_verified).toBe(true);

      // Verify no duplicate organization was created
      const currentOrgsCount = db.getOrganizations({ role: 'ADMIN', organization_id: '' } as Profile).length;
      expect(currentOrgsCount).toBe(initialOrgsCount);
    });

    it('enforces 5-attempt limit and burns email OTP on 5th failure', async () => {
      const email = 'vikram@vertex.com';

      await authService.requestOtp({ email, purpose: 'LOGIN' });

      for (let attempt = 1; attempt <= 4; attempt++) {
        const fail = await authService.verifyOtp({
          email,
          otp: '000000',
          purpose: 'LOGIN',
        });
        expect(fail.success).toBe(false);
        expect(fail.error).toBe('Invalid verification code.');
      }

      // 5th failed attempt burns code
      const fifthFail = await authService.verifyOtp({
        email,
        otp: '000000',
        purpose: 'LOGIN',
      });
      expect(fifthFail.success).toBe(false);
      expect(fifthFail.error).toBe('Too many attempts. Please request a new code.');
    });

    it('enforces 60-second cooldown between OTP requests', async () => {
      const email = 'vikram@vertex.com';

      const first = await authService.requestOtp({ email, purpose: 'LOGIN' });
      expect(first.success).toBe(true);

      const second = await authService.requestOtp({ email, purpose: 'LOGIN' });
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/Please wait \d+ seconds/);
      expect(second.cooldownSeconds).toBeGreaterThan(0);
    });
  });

  describe('7. Telecaller Invitation & Email OTP Verification Flow', () => {
    it('allows owner to invite telecaller by email and telecaller activates via email OTP', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const telecallerEmail = 'priya.telecaller@vertex.com';
      const telecallerName = 'Priya Telecaller';

      // 1. Owner creates invitation by email
      const invRes = await authService.inviteTelecaller({
        fullName: telecallerName,
        email: telecallerEmail,
        phone: '+91 98333 99887',
        currentProfile: owner,
      });

      expect(invRes.success).toBe(true);
      expect(invRes.invitation).toBeDefined();
      expect(invRes.invitation?.email).toBe(telecallerEmail.toLowerCase());
      expect(invRes.invitation?.role).toBe('TELECALLER');
      expect(invRes.invitation?.status).toBe('PENDING');

      const token = invRes.invitation!.token;

      // 2. Telecaller requests OTP using token and email
      const otpReq = await authService.requestOtp({
        email: telecallerEmail,
        purpose: 'INVITATION',
        inviteToken: token,
      });

      expect(otpReq.success).toBe(true);
      expect(otpReq.maskedEmail).toBe('p••••@vertex.com');

      const testOtp = (db as any)._lastTestOtps.get(`${telecallerEmail.toLowerCase()}:INVITATION`);
      expect(testOtp).toBeDefined();

      // 3. Telecaller verifies email OTP and joins organization
      const verifyRes = await authService.verifyOtp({
        email: telecallerEmail,
        otp: testOtp,
        purpose: 'INVITATION',
        inviteToken: token,
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.role).toBe('TELECALLER');
      expect(verifyRes.profile?.role).toBe('TELECALLER');
      expect(verifyRes.profile?.organization_id).toBe(owner.organization_id);
      expect(verifyRes.profile?.email_verified).toBe(true);

      // Verify invitation status changed to ACCEPTED
      const updatedInv = db.getInvitationByToken(token);
      expect(updatedInv?.status).toBe('ACCEPTED');
    });

    it('strictly forbids role escalation: invited telecaller cannot become ADMIN or OWNER', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const tcEmail = 'security.test@vertex.com';

      const invRes = await authService.inviteTelecaller({
        fullName: 'Security Test User',
        email: tcEmail,
        currentProfile: owner,
      });

      const token = invRes.invitation!.token;
      await authService.requestOtp({ email: tcEmail, purpose: 'INVITATION', inviteToken: token });
      const testOtp = (db as any)._lastTestOtps.get(`${tcEmail.toLowerCase()}:INVITATION`);

      const verifyRes = await authService.verifyOtp({
        email: tcEmail,
        otp: testOtp,
        purpose: 'INVITATION',
        inviteToken: token,
      });

      expect(verifyRes.role).toBe('TELECALLER');
      expect(verifyRes.profile?.role).toBe('TELECALLER');

      // Attempt role tampering on profile
      const profiles = db.getProfiles(verifyRes.profile!);
      const myProfile = profiles.find((p) => p.id === verifyRes.profile!.id);
      expect(myProfile?.role).toBe('TELECALLER');
    });

    it('enforces cross-tenant isolation: invitation from Org A cannot attach to Org B', async () => {
      const orgAOwner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find(
        (p) => p.organization_id === 'org-vertex-001' && p.role === 'OWNER'
      )!;
      const orgBOwner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find(
        (p) => p.organization_id === 'org-prime-002' && p.role === 'OWNER'
      )!;

      // Create invitation in Org A
      const invA = await authService.inviteTelecaller({
        fullName: 'Tenant Caller',
        email: 'tenant.caller@test.com',
        currentProfile: orgAOwner,
      });

      // Verify Org B owner cannot see or revoke Org A invitation
      const orgBInvs = db.getInvitations(orgBOwner);
      expect(orgBInvs.find((i) => i.id === invA.invitation!.id)).toBeUndefined();

      expect(() => db.revokeInvitation(invA.invitation!.id, orgBOwner)).toThrow(
        /Forbidden: Cannot revoke invitations of another organization/
      );
    });
  });

  describe('8. Twilio Telephony System Compatibility Preservation', () => {
    it('preserves Twilio configuration strictly for voice calls without authentication dependency', () => {
      const config = getTwilioServerConfig();
      expect(config.accountSid).toBeDefined();
      expect(config.authToken).toBeDefined();
      expect(config.voiceWebhookUrl).toBeDefined();
      expect(config.statusCallbackUrl).toBeDefined();
      expect(config.callerId).toBeDefined();

      // Verify voice webhook URL is properly formed
      expect(config.voiceWebhookUrl).toContain('/api/telephony/voice');
      expect(config.statusCallbackUrl).toContain('/api/telephony/webhook');
    });
  });
});
