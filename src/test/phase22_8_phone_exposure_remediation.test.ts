/**
 * ENCRIX Phase 22.8: Final Phone-Exposure Remediation Regression Test Suite
 *
 * Verifies that telecaller data access boundaries strictly enforce zero phone-number
 * exposure across:
 * 1. Student names (chunked, formatted, or pure-digit names)
 * 2. Academic text fields (school_or_college, course_interest with chunked/spaced/punctuated phone numbers)
 * 3. Free-text notes and follow-up reasons
 * 4. System notifications
 * 5. Serverless student detail API (/api/leads/detail)
 * 6. Realtime event payloads
 * 7. Forward migration DDL integrity (20261019000000_phase22_phone_exposure_remediation.sql)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import {
  sanitizeStudentName,
  maskName,
  scrubPhoneFromText,
  stripDigitsFromText,
  redactLongDigitsFromText,
  sanitizeLeadForRole,
} from '@/lib/dataMasking';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import detailHandler from '../../api/leads/detail';
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

describe('ENCRIX Phase 22.8: Final Phone-Exposure Remediation', () => {
  const orgId = 'org-remediation-test';

  const ownerProfile: Profile = {
    id: 'prof-owner-rem',
    user_id: 'auth-owner-rem',
    organization_id: orgId,
    full_name: 'Rajesh Varma',
    role: 'OWNER',
    status: 'ACTIVE',
    email: 'rajesh@apex.io',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerProfile: Profile = {
    id: 'prof-tc-rem',
    user_id: 'auth-tc-rem',
    organization_id: orgId,
    full_name: 'Kavita Rao',
    role: 'TELECALLER',
    status: 'ACTIVE',
    email: 'kavita@apex.io',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let tokenTelecaller: string;
  let tokenOwner: string;

  beforeEach(() => {
    db.resetSandbox(true);
    (db as any).profiles = [ownerProfile, telecallerProfile];

    tokenTelecaller = createSignedSessionToken({
      userId: telecallerProfile.user_id,
      profileId: telecallerProfile.id,
      organizationId: telecallerProfile.organization_id,
      role: 'TELECALLER',
      email: telecallerProfile.email || 'kavita@apex.io',
      fullName: telecallerProfile.full_name,
    });

    tokenOwner = createSignedSessionToken({
      userId: ownerProfile.user_id,
      profileId: ownerProfile.id,
      organizationId: ownerProfile.organization_id,
      role: 'OWNER',
      email: ownerProfile.email || 'rajesh@apex.io',
      fullName: ownerProfile.full_name,
    });
  });

  // --------------------------------------------------------------------------
  // 1. STUDENT NAME PROTECTION
  // --------------------------------------------------------------------------
  describe('1. Student Name Protection', () => {
    it('sanitizeStudentName strips all numeric digits and telephone punctuation', () => {
      expect(sanitizeStudentName('Rahul Kumar')).toBe('Rahul Kumar');
      expect(sanitizeStudentName('Rahul 9876543210')).toBe('Rahul');
      expect(sanitizeStudentName('Priya +91 98765 43210')).toBe('Priya');
      expect(sanitizeStudentName('Ananya (9876-5432-10) Sharma')).toBe('Ananya Sharma');
      expect(sanitizeStudentName('Suresh / 9876.543.210')).toBe('Suresh');
    });

    it('sanitizeStudentName falls back to "Student" if name was purely digits or punctuation', () => {
      expect(sanitizeStudentName('9876543210')).toBe('Student');
      expect(sanitizeStudentName('+91-98765-43210')).toBe('Student');
      expect(sanitizeStudentName('(040) 2345-6789')).toBe('Student');
      expect(sanitizeStudentName('')).toBe('Student');
      expect(sanitizeStudentName(null)).toBe('Student');
      expect(sanitizeStudentName(undefined)).toBe('Student');
    });

    it('maskName never emits phone digits and handles malicious names', () => {
      expect(maskName('Rahul Kumar')).toBe('Rahul K.');
      expect(maskName('Rahul 9876543210')).toBe('Rahul');
      expect(maskName('9876543210')).toBe('Student');
      expect(maskName('+91 98765 43210')).toBe('Student');
      expect(maskName('Priya 9876-5432-10 Sharma')).toBe('Priya S.');
      expect(maskName('Ananya Reddy')).toBe('Ananya R.');
    });

    it('/api/leads/detail returns sanitized name without digits for telecallers, raw name for owners', async () => {
      // Create lead with phone number smuggled into name
      const dirtyLead = db.createLead(
        {
          name: 'Arjun Das +91 98111 22233',
          phone: '+919811122233',
          source: 'Website',
          priority: 'HIGH',
          status: 'NEW',
          assigned_to: telecallerProfile.id,
        },
        ownerProfile
      );

      // Telecaller request
      const { req: tcReq, res: tcRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTelecaller}` },
        query: { id: dirtyLead.id },
      });

      await detailHandler(tcReq, tcRes);
      expect(tcRes.statusCode).toBe(200);
      expect(tcRes.body.name).toBe('Arjun Das');
      expect(tcRes.body.name).not.toMatch(/\d/);
      expect(tcRes.body.name).not.toContain('98111');

      // Owner request
      const { req: ownerReq, res: ownerRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tokenOwner}` },
        query: { id: dirtyLead.id },
      });

      await detailHandler(ownerReq, ownerRes);
      expect(ownerRes.statusCode).toBe(200);
      expect(ownerRes.body.name).toBe('Arjun Das +91 98111 22233');
    });
  });

  // --------------------------------------------------------------------------
  // 2. ACADEMIC TEXT PROTECTION (CHUNKED / FORMATTED PHONE PATTERNS)
  // --------------------------------------------------------------------------
  describe('2. Academic Text Protection', () => {
    it('redactLongDigitsFromText scrubs formatted and chunked phone numbers', () => {
      expect(redactLongDigitsFromText('DPS Hyderabad 9876543210')).toBe('DPS Hyderabad [PHONE PROTECTED]');
      expect(redactLongDigitsFromText('DPS Hyderabad 9876-5432-10')).toBe('DPS Hyderabad [PHONE PROTECTED]');
      expect(redactLongDigitsFromText('DPS Hyderabad 9876 5432 10')).toBe('DPS Hyderabad [PHONE PROTECTED]');
      expect(redactLongDigitsFromText('DPS Hyderabad +91 98765 43210')).toBe('DPS Hyderabad [PHONE PROTECTED]');
      expect(redactLongDigitsFromText('Sri Chaitanya (Call 9876/543/210)')).toBe('Sri Chaitanya (Call [PHONE PROTECTED])');
      expect(redactLongDigitsFromText('Narayana College 98_76_54_32_10')).toBe('Narayana College [PHONE PROTECTED]');
      expect(redactLongDigitsFromText('Course MBBS (040) 2345-6789')).toBe('Course MBBS [PHONE PROTECTED]');
    });

    it('redactLongDigitsFromText redacts chunked 5+ digit sequences (e.g. 9876-5432 or 98 76 54)', () => {
      expect(redactLongDigitsFromText('School Ref 9876-5432')).toContain('[PHONE PROTECTED]');
      expect(redactLongDigitsFromText('College Roll 98 76 54')).toContain('[REDACTED]');
      expect(redactLongDigitsFromText('Campus Postal PIN 500032')).toBe('Campus Postal PIN [REDACTED]');
    });

    it('redactLongDigitsFromText preserves legitimate academic information and years', () => {
      expect(redactLongDigitsFromText('Sri Chaitanya Junior College')).toBe('Sri Chaitanya Junior College');
      expect(redactLongDigitsFromText('DPS Hyderabad 2024')).toBe('DPS Hyderabad 2024');
      expect(redactLongDigitsFromText('Class 12 MBBS / BDS')).toBe('Class 12 MBBS / BDS');
      expect(redactLongDigitsFromText('NEET Year 2025')).toBe('NEET Year 2025');
    });

    it('sanitizeLeadForRole redacts chunked numbers in school_or_college and course_interest', () => {
      const lead: Lead = {
        id: 'lead-test-academic',
        organization_id: orgId,
        lead_code: 'LV-TEST',
        name: 'Suresh Kumar',
        phone: '+919876543210',
        status: 'NEW',
        priority: 'MEDIUM',
        source: 'Website',
        assigned_to: telecallerProfile.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        school_or_college: 'DPS Hyderabad 9876-5432-10',
        course_interest: 'MBBS Call 9876 5432 10',
      };

      const sanitized = sanitizeLeadForRole(lead, 'TELECALLER');
      expect(sanitized.school_or_college).not.toContain('9876-5432-10');
      expect(sanitized.school_or_college).toContain('[PHONE PROTECTED]');
      expect(sanitized.course_interest).not.toContain('9876 5432 10');
      expect(sanitized.course_interest).toContain('[PHONE PROTECTED]');
    });
  });

  // --------------------------------------------------------------------------
  // 3. NOTES, FOLLOW-UPS & NOTIFICATION MESSAGES
  // --------------------------------------------------------------------------
  describe('3. Notes and Notification Messages Protection', () => {
    it('scrubPhoneFromText catches chunked, spaced, and punctuated telephone sequences', () => {
      expect(scrubPhoneFromText('Call student on 9876543210')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on 9876-5432-10')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on 9876 5432 10')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on +91-98765-43210')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on (040) 2345-6789')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on 98_76_54_32_10')).toBe('Call student on [PHONE PROTECTED]');
      expect(scrubPhoneFromText('Call student on 9876/543/210')).toBe('Call student on [PHONE PROTECTED]');
    });

    it('db.getFollowUps zeroes lead_phone and scrubs notes/reasons for telecallers', () => {
      const lead = db.createLead(
        {
          name: 'Priya Sharma',
          phone: '+919877788899',
          source: 'Website',
          priority: 'MEDIUM',
          status: 'NEW',
          assigned_to: telecallerProfile.id,
        },
        ownerProfile
      );

      const fup = db.scheduleFollowUp(
        {
          lead_id: lead.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          notes: 'Parent available at 9877-788-899 evening',
          reason: 'Callback requested on +91 98777 88899',
          assigned_to: telecallerProfile.id,
        },
        ownerProfile
      );

      const telecallerFups = db.getFollowUps(telecallerProfile);
      const targetFup = telecallerFups.find((f) => f.id === fup.id);
      expect(targetFup).toBeDefined();
      expect(targetFup?.lead_phone).toBeUndefined();
      expect(targetFup?.notes).toContain('[PHONE PROTECTED]');
      expect(targetFup?.notes).not.toContain('9877-788-899');
      expect(targetFup?.reason).toContain('[PHONE PROTECTED]');
      expect(targetFup?.reason).not.toContain('98777 88899');
    });

    it('db.getNotifications scrubs title and message for telecallers', () => {
      db.createNotification({
        organization_id: orgId,
        user_id: telecallerProfile.id,
        type: 'SYSTEM',
        title: 'Call back 9876-543-210',
        message: 'Lead requested urgent consultation at +91 98765 43210.',
      });

      const notifs = db.getNotifications(telecallerProfile);
      const target = notifs.find((n) => n.title.includes('[PHONE PROTECTED]'));
      expect(target).toBeDefined();
      expect(target?.title).not.toContain('9876-543-210');
      expect(target?.message).toContain('[PHONE PROTECTED]');
      expect(target?.message).not.toContain('98765 43210');
    });
  });

  // --------------------------------------------------------------------------
  // 4. REALTIME PAYLOADS
  // --------------------------------------------------------------------------
  describe('4. Realtime Payload Zero Phone Invariant', () => {
    it('db.subscribe drops lead events without phone and masks lead_name', () => {
      const lead = db.createLead(
        {
          name: 'Karan Mehra 9876543210',
          phone: '+919876543210',
          source: 'Website',
          priority: 'MEDIUM',
          status: 'NEW',
          assigned_to: telecallerProfile.id,
        },
        ownerProfile
      );

      // Verify sanitizeLeadForRole produces zero phone digits in name and object
      const sanitized = sanitizeLeadForRole(lead, 'TELECALLER');
      expect(sanitized.phone).toBeUndefined();
      expect(sanitized.name).toBe('Karan M.');
      expect(sanitized.name).not.toMatch(/\d/);
    });
  });

  // --------------------------------------------------------------------------
  // 5. FORWARD MIGRATION DDL VALIDATION (20261019000000)
  // --------------------------------------------------------------------------
  describe('5. Forward Migration DDL Static Verification', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase',
      'migrations',
      '20261019000000_phase22_phone_exposure_remediation.sql'
    );

    it('forward migration file exists and is readable', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('forward migration pins search_path on all 6 early SECURITY DEFINER functions', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');

      expect(sql).toMatch(/ALTER FUNCTION public\.get_auth_profile\(\) SET search_path = public, pg_temp;/i);
      expect(sql).toMatch(/ALTER FUNCTION public\.get_auth_role\(\) SET search_path = public, pg_temp;/i);
      expect(sql).toMatch(/ALTER FUNCTION public\.get_auth_org_id\(\) SET search_path = public, pg_temp;/i);
      expect(sql).toMatch(/ALTER FUNCTION public\.prevent_audit_tampering\(\) SET search_path = public, pg_temp;/i);
      expect(sql).toMatch(/ALTER FUNCTION public\.is_caller_active\(\) SET search_path = public, pg_temp;/i);
      expect(sql).toMatch(/ALTER FUNCTION public\.can_access_call_recording\(UUID, UUID\) SET search_path = public, pg_temp;/i);
    });

    it('forward migration hardens telecaller_leads_view for student name and chunked academic phone numbers', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      const viewSql = sql.slice(
        sql.indexOf('CREATE OR REPLACE VIEW public.telecaller_leads_view'),
        sql.indexOf('GRANT SELECT ON public.telecaller_leads_view')
      );

      expect(viewSql).toContain("COALESCE(l.name, '')");
      expect(viewSql).toContain("REGEXP_REPLACE(COALESCE(l.name, ''), '[0-9]', '', 'g')");
      expect(viewSql).toContain("'[-_./,()+]+'");
      expect(viewSql).toContain("'[[:space:]]+'");
      expect(viewSql).toMatch(/WHEN sanitized_name\.clean_name = '' THEN 'Student'/i);
      expect(viewSql).toMatch(/SPLIT_PART\(sanitized_name\.clean_name, ' ', 1\)/i);
      expect(viewSql).not.toMatch(/SUBSTRING\(.*FROM POSITION\(/is);
      expect(viewSql).not.toMatch(/^\s*l\.phone\b/im);

      // Academic chunked phone number redaction
      expect(sql).toContain("REGEXP_REPLACE(l.school_or_college, '((?:\\+?\\(?|[0-9])[\\d\\s\\-_./,()]{4,}[0-9])', '[REDACTED]', 'g')");
      expect(sql).toContain("REGEXP_REPLACE(l.course_interest, '((?:\\+?\\(?|[0-9])[\\d\\s\\-_./,()]{4,}[0-9])', '[REDACTED]', 'g')");
    });

    it('forward migration hardens get_telecaller_student_detail RPC with zero phone name and academic redaction', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');

      expect(sql).toMatch(/FUNCTION public\.get_telecaller_student_detail/i);
      expect(sql).toMatch(/SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);
      expect(sql).toContain("REGEXP_REPLACE(target_lead.name, '[0-9\\-_./,()+]', '', 'g')");
    });
  });
});
