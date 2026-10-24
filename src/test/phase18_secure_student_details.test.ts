import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSignedSessionToken,
  revokeSession,
} from '../../api/_lib/sessionServer';
import leadDetailHandler from '../../api/_lib/leads/detail';
import callHandler from '../../api/telephony/call';
import { db } from '@/services/supabase/db';
import { leadService } from '@/services/leads/leadService';
import { Profile } from '@/types';

// Mock HTTP Request/Response helper for Vercel/Express handlers
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
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

describe('ENCRIX Phase 18: Secure Student Details & Zero Phone Exposure', () => {
  const orgAId = 'org-vertex-001';
  const orgBId = 'org-prime-002';

  // Telecaller A1 in Vertex (assigned to lead-lv-10294 and lead-lv-10291)
  const telecallerA1: Profile = {
    id: 'tc-arjun-01',
    user_id: 'user-tc-01',
    organization_id: orgAId,
    full_name: 'Arjun Das',
    phone: '+919811122233',
    email: 'arjun@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 24,
    calls_today: 18,
    positive_count: 6,
    conversion_rate: 33,
  };

  // Telecaller A2 in Vertex (unassigned to A1's leads)
  const telecallerA2: Profile = {
    id: 'tc-priya-03',
    user_id: 'user-tc-03',
    organization_id: orgAId,
    full_name: 'Priya Reddy',
    phone: '+919833344556',
    email: 'priya@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 25,
    calls_today: 22,
    positive_count: 8,
    conversion_rate: 34,
  };

  // Owner A in Vertex
  const ownerA: Profile = {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: orgAId,
    full_name: 'Vikram Malhotra',
    phone: '+919820012345',
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

  // Telecaller B in Prime Careers (Different organization)
  const telecallerB: Profile = {
    id: 'tc-karan-09',
    user_id: 'user-tc-09',
    organization_id: orgBId,
    full_name: 'Karan Mehra',
    phone: '+919877788899',
    email: 'karan@prime.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    avatar_url: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    assigned_count: 10,
    calls_today: 5,
    positive_count: 1,
    conversion_rate: 20,
  };

  let tokenTelecallerA1: string;
  let tokenTelecallerA2: string;
  let tokenTelecallerB: string;
  let tokenOwnerA: string;

  beforeEach(() => {
    // Reset sandbox to clean state with demo data
    db.resetSandbox(true);

    tokenTelecallerA1 = createSignedSessionToken({
      userId: telecallerA1.user_id,
      profileId: telecallerA1.id,
      organizationId: telecallerA1.organization_id,
      role: 'TELECALLER',
      email: telecallerA1.email || 'arjun@vertex.com',
      fullName: telecallerA1.full_name,
    });

    tokenTelecallerA2 = createSignedSessionToken({
      userId: telecallerA2.user_id,
      profileId: telecallerA2.id,
      organizationId: telecallerA2.organization_id,
      role: 'TELECALLER',
      email: telecallerA2.email || 'priya@vertex.com',
      fullName: telecallerA2.full_name,
    });

    tokenTelecallerB = createSignedSessionToken({
      userId: telecallerB.user_id,
      profileId: telecallerB.id,
      organizationId: telecallerB.organization_id,
      role: 'TELECALLER',
      email: telecallerB.email || 'karan@prime.com',
      fullName: telecallerB.full_name,
    });

    tokenOwnerA = createSignedSessionToken({
      userId: ownerA.user_id,
      profileId: ownerA.id,
      organizationId: ownerA.organization_id,
      role: 'OWNER',
      email: ownerA.email || 'vikram@vertex.com',
      fullName: ownerA.full_name,
    });
  });

  // --------------------------------------------------------------------------
  // 1. AUTHORIZED TELECALLER VIEWING STUDENT DETAILS
  // --------------------------------------------------------------------------
  describe('1. Authorized Telecaller Viewing Student Details', () => {
    it('returns 200 with all permitted student and academic fields for an assigned lead', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body;

      // Student and Family Profile fields
      expect(data.id).toBe('lead-lv-10294');
      expect(data.lead_code).toBe('LV-10294');
      expect(data.name).toBe('Rahul Kumar');
      expect(data.father_name).toBe('Suresh Kumar');
      expect(data.mother_name).toBe('Sunita Kumar');
      expect(data.category).toBe('General');
      expect(data.gender).toBe('Male');
      expect(data.city).toBe('Hyderabad');
      expect(data.state).toBe('Telangana');
      expect(data.school_or_college).toBe('Sri Chaitanya Junior College');
      expect(data.course_interest).toBe('MBBS / BDS');

      // Academic and Examination fields
      expect(data.neet_score).toBe(585);
      expect(data.neet_rank).toBe(14500);
      expect(data.neet_year).toBe(2025);
      expect(data.neet_attempts).toBe(1);

      expect(data.eamcet_score).toBe(112);
      expect(data.eamcet_rank).toBe(4820);
      expect(data.eamcet_year).toBe(2025);
      expect(data.eamcet_attempts).toBe(1);

      expect(data.ipe_marks).toBe(965);
      expect(data.ipe_percentage).toBe(96.5);
      expect(data.ipe_year).toBe(2024);
      expect(data.ipe_attempts).toBe(1);
    });

    it('supports POST requests to retrieve student details', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        body: { leadId: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe('lead-lv-10294');
      expect(res.body.name).toBe('Rahul Kumar');
    });
  });

  // --------------------------------------------------------------------------
  // 2. ZERO PHONE EXPOSURE IN LEAD-DETAIL VIEW
  // --------------------------------------------------------------------------
  describe('2. Zero Phone Exposure in Lead-Detail View', () => {
    it('strictly omits phone property and any phone digits from JSON response', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);
      expect(res.statusCode).toBe(200);

      const body = res.body;

      // Invariant: 'phone' must never be a property on the returned object
      expect('phone' in body).toBe(false);
      expect('rawPhone' in body).toBe(false);
      expect('raw_phone' in body).toBe(false);
      expect('maskedPhone' in body).toBe(false);
      expect('masked_phone' in body).toBe(false);
      expect('customer_phone' in body).toBe(false);
      expect('phone_number' in body).toBe(false);

      // Verify serialized JSON payload contains ZERO digits of student's phone (9876543210)
      const jsonString = JSON.stringify(body);
      expect(jsonString).not.toContain('9876543210');
      expect(jsonString).not.toContain('98765');
      expect(jsonString).not.toContain('43210');

      // Telecaller email must not leak full raw contact
      expect(body.email).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // 3. ZERO PHONE EXPOSURE IN TELECALLER LEAD QUEUE
  // --------------------------------------------------------------------------
  describe('3. Zero Phone Exposure in Telecaller Lead Queue', () => {
    it('ensures telecaller queue leads do not expose unmasked raw phone numbers', () => {
      const leads = db.getLeads(telecallerA1);
      expect(leads.length).toBeGreaterThan(0);

      leads.forEach((l) => {
        // Must belong to telecaller's org and assignment
        expect(l.organization_id).toBe(telecallerA1.organization_id);
        expect(l.assigned_to).toBe(telecallerA1.id);

        // Never equals raw 10-digit unmasked phone
        expect(l.phone).not.toBe('9876543210');
        expect(l.phone).not.toBe('+91 9876543210');
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. CALLING WORKFLOW WITHOUT PHONE EXPOSURE
  // --------------------------------------------------------------------------
  describe('4. Calling Without Phone Exposure', () => {
    it('keeps live call start fail-closed until secure bridge prerequisites are deployed', async () => {
      const callsBefore = db.getCalls(telecallerA1).length;
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        body: { leadId: 'lead-lv-10294' },
      });

      await callHandler(req, res);

      expect(res.statusCode).toBe(503);
      const data = res.body;

      expect(data.callId).toBeUndefined();
      expect(data.error).toMatch(/secure call bridge/i);
      expect(db.getCalls(telecallerA1)).toHaveLength(callsBefore);
      expect('phone' in data).toBe(false);
      expect('rawPhoneNumber' in data).toBe(false);
      expect('maskedPhone' in data).toBe(false);
    });

    it('rejects call initiation when leadId is missing', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        body: {},
      });

      await callHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/leadId is required/i);
    });
  });

  // --------------------------------------------------------------------------
  // 5. IN-CALL AND POST-CALL ZERO EXPOSURE
  // --------------------------------------------------------------------------
  describe('5. In-Call and Post-Call Zero Exposure', () => {
    it('call history records returned to telecallers never expose raw phone numbers', () => {
      const calls = db.getCalls(telecallerA1);

      calls.forEach((c) => {
        expect(c.telecaller_id).toBe(telecallerA1.id);
        // Call object must not have raw customer phone property
        expect((c as any).phone).toBeUndefined();
        expect((c as any).rawPhone).toBeUndefined();
        expect((c as any).customer_phone).toBeUndefined();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 6. UNASSIGNED LEAD PROTECTION (WITHIN ORGANIZATION)
  // --------------------------------------------------------------------------
  describe('6. Unassigned Lead Protection', () => {
    it('rejects telecaller attempting to view a lead assigned to another telecaller with 403 Forbidden', async () => {
      // Telecaller A2 attempts to view lead-lv-10294 which is assigned to Telecaller A1
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA2}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Forbidden|permission/i);

      // Verifies security event logged
      const secEvents = db.getSecurityEvents(ownerA);
      const violation = secEvents.find((e) => e.event_type === 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT');
      expect(violation).toBeDefined();
      expect(violation?.severity).toBe('HIGH');
    });
  });

  // --------------------------------------------------------------------------
  // 7. CROSS-TENANT LEAD PROTECTION (MULTI-TENANT ISOLATION)
  // --------------------------------------------------------------------------
  describe('7. Cross-Tenant Lead Protection', () => {
    it('rejects telecaller attempting to view a lead from another organization with 404 Not Found without disclosing existence', async () => {
      // Telecaller B (Prime Careers) attempts to view lead-lv-10294 (Vertex Consultancy)
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerB}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      // Must be 404 so caller cannot determine whether lead exists in another org
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);

      // Verifies critical security event logged
      const secEvents = db.getSecurityEvents(ownerA);
      const crossTenantEvent = secEvents.find((e) => e.event_type === 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT');
      expect(crossTenantEvent).toBeDefined();
      expect(crossTenantEvent?.severity).toBe('CRITICAL');
    });
  });

  // --------------------------------------------------------------------------
  // 8. UNAUTHENTICATED & TAMPERED REQUEST PROTECTION
  // --------------------------------------------------------------------------
  describe('8. Unauthenticated & Tampered Request Protection', () => {
    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {},
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/unauthorized|authorization/i);
    });

    it('rejects revoked or tampered session token with 401 Unauthorized', async () => {
      const token = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: telecallerA1.organization_id,
        role: 'TELECALLER',
        email: telecallerA1.email || 'arjun@vertex.com',
        fullName: telecallerA1.full_name,
      });

      revokeSession(token);

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(401);
    });

    it('rejects inactive or suspended profile with 403 Forbidden', async () => {
      const suspendedToken = createSignedSessionToken({
        userId: 'user-suspended-tc',
        profileId: 'tc-suspended-01',
        organizationId: orgAId,
        role: 'TELECALLER',
        email: 'suspended@vertex.com',
        fullName: 'Suspended User',
        status: 'SUSPENDED',
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${suspendedToken}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/suspended|inactive/i);
    });
  });

  // --------------------------------------------------------------------------
  // 9. STATUTORY LEAD-DETAIL AUDIT LOGGING
  // --------------------------------------------------------------------------
  describe('9. Statutory Lead-Detail Audit Logging', () => {
    it('records immutable LEAD_DETAILS_ACCESSED audit record without phone numbers', async () => {
      const initialLogsCount = db.getActivityLogs(ownerA).length;

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);
      expect(res.statusCode).toBe(200);

      const logs = db.getActivityLogs(ownerA);
      expect(logs.length).toBeGreaterThan(initialLogsCount);

      const detailLog = logs.find(
        (l) => l.action === 'LEAD_DETAILS_ACCESSED' && l.entity_id === 'lead-lv-10294'
      );

      expect(detailLog).toBeDefined();
      expect(detailLog?.user_id).toBe(telecallerA1.id);
      expect(detailLog?.organization_id).toBe(orgAId);
      expect(detailLog?.metadata?.leadCode).toBe('LV-10294');

      // Statutory audit log metadata must never leak customer phone numbers
      const logString = JSON.stringify(detailLog);
      expect(logString).not.toContain('9876543210');
    });

    it('prevents tampering or deletion of activity audit logs', () => {
      expect(() => db.deleteActivityLog()).toThrow(/append-only/i);
      expect(() => db.updateActivityLog()).toThrow(/immutable/i);
    });
  });

  // --------------------------------------------------------------------------
  // 10. SAFE RENDERING OF MISSING FIELDS (ZERO FABRICATION)
  // --------------------------------------------------------------------------
  describe('10. Safe Rendering of Missing Fields', () => {
    it('returns null for missing fields without inventing fake scores or names', async () => {
      // lead-lv-10291 has explicit nulls for mother_name, neet_score, neet_rank, etc.
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10291' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body;

      expect(data.id).toBe('lead-lv-10291');
      expect(data.name).toBe('Pooja Verma');
      expect(data.father_name).toBe('Rajesh Verma');

      // Explicit null checks (never fabricated)
      expect(data.mother_name).toBeNull();
      expect(data.neet_score).toBeNull();
      expect(data.neet_rank).toBeNull();
      expect(data.neet_year).toBeNull();
      expect(data.neet_attempts).toBeNull();

      // Available examination fields are accurately returned
      expect(data.eamcet_score).toBe(128);
      expect(data.eamcet_rank).toBe(2150);
      expect(data.ipe_marks).toBe(978);
      expect(data.ipe_percentage).toBe(97.8);
    });
  });

  // --------------------------------------------------------------------------
  // 11. REGRESSION PROTECTION & CLIENT LEAD SERVICE
  // --------------------------------------------------------------------------
  describe('11. Regression Protection & Client Lead Service', () => {
    it('allows Owner to inspect lead details across their organization', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenOwnerA}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.id).toBe('lead-lv-10294');
      expect(res.body.name).toBe('Rahul Kumar');
    });

    it('leadService.getStudentDetails retrieves details and strictly omits phone in sandbox mode', async () => {
      const details = await leadService.getStudentDetails('lead-lv-10294', telecallerA1);

      expect(details).toBeDefined();
      expect(details.id).toBe('lead-lv-10294');
      expect(details.name).toBe('Rahul Kumar');
      expect(details.father_name).toBe('Suresh Kumar');
      expect(details.neet_score).toBe(585);

      // Verify no phone property exists on the returned StudentDetails
      expect('phone' in details).toBe(false);
    });

    it('leadService.getStudentDetails throws cleanly on unauthorized access without falling back to mock phone', async () => {
      await expect(
        leadService.getStudentDetails('lead-lv-10294', telecallerA2)
      ).rejects.toThrow(/Forbidden|permission/i);
    });
  });

  // --------------------------------------------------------------------------
  // 12. ADVERSARIAL NEGATIVE TESTING & PARAMETER TAMPERING
  // --------------------------------------------------------------------------
  describe('12. Adversarial Negative Testing & Parameter Tampering', () => {
    it('ignores parameter pollution attempts such as ?fields=phone,ssn', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10294', fields: 'phone,raw_phone,ssn', include: 'everything' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect('phone' in res.body).toBe(false);
      expect('ssn' in res.body).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('9876543210');
    });

    it('ignores header spoofing attempts such as X-Forwarded-Role or X-User-Role', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {
          authorization: `Bearer ${tokenTelecallerA2}`,
          'x-forwarded-role': 'ADMIN',
          'x-user-role': 'OWNER',
        },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      // Token claims override spoofed headers; unassigned access is denied
      expect(res.statusCode).toBe(403);
    });

    it('rejects unsupported HTTP methods with 405 Method Not Allowed', async () => {
      const { req, res } = createMockReqRes({
        method: 'DELETE',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-lv-10294' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(405);
      expect(res.body.error).toMatch(/Method Not Allowed/i);
    });

    it('returns 404 for non-existent lead ID', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA1}` },
        query: { id: 'lead-non-existent-999999' },
      });

      await leadDetailHandler(req, res);

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });
});
