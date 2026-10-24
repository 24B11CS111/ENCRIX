/**
 * ENCRIX Phase 22.1: Security-Critical Schema Remediation & Zero Phone Exposure Test Suite
 *
 * NOTE ON TEST ISOLATION & TEST MODES:
 * - Suites 1 to 4 run against the in-memory test harness & serverless API route handlers.
 * - Suite 5 validates the SQL migration artifacts, DDL constraints, and clean-database migration plan.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { sanitizeLeadForRole, scrubPhoneFromText } from '@/lib/dataMasking';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import detailHandler from '../../api/_lib/leads/detail';
import callHandler from '../../api/telephony/call';
import { Profile, Lead } from '@/types';
import fs from 'fs';
import path from 'path';

function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
}) {
  const req = {
    method: options.method || 'GET',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body || {},
  };

  let statusCode = 200;
  let body: any = null;
  const headers: Record<string, string> = {};

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: any) {
      body = data;
      return res;
    },
    setHeader(key: string, val: string) {
      headers[key] = val;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };

  return { req, res };
}

describe('Phase 22.1: Security-Critical Schema Remediation & Zero Phone Hardening', () => {
  let orgA: string;
  let orgB: string;
  let ownerA: Profile;
  let telecallerA: Profile;
  let telecallerB: Profile;
  let leadAAssigned: Lead;
  let leadAUnassigned: Lead;
  let leadB: Lead;
  let tokenTelecallerA: string;
  let tokenOwnerA: string;

  beforeEach(() => {
    // Fresh state for each test
    orgA = 'org-apex-phase22';
    orgB = 'org-bravo-phase22';

    ownerA = {
      id: 'usr-owner-a',
      user_id: 'auth-owner-a',
      organization_id: orgA,
      full_name: 'Vikram Mehta',
      role: 'OWNER',
      status: 'ACTIVE',
      email: 'owner@apex.io',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    telecallerA = {
      id: 'usr-tc-a',
      user_id: 'auth-tc-a',
      organization_id: orgA,
      full_name: 'Ananya Sharma',
      role: 'TELECALLER',
      status: 'ACTIVE',
      email: 'ananya@apex.io',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    telecallerB = {
      id: 'usr-tc-b',
      user_id: 'auth-tc-b',
      organization_id: orgB,
      full_name: 'Rohan Verma',
      role: 'TELECALLER',
      status: 'ACTIVE',
      email: 'rohan@bravo.io',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db.resetSandbox();
    (db as any).profiles = [ownerA, telecallerA, telecallerB];

    leadAAssigned = db.createLead(
      {
        name: 'Kavya Nair',
        phone: '+91 9876543210',
        email: 'kavya@example.com',
        source: 'Google Ads',
        priority: 'HIGH',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
        notes: 'Parent mobile: +91 9123456789. Student requested call back at 4pm.',
        metadata: {
          father_name: 'Ramesh Nair',
          neet_score: 620,
          contact_phone: '+91 9876543210',
          alternate_phone: '9876543210',
        },
      },
      ownerA
    );

    leadAUnassigned = db.createLead(
      {
        name: 'Suresh Patel',
        phone: '+91 9845012345',
        email: 'suresh@example.com',
        source: 'Website',
        priority: 'MEDIUM',
        status: 'NEW',
        assigned_to: null,
        notes: 'Inquiry received online.',
      },
      ownerA
    );

    leadB = db.createLead(
      {
        name: 'Pooja Reddy',
        phone: '+91 9988776655',
        email: 'pooja@example.com',
        source: 'Referral',
        priority: 'URGENT',
        status: 'ASSIGNED',
        assigned_to: telecallerB.id,
        notes: 'Lead for Org B',
      },
      { ...ownerA, organization_id: orgB, id: 'owner-b' }
    );

    tokenTelecallerA = createSignedSessionToken({
      userId: telecallerA.user_id,
      profileId: telecallerA.id,
      organizationId: orgA,
      role: 'TELECALLER',
      fullName: telecallerA.full_name,
      email: telecallerA.email!,
    });

    tokenOwnerA = createSignedSessionToken({
      userId: ownerA.user_id,
      profileId: ownerA.id,
      organizationId: orgA,
      role: 'OWNER',
      fullName: ownerA.full_name,
      email: ownerA.email!,
    });
  });

  // ==========================================================================
  // SUITE 1: STRICT ZERO PHONE EXPOSURE (IN-MEMORY & COMPONENT TESTS)
  // ==========================================================================
  describe('1. Strict Zero Phone Exposure Invariant (Telecallers Receive No Digits)', () => {
    it('db.getLeads(telecaller): strictly omits phone property and contains no phone digits', () => {
      const leads = db.getLeads(telecallerA);
      expect(leads.length).toBeGreaterThan(0);

      leads.forEach((l) => {
        expect(l.phone).toBeUndefined();
        expect('phone' in l).toBe(false);

        // Name is masked
        expect(l.name).toMatch(/^[A-Za-z]+\s[A-Z]\.$/);

        // Serialized representation contains zero 10-digit phone numbers
        const json = JSON.stringify(l);
        expect(json).not.toMatch(/\+?91[\s-]?\d{10}/);
        expect(json).not.toMatch(/\b\d{10}\b/);
      });
    });

    it('db.getLeadById(leadId, telecaller): strictly omits phone property', () => {
      const lead = db.getLeadById(leadAAssigned.id, telecallerA);
      expect(lead.phone).toBeUndefined();
      expect('phone' in lead).toBe(false);
      expect(lead.name).toBe('Kavya N.');
    });

    it('db.getStudentLeadDetails(leadId, telecaller): strictly omits phone property', () => {
      const details = db.getStudentLeadDetails(leadAAssigned.id, telecallerA);
      expect((details as any).phone).toBeUndefined();
      expect('phone' in details).toBe(false);
      expect(details.name).toBe('Kavya Nair');
      expect(details.email).toBe('***@***.***');
    });

    it('db.getFollowUps(telecaller): strictly omits lead_phone and phone properties', () => {
      const fup = db.scheduleFollowUp(
        {
          lead_id: leadAAssigned.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          notes: 'Call back student',
          assigned_to: telecallerA.id,
        },
        ownerA
      );

      const telecallerFups = db.getFollowUps(telecallerA);
      const targetFup = telecallerFups.find((f) => f.id === fup.id);
      expect(targetFup).toBeDefined();
      expect(targetFup?.lead_phone).toBeUndefined();
      expect((targetFup as any)?.phone).toBeUndefined();
    });

    it('scrubPhoneFromText: strips 10-digit and international numbers from free-text notes', () => {
      const rawNotes = 'Parent mobile: +91 9123456789. Alternate: 9876543210. Called earlier.';
      const scrubbed = scrubPhoneFromText(rawNotes);
      expect(scrubbed).not.toContain('9123456789');
      expect(scrubbed).not.toContain('9876543210');
      expect(scrubbed).toContain('[PHONE PROTECTED]');
    });

    it('scrubPhoneFromText: robustly catches slashes, underscores, 5-5 splits, and spaced digits without breaking PIN codes or test scores', () => {
      expect(scrubPhoneFromText('Call 98765/43210')).toContain('[PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call 98765_43210')).toContain('[PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call 98765 43210')).toContain('[PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call +91-98765-43210')).toContain('[PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call 9 8 7 6 5 4 3 2 1 0')).toContain('[PHONE PROTECTED]');

      // Preserves valid non-phone numbers (PIN code 6 digits, exam scores 3-4 digits)
      expect(scrubPhoneFromText('PIN code 500081')).toBe('PIN code 500081');
      expect(scrubPhoneFromText('Score 650 in 2024 rank 1250')).toBe('Score 650 in 2024 rank 1250');
    });

    it('sanitizeLeadForRole: strips digits from family/location fields and redacts long numbers in educational fields', () => {
      const dirtyLead: Lead = {
        ...leadAAssigned,
        father_name: 'Dr. Ramesh Sharma 9876543210',
        mother_name: 'Sunita Sharma +91 9988776655',
        city: 'Hyderabad 500081',
        state: 'Telangana 500081',
        school_or_college: 'DPS Hyderabad 2024 (Call 9876543210)',
        course_interest: 'MBBS Special Call 9876543210',
      };

      const sanitized = sanitizeLeadForRole(dirtyLead, 'TELECALLER');
      expect(sanitized.father_name).toBe('Dr. Ramesh Sharma');
      expect(sanitized.mother_name).toBe('Sunita Sharma +');
      expect(sanitized.city).toBe('Hyderabad');
      expect(sanitized.state).toBe('Telangana');
      expect(sanitized.school_or_college).toContain('2024');
      expect(sanitized.school_or_college).not.toContain('9876543210');
      expect(sanitized.course_interest).not.toContain('9876543210');

      // Owner receives original unstripped fields
      const ownerLead = sanitizeLeadForRole(dirtyLead, 'OWNER');
      expect(ownerLead.father_name).toBe('Dr. Ramesh Sharma 9876543210');
      expect(ownerLead.city).toBe('Hyderabad 500081');
    });

    it('getFollowUps and getNotifications: scrub notes, reasons, and notification text for telecaller', () => {
      // 1. Follow-up notes and reason scrubbing
      const fup = db.scheduleFollowUp(
        {
          lead_id: leadAAssigned.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          notes: 'Call parent at 98765/43210 tomorrow',
          reason: 'Callback requested on 98765 43210',
          assigned_to: telecallerA.id,
        },
        ownerA
      );

      const telecallerFups = db.getFollowUps(telecallerA);
      const targetFup = telecallerFups.find((f) => f.id === fup.id);
      expect(targetFup?.notes).toContain('[PHONE PROTECTED]');
      expect(targetFup?.notes).not.toContain('98765/43210');
      expect(targetFup?.reason).toContain('[PHONE PROTECTED]');
      expect(targetFup?.reason).not.toContain('98765 43210');

      // 2. Notification scrubbing
      db.createNotification({
        organization_id: orgA,
        user_id: telecallerA.id,
        type: 'SYSTEM',
        title: 'Emergency contact 9876543210',
        message: 'Student requested callback on 98765_43210 immediately.',
      });

      const notifs = db.getNotifications(telecallerA);
      const targetNotif = notifs.find((n) => n.title.includes('Emergency'));
      expect(targetNotif?.title).toContain('[PHONE PROTECTED]');
      expect(targetNotif?.title).not.toContain('9876543210');
      expect(targetNotif?.message).toContain('[PHONE PROTECTED]');
      expect(targetNotif?.message).not.toContain('98765_43210');
    });
  });

  // ==========================================================================
  // SUITE 2: REST / SERVERLESS API ZERO-PHONE INTEGRATION TESTS
  // ==========================================================================
  describe('2. Serverless API Zero-Phone Protection', () => {
    it('/api/leads/detail: telecaller response excludes phone and scrubs notes/metadata', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA}` },
        query: { id: leadAAssigned.id },
      });

      await detailHandler(req, res);

      expect(res.statusCode).toBe(200);
      const data = res.body;

      // Assert phone is absent
      expect(data.phone).toBeUndefined();
      expect('phone' in data).toBe(false);
      expect('maskedPhone' in data).toBe(false);

      // Assert notes scrubbed
      expect(data.notes).toContain('[PHONE PROTECTED]');
      expect(data.notes).not.toContain('9123456789');

      // Assert raw digits not in entire payload string
      const payloadStr = JSON.stringify(data);
      expect(payloadStr).not.toContain('9876543210');
      expect(payloadStr).not.toContain('9123456789');
    });

    it('/api/telephony/call: authorized request remains fail-closed without a call session or phone data', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTelecallerA}` },
        body: { leadId: leadAAssigned.id },
      });

      await callHandler(req, res);

      expect(res.statusCode).toBe(503);
      const data = res.body;

      expect(data.error).toMatch(/Secure call bridge is not configured/i);
      expect(data.callId).toBeUndefined();
      expect(data.status).toBeUndefined();

      // ZERO phone exposure, including on a fail-closed response.
      expect(data.phone).toBeUndefined();
      expect(data.maskedPhone).toBeUndefined();
      expect('phone' in data).toBe(false);
      expect('maskedPhone' in data).toBe(false);
      expect(JSON.stringify(data)).not.toContain('9876543210');
    });

    it('Realtime payload sanitizer: strips all phone fields and scrubs notes/metadata for telecallers', () => {
      let receivedPayload: any = null;
      const unsub = db.subscribe((event) => {
        if (event.type === 'RECORD_INSERTED') {
          receivedPayload = event.payload;
        }
      }, telecallerA);

      (db as any).emit(
        'RECORD_INSERTED',
        {
          table: 'leads',
          eventType: 'INSERT',
          new: {
            id: 'lead-rt-test',
            organization_id: orgA,
            assigned_to: telecallerA.id,
            name: 'Priya Sharma',
            phone: '+91 9998887776',
            lead_phone: '+91 9998887776',
            notes: 'Direct phone: 9998887776',
            metadata: { phone: '+91 9998887776' },
          },
          old: {},
        },
        { organization_id: orgA, target_user_id: telecallerA.id }
      );

      expect(receivedPayload).not.toBeNull();
      expect(receivedPayload.new.phone).toBeUndefined();
      expect(receivedPayload.new.lead_phone).toBeUndefined();
      expect('phone' in receivedPayload.new).toBe(false);
      expect(receivedPayload.new.notes).toContain('[PHONE PROTECTED]');
      expect(receivedPayload.new.metadata?.phone).toBeUndefined();

      unsub();
    });
  });

  // ==========================================================================
  // SUITE 3: TENANT ISOLATION & PRIVILEGE PROTECTION
  // ==========================================================================
  describe('3. Tenant Isolation and Privilege Protection', () => {
    it('prevents an Owner from granting global ADMIN, including to another Owner', () => {
      const otherOwner = db.createProfile({
        id: 'usr-owner-b',
        user_id: 'auth-owner-b',
        organization_id: orgA,
        full_name: 'Second Owner',
        role: 'OWNER',
      });

      expect(() => {
        db.updateProfile(otherOwner.id, { role: 'ADMIN' }, ownerA);
      }).toThrow(/platform administration flow/i);
      expect((db as any).profiles.find((profile: Profile) => profile.id === otherOwner.id).role).toBe('OWNER');
    });

    it('prevents an Owner from promoting a Telecaller to global ADMIN', () => {
      expect(() => {
        db.updateProfile(telecallerA.id, { role: 'ADMIN' }, ownerA);
      }).toThrow(/platform administration flow/i);
    });

    it('prevents creating or assigning global ADMIN outside the platform flow', () => {
      expect(() =>
        db.createProfile({
          id: 'usr-illegal-admin',
          organization_id: orgA,
          full_name: 'Illegal Admin',
          role: 'ADMIN',
        }, ownerA)
      ).toThrow(/platform administration flow/i);

      expect(() => db.updateProfileRole(ownerA.id, 'ADMIN', ownerA)).toThrow(/platform administration flow/i);
    });

    it('preserves permitted Owner-to-Telecaller role changes within the organization', () => {
      const updated = db.updateProfile(telecallerA.id, { role: 'OWNER' }, ownerA);
      expect(updated.role).toBe('OWNER');
      expect(updated.organization_id).toBe(orgA);
    });

    it('prevents self-elevation of user role (Telecaller cannot elevate to OWNER or ADMIN)', () => {
      expect(() => {
        db.updateProfile(telecallerA.id, { role: 'OWNER' }, telecallerA);
      }).toThrow(/Privilege Violation: Self-elevation/i);

      expect(() => {
        db.updateProfile(telecallerA.id, { role: 'ADMIN' }, telecallerA);
      }).toThrow(/Privilege Violation: Self-elevation/i);

      // Verify security event was recorded
      const secEvents = db.getSecurityEvents(ownerA);
      expect(secEvents.some((e) => e.event_type === 'ROLE_ESCALATION_ATTEMPT')).toBe(true);
    });

    it('prevents non-admins from altering organization_id (tenant hopping blocked)', () => {
      expect(() => {
        db.updateProfile(telecallerA.id, { organization_id: orgB }, telecallerA);
      }).toThrow(/Privilege Violation: Changing organization_id/i);

      expect(() => {
        db.updateProfile(telecallerA.id, { organization_id: orgB }, ownerA);
      }).toThrow(/Privilege Violation: Changing organization_id/i);
    });

    it('prevents suspended or disabled users from unsuspending themselves', () => {
      // Suspend telecaller
      db.updateProfileStatus(telecallerA.id, 'DISABLED', ownerA);

      const suspendedTelecaller = { ...telecallerA, status: 'DISABLED' as const };

      expect(() => {
        db.updateProfile(telecallerA.id, { status: 'ACTIVE' }, suspendedTelecaller);
      }).toThrow(/Privilege Violation: Suspended users cannot reactivate/i);
    });

    it('blocks telecaller from accessing unassigned lead within same organization', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA}` },
        query: { id: leadAUnassigned.id },
      });

      await detailHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Forbidden: You do not have permission to access this lead|You can only view leads assigned to you/i);
    });

    it('blocks telecaller from placing call to unassigned lead', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTelecallerA}` },
        body: { leadId: leadAUnassigned.id },
      });

      await callHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/You can only call leads assigned to you/i);
    });

    it('blocks cross-tenant lead access (Telecaller A cannot access Org B lead)', async () => {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecallerA}` },
        query: { id: leadB.id },
      });

      await detailHandler(req, res);
      // Returns 404 to avoid disclosing existence of other tenant's lead
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toMatch(/not found or unauthorized/i);

      // Critical security event logged
      const secEvents = db.getSecurityEvents(ownerA);
      expect(secEvents.some((e) => e.event_type === 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT')).toBe(true);
    });
  });

  // ==========================================================================
  // SUITE 4: SCHEMA CONFORMANCE & AUDIT COLUMNS
  // ==========================================================================
  describe('4. Schema Conformance and Field Integrity', () => {
    it('lead records support calls_count and last_contacted_at', () => {
      const lead = db.getLeadById(leadAAssigned.id, ownerA);
      expect(lead.calls_count).toBeDefined();

      // Place a call to verify increments
      db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: 45,
          status: 'COMPLETED',
        },
        ownerA
      );

      const updatedLead = db.getLeadById(lead.id, ownerA);
      expect(updatedLead.calls_count).toBe((lead.calls_count || 0) + 1);
      expect(updatedLead.last_contacted_at).toBeDefined();
    });
  });

  // ==========================================================================
  // SUITE 5: MIGRATION DDL VALIDATION (ARTIFACT & STATIC CHECKS)
  // ==========================================================================
  describe('5. Migration DDL & Clean Database Validation Plan', () => {
    const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');

    it('verifies 20261008000000_email_otp_authentication.sql contains profiles.email and pending_reg unique constraint', () => {
      const emailOtpMigration = fs.readFileSync(
        path.join(migrationsDir, '20261008000000_email_otp_authentication.sql'),
        'utf-8'
      );

      // Must add email column before index
      expect(emailOtpMigration).toMatch(/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS email VARCHAR/i);
      expect(emailOtpMigration).toMatch(/CREATE INDEX IF NOT EXISTS idx_profiles_email ON public\.profiles\(email\)/i);

      // Must add unique constraint on pending_registrations(email)
      expect(emailOtpMigration).toMatch(/ADD CONSTRAINT pending_registrations_email_key UNIQUE \(email\)/i);
    });

    it('verifies 20261018000000_phase22_security_critical_remediation.sql contains complete remediation DDL', () => {
      const remediationSql = fs.readFileSync(
        path.join(migrationsDir, '20261018000000_phase22_security_critical_remediation.sql'),
        'utf-8'
      );

      // 1. Column additions for leads
      expect(remediationSql).toMatch(/ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ/i);
      expect(remediationSql).toMatch(/ADD COLUMN IF NOT EXISTS calls_count INTEGER NOT NULL DEFAULT 0/i);

      // 2. Privilege protection trigger and RLS on public.profiles
      expect(remediationSql).toMatch(/FUNCTION public\.protect_profile_privilege_escalation\(\)/i);
      expect(remediationSql).toMatch(/TRIGGER trg_protect_profile_privilege_escalation/i);
      expect(remediationSql).toMatch(/POLICY "Users can update their own profile" ON public\.profiles/i);

      // 3. Telecaller direct SELECT revocation on public.leads
      expect(remediationSql).toMatch(/DROP POLICY IF EXISTS "Telecallers view only assigned leads" ON public\.leads/i);
      expect(remediationSql).toMatch(/POLICY "Admins and Owners manage org leads" ON public\.leads/i);
      expect(remediationSql).toMatch(/POLICY "Telecallers update only assigned leads" ON public\.leads/i);

      // 4. initiate_authorized_call returns zero phone digits (no masked_phone)
      expect(remediationSql).toMatch(/FUNCTION public\.initiate_authorized_call/i);
      expect(remediationSql).not.toMatch(/'masked_phone'/i);

      // 5. SECURITY DEFINER search path pinning (Phase 22.3)
      expect(remediationSql).toMatch(/protect_profile_privilege_escalation[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);
      expect(remediationSql).toMatch(/initiate_authorized_call[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);
      expect(remediationSql).toMatch(/get_telecaller_student_detail[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);

      // 6. Schema creation privilege revocation (Phase 22.3)
      expect(remediationSql).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
      expect(remediationSql).toMatch(/REVOKE ALL ON SCHEMA public FROM anon/i);

      // 7. telecaller_leads_view sanitization & digit stripping
      expect(remediationSql).toMatch(/REGEXP_REPLACE\(l\.notes,.*?'\[PHONE PROTECTED\]'/i);
      expect(remediationSql).toMatch(/REGEXP_REPLACE\(l\.father_name, '\[0-9\]', '', 'g'\)/i);
      expect(remediationSql).toMatch(/REGEXP_REPLACE\(l\.city, '\[0-9\]', '', 'g'\)/i);
    });
  });
});
