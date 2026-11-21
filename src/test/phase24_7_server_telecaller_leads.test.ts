import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import leadsDispatcher from '../../api/leads';
import telecallerLeadsHandler from '../../api/_lib/leads/telecaller';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import * as supabaseServerModule from '../../api/_lib/supabaseServer';

function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
}) {
  const req: any = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body !== undefined ? options.body : {},
    query: options.query || {},
    url: '/api/leads',
  };

  const res: any = {
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
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };

  return { req, res };
}

describe('Phase 24.7: Secure Server-Side Telecaller Lead API', () => {
  const orgA = '10000000-0000-4000-8000-000000000001';
  const telecallerUserId = '20000000-0000-4000-8000-000000000001';
  const telecallerProfileId = '30000000-0000-4000-8000-000000000001';
  const leadId = '40000000-0000-4000-8000-000000000001';

  const activeTelecallerProfile = {
    id: telecallerProfileId,
    user_id: telecallerUserId,
    organization_id: orgA,
    full_name: 'Ananya Roy',
    email: 'ananya@example.com',
    role: 'TELECALLER' as const,
    status: 'ACTIVE' as const,
    phone_verified: true,
  };

  const dbAssignedLead = {
    id: leadId,
    organization_id: orgA,
    lead_code: 'LEAD-101',
    name: 'Rohit S.',
    email: '***@***.***',
    source: 'Referral',
    status: 'ASSIGNED',
    priority: 'HIGH',
    assigned_to: telecallerProfileId,
    notes: 'Called yesterday',
    last_contacted_at: null,
    calls_count: 1,
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
    // Deliberately include extra sensitive fields if a query returned them defensively
    phone: '+919999999999',
    metadata: { secretNote: 'hidden' },
  };

  let mockRpc: any;
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent auth-helper tests from contacting any developer-configured
    // Supabase project; handlers below use the mocked server client.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SUPABASE_URL', 'https://placeholder.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'placeholder-test-key');

    mockRpc = vi.fn(async (funcName: string, args: any) => {
      if (funcName === 'organization_has_active_paid_entitlement') {
        return { data: true, error: null };
      }
      if (funcName === 'server_get_assigned_telecaller_leads') {
        if (
          args.p_user_id === telecallerUserId &&
          args.p_profile_id === telecallerProfileId &&
          args.p_organization_id === orgA
        ) {
          return { data: [dbAssignedLead], error: null };
        }
        return { data: [], error: null };
      }
      if (funcName === 'server_update_assigned_telecaller_lead') {
        if (
          args.p_user_id === telecallerUserId &&
          args.p_profile_id === telecallerProfileId &&
          args.p_organization_id === orgA &&
          args.p_lead_id === leadId
        ) {
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      return { data: null, error: new Error(`Unknown RPC ${funcName}`) };
    });

    mockSupabase = {
      rpc: mockRpc,
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field: string, val: string) => ({
                single: vi.fn(async () => {
                  if (val === telecallerProfileId) {
                    return { data: activeTelecallerProfile, error: null };
                  }
                  if (val === 'disabled-profile-id') {
                    return {
                      data: { ...activeTelecallerProfile, id: 'disabled-profile-id', status: 'DISABLED' },
                      error: null,
                    };
                  }
                  if (val === 'owner-profile-id') {
                    return {
                      data: { ...activeTelecallerProfile, id: 'owner-profile-id', role: 'OWNER' },
                      error: null,
                    };
                  }
                  return { data: null, error: { message: 'Profile not found' } };
                }),
              })),
            })),
          };
        }
        return {};
      }),
    };

    vi.spyOn(supabaseServerModule, 'getSupabaseServerClient').mockReturnValue(mockSupabase as any);
    vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function createValidToken(overrides?: Partial<Parameters<typeof createSignedSessionToken>[0]>) {
    return createSignedSessionToken({
      userId: telecallerUserId,
      profileId: telecallerProfileId,
      organizationId: orgA,
      role: 'TELECALLER',
      email: 'ananya@example.com',
      fullName: 'Ananya Roy',
      status: 'ACTIVE',
      ...overrides,
    });
  }

  // =========================================================================
  // 1. AUTHENTICATION & SESSION ENFORCEMENT
  // =========================================================================
  describe('1. Authentication & Session Verification', () => {
    it('rejects requests without an Authorization header (401)', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Authentication is required|Missing or malformed Authorization header/i);
    });

    it('rejects requests with malformed Authorization header (401)', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: 'Basic invalid-credentials' },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Authentication is required|Missing or malformed Authorization header/i);
    });

    it('rejects requests with tampered session signature (401)', async () => {
      const validToken = createValidToken();
      const tamperedToken = validToken.slice(0, -6) + 'xxxxxx';

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tamperedToken}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(401);
    });

    it('rejects requests with expired session tokens (401)', async () => {
      const expiredToken = createSignedSessionToken(
        {
          userId: telecallerUserId,
          profileId: telecallerProfileId,
          organizationId: orgA,
          role: 'TELECALLER',
          email: 'ananya@example.com',
          fullName: 'Ananya Roy',
          status: 'ACTIVE',
        },
        -60 // expired 60 seconds ago
      );

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${expiredToken}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 2. AUTHORIZATION & PROFILE ENFORCEMENT
  // =========================================================================
  describe('2. Authorization & Profile Integrity', () => {
    async function expectInactiveTelecallerBlocked(
      status: 'SUSPENDED' | 'PENDING',
      profileId: string,
      route: 'telecaller-list' | 'telecaller-update',
      method: 'GET' | 'POST'
    ) {
      const token = createValidToken({ profileId, status });
      const { req, res } = createMockReqRes({
        method,
        headers: { authorization: `Bearer ${token}` },
        query: { _route: route },
        body: route === 'telecaller-update'
          ? { leadId, status: 'CONTACTED', notes: 'must not be saved' }
          : {},
      });

      await leadsDispatcher(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/active telecaller account is required/i);
      expect(mockRpc).not.toHaveBeenCalled();
    }

    it('rejects inactive or disabled telecaller profiles (403)', async () => {
      const token = createValidToken({ profileId: 'disabled-profile-id', status: 'DISABLED' });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/active telecaller account is required/i);
    });

    it('rejects a suspended telecaller from listing leads', async () => {
      await expectInactiveTelecallerBlocked('SUSPENDED', 'suspended-profile-id', 'telecaller-list', 'GET');
    });

    it('rejects a suspended telecaller from updating leads', async () => {
      await expectInactiveTelecallerBlocked('SUSPENDED', 'suspended-profile-id', 'telecaller-update', 'POST');
    });

    it('rejects a pending telecaller from listing leads', async () => {
      await expectInactiveTelecallerBlocked('PENDING', 'pending-profile-id', 'telecaller-list', 'GET');
    });

    it('rejects a pending telecaller from updating leads', async () => {
      await expectInactiveTelecallerBlocked('PENDING', 'pending-profile-id', 'telecaller-update', 'POST');
    });

    it('rejects non-telecaller roles (OWNER, ADMIN) on telecaller endpoint (403)', async () => {
      const token = createValidToken({ profileId: 'owner-profile-id', role: 'OWNER' });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/active telecaller account is required/i);
    });

    it('fails closed (503) if Supabase server environment is unconfigured', async () => {
      vi.spyOn(supabaseServerModule, 'isRealSupabaseServerConfigured').mockReturnValue(false);
      const token = createValidToken();

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toMatch(/Secure lead access is unavailable/i);
    });
  });

  // =========================================================================
  // 3. HTTP METHOD & ROUTE ENFORCEMENT
  // =========================================================================
  describe('3. HTTP Method & Route Enforcement', () => {
    it('rejects GET on telecaller-update with 405 Method Not Allowed', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('POST');
    });

    it('rejects POST on telecaller-list with 405 Method Not Allowed', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('GET');
    });

    it('returns 404 for unknown _route', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'unknown-telecaller-action' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // 4. ASSIGNED LEADS READ FLOW (telecaller-list)
  // =========================================================================
  describe('4. Assigned Leads Read Flow', () => {
    it('denies an unpaid telecaller before reading assigned lead rows', async () => {
      mockRpc.mockImplementation(async (funcName: string) => funcName === 'organization_has_active_paid_entitlement'
        ? { data: false, error: null }
        : { data: [dbAssignedLead], error: null });
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(402);
      expect(res.body.error).toBe('ACTIVE_SUBSCRIPTION_REQUIRED');
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith('organization_has_active_paid_entitlement', {
        p_organization_id: orgA,
      });
    });

    it('fetches assigned leads using server-derived profile identity and returns sanitized projection', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: {
          _route: 'telecaller-list',
          // Malicious client attempting to inject attacker org or telecaller id
          organization_id: 'forged-org-id',
          user_id: 'forged-user-id',
          profile_id: 'forged-profile-id',
        },
      });

      await leadsDispatcher(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockRpc).toHaveBeenCalledWith('server_get_assigned_telecaller_leads', {
        p_user_id: telecallerUserId,
        p_profile_id: telecallerProfileId,
        p_organization_id: orgA,
      });

      expect(res.body.leads).toHaveLength(1);
      const lead = res.body.leads[0];
      expect(lead.id).toBe(leadId);
      expect(lead.lead_code).toBe('LEAD-101');
      expect(lead.name).toBe('Rohit S.');
      expect(lead.email).toBe('***@***.***');
      expect(lead.notes).toBe('Called yesterday');
      expect(lead.status).toBe('ASSIGNED');

      // CRITICAL: Ensure phone and metadata are strictly stripped
      expect(lead.phone).toBeUndefined();
      expect(lead.metadata).toBeUndefined();
    });

    it('returns 503 when the underlying database RPC fails', async () => {
      mockRpc.mockImplementation(async (funcName: string) => funcName === 'organization_has_active_paid_entitlement'
        ? { data: true, error: null }
        : { data: null, error: { message: 'Database connection error' } });
      const token = createValidToken();

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-list' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toMatch(/Assigned leads could not be loaded/i);
    });
  });

  // =========================================================================
  // 5. ASSIGNED LEAD UPDATE FLOW (telecaller-update)
  // =========================================================================
  describe('5. Assigned Lead Update Flow', () => {
    it('successfully updates status and notes for an assigned lead', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: {
          leadId,
          status: 'CONTACTED',
          notes: 'Spoke with candidate. Expressed strong interest in CS.',
        },
      });

      await leadsDispatcher(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockRpc).toHaveBeenCalledWith('server_update_assigned_telecaller_lead', {
        p_user_id: telecallerUserId,
        p_profile_id: telecallerProfileId,
        p_organization_id: orgA,
        p_lead_id: leadId,
        p_status: 'CONTACTED',
        p_notes: 'Spoke with candidate. Expressed strong interest in CS.',
      });

      expect(res.body.lead).toBeDefined();
      expect(res.body.lead.id).toBe(leadId);
      expect(res.body.lead.phone).toBeUndefined();
    });

    it('handles JSON payloads provided as raw strings', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: JSON.stringify({
          leadId,
          status: 'INTERESTED',
          notes: 'Candidate confirmed attendance.',
        }),
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(200);
    });

    it('rejects malformed string bodies with 400', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: '{ malformed json: true, ',
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Malformed JSON payload/i);
    });

    it('rejects requests containing unauthorized / protected fields (400)', async () => {
      const token = createValidToken();

      const forbiddenFields = [
        { phone: '+919876543210' },
        { organization_id: 'tampered-org-id' },
        { assigned_to: 'tampered-profile-id' },
        { priority: 'URGENT' },
        { metadata: { hack: true } },
        { email: 'tampered@example.com' },
        { name: 'Tampered Name' },
      ];

      for (const field of forbiddenFields) {
        const { req, res } = createMockReqRes({
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          query: { _route: 'telecaller-update' },
          body: {
            leadId,
            status: 'CONTACTED',
            notes: 'Valid note',
            ...field,
          },
        });

        await leadsDispatcher(req, res);
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/Only leadId, status, and notes are accepted/i);
      }
    });

    it('rejects invalid status values not in allowlist (400)', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: {
          leadId,
          status: 'MALICIOUS_STATUS',
          notes: 'Some notes',
        },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Valid lead update fields are required/i);
    });

    it('rejects malformed leadId (400)', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: {
          leadId: 'not-a-valid-uuid',
          status: 'CONTACTED',
          notes: 'Some notes',
        },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Valid lead update fields are required/i);
    });

    it('rejects excessively long notes > 10000 characters (400)', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: {
          leadId,
          status: 'CONTACTED',
          notes: 'x'.repeat(10001),
        },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/Valid lead update fields are required/i);
    });

    it('returns 404 when RPC returns false (unauthorized or lead not assigned)', async () => {
      mockRpc.mockImplementation(async (funcName: string) => {
        if (funcName === 'organization_has_active_paid_entitlement') {
          return { data: true, error: null };
        }
        if (funcName === 'server_update_assigned_telecaller_lead') {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      });

      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'telecaller-update' },
        body: {
          leadId,
          status: 'CONTACTED',
          notes: 'Notes for unassigned lead',
        },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/This lead could not be updated/i);
    });
  });

  // =========================================================================
  // 6. OWNER / ADMIN LEAD DISPATCHER INTEGRITY
  // =========================================================================
  describe('6. Owner / Admin Lead Dispatcher Integrity', () => {
    it('preserves detail route dispatch for owners', async () => {
      const ownerToken = createValidToken({ profileId: 'owner-profile-id', role: 'OWNER' });
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
        query: { _route: 'detail' },
      });

      await leadsDispatcher(req, res);
      // detailHandler requires leadId, so it should return 400 'leadId is required', proving it routed to detailHandler
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/leadId is required/i);
    });

    it('rejects telecaller attempting to access distribution-config (403)', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'distribution-config' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Telecallers are not authorized/i);
    });

    it('rejects telecaller attempting to distribute leads (403)', async () => {
      const token = createValidToken();
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { _route: 'distribute' },
      });

      await leadsDispatcher(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Telecallers are not authorized/i);
    });
  });
});
