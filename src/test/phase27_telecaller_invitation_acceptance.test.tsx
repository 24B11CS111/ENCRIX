import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthContext';
import { AcceptInvitationPage } from '@/pages/auth/AcceptInvitationPage';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';
import {
  getCanonicalBaseUrl,
  storeServerInvitation,
  getServerInvitation,
  clearServerInvitations,
  updateServerInvitationStatus,
} from '../../api/_lib/invitationServer';
import inviteHandler from '../../api/auth/invite';
import sendOtpHandler from '../../api/auth/send-otp';
import verifyOtpHandler from '../../api/auth/verify-otp';
import { hashOtp, serverOtpStore } from '../../api/_lib/otpServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { Profile } from '@/types';

function createMockReqRes(options: {
  method?: string;
  query?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
}) {
  const req = {
    method: options.method || 'GET',
    query: options.query || {},
    body: options.body || {},
    headers: options.headers || {},
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

describe('ENCRIX Phase 27: Telecaller Invitation Acceptance & Hardened Onboarding', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    clearServerInvitations();
    serverOtpStore.clear();
    process.env = { ...originalEnv };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.VITE_SUPABASE_URL;
    process.env.OTP_SERVER_SECRET = 'c8f7e2a1b4d3e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0';
    process.env.SESSION_SERVER_SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Local and Production URL Configuration
  // =========================================================================
  describe('1. Local and Production URL Configuration', () => {
    it('defaults to http://localhost:5173 when no environment variable or header is provided', () => {
      delete process.env.APP_URL;
      delete process.env.VITE_APP_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;

      const url = getCanonicalBaseUrl();
      expect(url).toBe('http://localhost:5173');
    });

    it('prefers APP_URL environment variable and strips trailing slashes', () => {
      process.env.APP_URL = 'https://crm.encrix.com///';
      const url = getCanonicalBaseUrl();
      expect(url).toBe('https://crm.encrix.com');
    });

    it('prefers VITE_APP_URL if APP_URL is absent', () => {
      delete process.env.APP_URL;
      process.env.VITE_APP_URL = 'https://app.encrix.io/';
      const url = getCanonicalBaseUrl();
      expect(url).toBe('https://app.encrix.io');
    });

    it('derives canonical URL from request headers (x-forwarded-proto, host)', () => {
      delete process.env.APP_URL;
      delete process.env.VITE_APP_URL;

      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'custom.encrix.io:8080',
        },
      };

      const url = getCanonicalBaseUrl(req);
      expect(url).toBe('https://custom.encrix.io:8080');
    });
  });

  // =========================================================================
  // 2. Invitation Token Lookup & Validation Endpoint (GET /api/auth/invite)
  // =========================================================================
  describe('2. Invitation Token Lookup & Validation (GET /api/auth/invite)', () => {
    it('rejects missing or empty token with 400', async () => {
      const { req, res } = createMockReqRes({ method: 'GET', query: {} });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Invitation token is required');
    });

    it('rejects malformed token with 400', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        query: { token: 'invalid token with spaces!' },
      });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Malformed invitation token');
    });

    it('returns 404 for non-existent token with secure user-friendly message', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        query: { token: 'inv_nonexistent_token_1234567890' },
      });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Invitation link is invalid or could not be found.');
    });

    it('returns 410 with code EXPIRED when invitation is expired', async () => {
      const token = 'inv_expired_token_1234567890';
      storeServerInvitation({
        id: 'inv-exp-1',
        organization_id: 'org-1',
        organization_name: 'Alpha Corp',
        full_name: 'Priya Sharma',
        email: 'priya@alphacorp.com',
        invited_by: 'owner-1',
        role: 'TELECALLER',
        status: 'PENDING',
        token,
        expires_at: new Date(Date.now() - 10000).toISOString(),
        created_at: new Date(Date.now() - 600000).toISOString(),
      });

      const { req, res } = createMockReqRes({ method: 'GET', query: { token } });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(410);
      expect(res.body.code).toBe('EXPIRED');
      expect(res.body.error).toContain('This invitation has expired');
    });

    it('returns 409 with code ACCEPTED when invitation was already accepted', async () => {
      const token = 'inv_accepted_token_1234567890';
      storeServerInvitation({
        id: 'inv-acc-1',
        organization_id: 'org-1',
        organization_name: 'Alpha Corp',
        full_name: 'Priya Sharma',
        email: 'priya@alphacorp.com',
        invited_by: 'owner-1',
        role: 'TELECALLER',
        status: 'ACCEPTED',
        token,
        expires_at: new Date(Date.now() + 100000).toISOString(),
        created_at: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({ method: 'GET', query: { token } });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('ACCEPTED');
      expect(res.body.error).toContain('already been accepted');
    });

    it('returns 403 with code REVOKED when invitation was revoked', async () => {
      const token = 'inv_revoked_token_1234567890';
      storeServerInvitation({
        id: 'inv-rev-1',
        organization_id: 'org-1',
        organization_name: 'Alpha Corp',
        full_name: 'Priya Sharma',
        email: 'priya@alphacorp.com',
        invited_by: 'owner-1',
        role: 'TELECALLER',
        status: 'REVOKED',
        token,
        expires_at: new Date(Date.now() + 100000).toISOString(),
        created_at: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({ method: 'GET', query: { token } });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('REVOKED');
      expect(res.body.error).toContain('revoked');
    });

    it('returns 200 with sanitized metadata for a valid pending invitation', async () => {
      const token = 'inv_valid_telecaller_token_1234567890';
      storeServerInvitation({
        id: 'inv-val-1',
        organization_id: 'org-omega',
        organization_name: 'Omega Telecallers',
        phone_number: '+919876543210',
        full_name: 'Vikram Joshi',
        email: 'vikram.joshi@omegatele.com',
        invited_by: 'owner-omega',
        role: 'TELECALLER',
        status: 'PENDING',
        token,
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({ method: 'GET', query: { token } });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invitation).toBeDefined();
      expect(res.body.invitation.fullName).toBe('Vikram Joshi');
      expect(res.body.invitation.organizationName).toBe('Omega Telecallers');
      expect(res.body.invitation.role).toBe('TELECALLER');
      expect(res.body.invitation.email).toBe('vikram.joshi@omegatele.com');
      expect(res.body.invitation.maskedEmail).toBe('v••••@omegatele.com');
      // Must NOT leak raw phone number or internal owner ID
      expect(res.body.invitation.phone_number).toBeUndefined();
      expect(res.body.invitation.invited_by).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Invitation Creation (POST /api/auth/invite)
  // =========================================================================
  describe('3. Invitation Creation (POST /api/auth/invite)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: { fullName: 'Sunil Kumar', email: 'sunil@test.com' },
      });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(401);
    });

    it('rejects telecaller callers attempting to invite others with 403', async () => {
      const telecallerSession = createSignedSessionToken({
        userId: 'tc-user-1',
        profileId: 'tc-prof-1',
        organizationId: 'org-1',
        role: 'TELECALLER',
        email: 'caller@org.com',
        fullName: 'Caller One',
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${telecallerSession}` },
        body: { fullName: 'Sunil Kumar', email: 'sunil@test.com' },
      });
      await inviteHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toContain('Only Organization Owners');
    });

    it('allows owner to create invitation, generating secure token and canonical URL', async () => {
      const ownerSession = createSignedSessionToken({
        userId: 'owner-user-1',
        profileId: 'owner-prof-1',
        organizationId: 'org-vertex-1',
        role: 'OWNER',
        email: 'owner@vertex.com',
        fullName: 'Vertex Owner',
        status: 'ACTIVE',
      });

      process.env.APP_URL = 'http://localhost:5173';

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerSession}` },
        body: { fullName: 'Neha Gupta', email: 'neha.gupta@vertex.com' },
      });

      await inviteHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.invitation).toBeDefined();

      const inv = res.body.invitation;
      expect(inv.token).toMatch(/^inv_[a-f0-9]{48}$/);
      expect(inv.fullName).toBe('Neha Gupta');
      expect(inv.role).toBe('TELECALLER');
      expect(inv.inviteUrl).toBe(`http://localhost:5173/accept-invitation?token=${inv.token}`);

      // Confirm invitation was persisted to server store
      const stored = getServerInvitation(inv.token);
      expect(stored).toBeDefined();
      expect(stored?.full_name).toBe('Neha Gupta');
      expect(stored?.organization_id).toBe('org-vertex-1');
      expect(stored?.status).toBe('PENDING');
    });
  });

  // =========================================================================
  // 4. Invitation OTP Request Validation (POST /api/auth/send-otp)
  // =========================================================================
  describe('4. Invitation OTP Request Validation (POST /api/auth/send-otp)', () => {
    const validToken = 'inv_otp_test_token_1234567890';

    beforeEach(() => {
      storeServerInvitation({
        id: 'inv-otp-1',
        organization_id: 'org-test',
        organization_name: 'Test Org',
        full_name: 'Ananya Verma',
        email: 'ananya@testorg.com',
        invited_by: 'owner-test',
        role: 'TELECALLER',
        status: 'PENDING',
        token: validToken,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date().toISOString(),
      });
    });

    it('rejects request if inviteToken is missing for INVITATION purpose', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: { email: 'ananya@testorg.com', purpose: 'INVITATION' },
      });
      await sendOtpHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Invitation token is required');
    });

    it('rejects request if inviteToken does not exist', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          email: 'ananya@testorg.com',
          purpose: 'INVITATION',
          inviteToken: 'inv_nonexistent_xyz',
        },
      });
      await sendOtpHandler(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Invalid invitation link.');
    });

    it('rejects request if email does not match invitation', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          email: 'attacker@evil.com',
          purpose: 'INVITATION',
          inviteToken: validToken,
        },
      });
      await sendOtpHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email address does not match this invitation.');
    });

    it('successfully sends OTP when email matches invitation', async () => {
      process.env.RESEND_API_KEY = 're_prod_resend_live_synthetic_key_987654';
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'msg_123' }),
      } as any);

      try {
        const { req, res } = createMockReqRes({
          method: 'POST',
          body: {
            email: 'ananya@testorg.com',
            purpose: 'INVITATION',
            inviteToken: validToken,
          },
        });
        await sendOtpHandler(req, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.maskedEmail).toBe('a••••@testorg.com');
        expect(res.body.cooldownSeconds).toBe(60);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // 5. Verification & Workspace Activation (POST /api/auth/verify-otp)
  // =========================================================================
  describe('5. Verification & Workspace Activation (POST /api/auth/verify-otp)', () => {
    const inviteToken = 'inv_verify_telecaller_token_9876543210';
    const telecallerEmail = 'rohit.mehta@callcenter.com';
    const correctOtp = '654321';

    beforeEach(() => {
      storeServerInvitation({
        id: 'inv-rohit-1',
        organization_id: 'org-callcenter',
        organization_name: 'CallCenter Global',
        full_name: 'Rohit Mehta',
        email: telecallerEmail,
        invited_by: 'owner-cc',
        role: 'TELECALLER',
        status: 'PENDING',
        token: inviteToken,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date().toISOString(),
      });

      // Prepare active OTP in serverOtpStore
      serverOtpStore.set(`${telecallerEmail}:INVITATION`, {
        identifier: telecallerEmail,
        purpose: 'INVITATION',
        otpHash: hashOtp(telecallerEmail, correctOtp),
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });
    });

    it('rejects verification if wrong OTP is provided', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          email: telecallerEmail,
          otp: '000000',
          purpose: 'INVITATION',
          inviteToken,
        },
      });
      await verifyOtpHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Invalid verification code.');
    });

    it('rejects verification if email does not match invitation', async () => {
      // Setup OTP for different email
      serverOtpStore.set(`impostor@callcenter.com:INVITATION`, {
        identifier: 'impostor@callcenter.com',
        purpose: 'INVITATION',
        otpHash: hashOtp('impostor@callcenter.com', correctOtp),
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          email: 'impostor@callcenter.com',
          otp: correctOtp,
          purpose: 'INVITATION',
          inviteToken,
        },
      });
      await verifyOtpHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Email address does not match this invitation.');
    });

    it('completes onboarding: activates profile, sets status ACCEPTED, binds TELECALLER role', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: {
          email: telecallerEmail,
          otp: correctOtp,
          purpose: 'INVITATION',
          inviteToken,
        },
      });
      await verifyOtpHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role).toBe('TELECALLER');
      expect(res.body.profile.role).toBe('TELECALLER');
      expect(res.body.profile.organization_id).toBe('org-callcenter');
      expect(res.body.sessionToken).toBeDefined();

      // Check that invitation was atomically marked ACCEPTED
      const updatedInv = getServerInvitation(inviteToken);
      expect(updatedInv?.status).toBe('ACCEPTED');
    });

    it('strictly prevents replay & duplicate acceptance: second verification attempt fails', async () => {
      // 1st acceptance
      const { req: req1, res: res1 } = createMockReqRes({
        method: 'POST',
        body: {
          email: telecallerEmail,
          otp: correctOtp,
          purpose: 'INVITATION',
          inviteToken,
        },
      });
      await verifyOtpHandler(req1, res1);
      expect(res1.statusCode).toBe(200);

      // Re-arm OTP for testing duplicate invitation acceptance attempt
      serverOtpStore.set(`${telecallerEmail}:INVITATION`, {
        identifier: telecallerEmail,
        purpose: 'INVITATION',
        otpHash: hashOtp(telecallerEmail, correctOtp),
        attempts: 0,
        resendAfter: new Date(Date.now() + 60000).toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        used: false,
        createdAt: new Date().toISOString(),
      });

      // 2nd acceptance attempt with same token
      const { req: req2, res: res2 } = createMockReqRes({
        method: 'POST',
        body: {
          email: telecallerEmail,
          otp: correctOtp,
          purpose: 'INVITATION',
          inviteToken,
        },
      });
      await verifyOtpHandler(req2, res2);
      expect(res2.statusCode).toBe(400);
      expect(res2.body.error).toContain('already been accepted');
    });
  });

  // =========================================================================
  // 6. AuthService Integration (authService.getInvitation)
  // =========================================================================
  describe('6. AuthService Integration (authService.getInvitation)', () => {
    it('retrieves invitation from db in mock mode', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const created = db.createInvitation(
        { full_name: 'Deepak Patel', email: 'deepak@patel.com' },
        owner
      );

      const res = await authService.getInvitation(created.token);
      expect(res.success).toBe(true);
      expect(res.invitation).toBeDefined();
      expect(res.invitation?.full_name).toBe('Deepak Patel');
      expect(res.invitation?.email).toBe('deepak@patel.com');
    });

    it('returns error when token does not exist in db', async () => {
      const res = await authService.getInvitation('inv_completely_unknown_token');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invitation link is invalid or could not be found.');
    });

    it('returns code EXPIRED when token is expired in db', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const created = db.createInvitation(
        { full_name: 'Late User', email: 'late@user.com' },
        owner
      );
      created.expires_at = new Date(Date.now() - 5000).toISOString();
      created.status = 'EXPIRED';

      const res = await authService.getInvitation(created.token);
      expect(res.success).toBe(false);
      expect(res.code).toBe('EXPIRED');
    });
  });

  // =========================================================================
  // 7. AcceptInvitationPage UI & Onboarding Flow
  // =========================================================================
  describe('7. AcceptInvitationPage UI & Onboarding Flow', () => {
    it('displays loading state and then invitation details for valid token', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const invitation = db.createInvitation(
        { full_name: 'Anita Roy', email: 'anita.roy@vertex.com' },
        owner
      );

      render(
        <MemoryRouter initialEntries={[`/accept-invitation?token=${invitation.token}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Anita Roy')).toBeInTheDocument();
        expect(screen.getByText('TELECALLER')).toBeInTheDocument();
      });

      const emailInput = screen.getByPlaceholderText('name@company.com') as HTMLInputElement;
      expect(emailInput.value).toBe('anita.roy@vertex.com');
      expect(screen.getByRole('button', { name: /Send Verification Code/i })).toBeInTheDocument();
    });

    it('displays error card when invitation token is invalid', async () => {
      render(
        <MemoryRouter initialEntries={['/accept-invitation?token=inv_invalid_fake_token']}>
          <AuthProvider>
            <Routes>
              <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('invitation-error-card')).toBeInTheDocument();
        expect(screen.getByText(/Invitation link is invalid or could not be found/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Go to Login/i })).toBeInTheDocument();
      });
    });

    it('cleans and extracts token when a full URL is pasted into the token input', async () => {
      const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
      const invitation = db.createInvitation(
        { full_name: 'Pasted Link User', email: 'pasted@link.com' },
        owner
      );

      render(
        <MemoryRouter initialEntries={['/accept-invitation']}>
          <AuthProvider>
            <Routes>
              <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      const tokenInput = screen.getByPlaceholderText(/inv_\.\.\. or paste full invitation link/i);
      fireEvent.change(tokenInput, {
        target: { value: `http://localhost:5173/accept-invitation?token=${invitation.token}` },
      });

      await waitFor(() => {
        expect(screen.getByText('Pasted Link User')).toBeInTheDocument();
      });
    });
  });
});
