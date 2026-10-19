import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile, Lead, FollowUp, getDerivedFollowUpStatus } from '@/types';
import cronReminderHandler from '../../api/cron/follow-up-reminders';
import followUpRemindersAliasHandler from '../../api/followups/reminders';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';

// Mock HTTP Request/Response helper for Serverless API tests
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
}) {
  const req: any = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    url: '/',
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
  };

  return { req, res };
}

describe('ENCRIX Phase 21: Smart Follow-Up Engine & Overdue Escalation', () => {
  const orgAId = 'org-phase21-a';
  const orgBId = 'org-phase21-b';

  const ownerA: Profile = {
    id: 'prof-p21-owner-001',
    user_id: 'user-p21-owner-001',
    organization_id: orgAId,
    full_name: 'Vikram Malhotra',
    email: 'vikram@vertex.com',
    role: 'OWNER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA1: Profile = {
    id: 'prof-p21-tc-001',
    user_id: 'user-p21-tc-001',
    organization_id: orgAId,
    full_name: 'Arjun Sharma',
    email: 'arjun@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA2: Profile = {
    id: 'prof-p21-tc-002',
    user_id: 'user-p21-tc-002',
    organization_id: orgAId,
    full_name: 'Priya Patel',
    email: 'priya@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ownerB: Profile = {
    id: 'prof-p21-owner-002',
    user_id: 'user-p21-owner-002',
    organization_id: orgBId,
    full_name: 'Rohan Gupta',
    email: 'rohan@prime.com',
    role: 'OWNER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerB1: Profile = {
    id: 'prof-p21-tc-003',
    user_id: 'user-p21-tc-003',
    organization_id: orgBId,
    full_name: 'Kavita Singh',
    email: 'kavita@prime.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let testLeadA1: Lead;
  let testLeadA2: Lead;
  let testLeadB1: Lead;

  beforeEach(() => {
    // Clear tenant test data from prior tests for 100% clean isolation
    db.clearTenantTestData(orgAId);
    db.clearTenantTestData(orgBId);

    // Seed test tenants with deterministic profiles and leads
    db.seedTestTenant(
      {
        id: orgAId,
        name: 'Vertex Consultancy',
        slug: 'vertex',
        owner_id: ownerA.id,
        industry: 'Education & Study Abroad',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      [ownerA, telecallerA1, telecallerA2]
    );

    db.seedTestTenant(
      {
        id: orgBId,
        name: 'Prime Telemarketing',
        slug: 'prime',
        owner_id: ownerB.id,
        industry: 'Financial Advisory',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      [ownerB, telecallerB1]
    );

    testLeadA1 = db.createLead(
      {
        name: 'Aakash Verma',
        phone: '+919876543210',
        email: 'aakash@example.com',
        source: 'Website Form',
        status: 'NEW',
        priority: 'HIGH',
      },
      ownerA
    );

    testLeadA2 = db.createLead(
      {
        name: 'Sneha Reddy',
        phone: '+919812345678',
        email: 'sneha@example.com',
        source: 'Meta Ads',
        status: 'NEW',
        priority: 'MEDIUM',
      },
      ownerA
    );

    testLeadB1 = db.createLead(
      {
        name: 'Amitabh Joshi',
        phone: '+919900112233',
        email: 'amitabh@example.com',
        source: 'Google Ads',
        status: 'NEW',
        priority: 'URGENT',
      },
      ownerB
    );

    // Assign testLeadA1 to telecallerA1
    db.assignLeads([testLeadA1.id], telecallerA1.id, ownerA);
    // Assign testLeadA2 to telecallerA2
    db.assignLeads([testLeadA2.id], telecallerA2.id, ownerA);
    // Assign testLeadB1 to telecallerB1
    db.assignLeads([testLeadB1.id], telecallerB1.id, ownerB);
  });

  // ==========================================================================
  // 1. Follow-Up Lifecycle: Create, Complete, Reschedule, Cancel
  // ==========================================================================
  describe('1. Follow-Up Lifecycle & State Transitions', () => {
    it('creates follow-ups with SCHEDULED status, priority, timezone, and reason', () => {
      const scheduledAt = new Date(Date.now() + 2 * 3600000).toISOString();
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: scheduledAt,
          priority: 'HIGH',
          reason: 'Review admission offer details with student and parents',
          timezone: 'Asia/Kolkata',
        },
        telecallerA1
      );

      expect(fup.id).toBeDefined();
      expect(fup.lead_id).toBe(testLeadA1.id);
      expect(fup.assigned_to).toBe(telecallerA1.id);
      expect(fup.priority).toBe('HIGH');
      expect(fup.reason).toBe('Review admission offer details with student and parents');
      expect(fup.timezone).toBe('Asia/Kolkata');
      expect(fup.status).toBe('SCHEDULED');
      expect(fup.reschedule_count).toBe(0);
      expect(fup.reminded_at).toBeNull();
      expect(fup.escalated_at).toBeNull();

      // Lead status transitions to FOLLOW_UP
      const lead = db.getLeadById(testLeadA1.id, ownerA);
      expect(lead.status).toBe('FOLLOW_UP');
    });

    it('marks follow-up completed with mandatory outcome and outcome notes', () => {
      const scheduledAt = new Date(Date.now() + 3600000).toISOString();
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: scheduledAt,
          priority: 'HIGH',
          reason: 'Initial consultation',
        },
        telecallerA1
      );

      const completed = db.completeFollowUp(
        fup.id,
        telecallerA1,
        'Student confirmed enrollment and paid deposit',
        'CONVERTED'
      );

      expect(completed.status).toBe('COMPLETED');
      expect(completed.completed_at).toBeDefined();
      expect(completed.outcome).toBe('CONVERTED');
      expect(completed.outcome_notes).toBe('Student confirmed enrollment and paid deposit');

      // Attempting to cancel an already completed follow-up throws error
      expect(() => {
        db.cancelFollowUp(fup.id, 'No longer needed', telecallerA1);
      }).toThrow(/Cannot cancel an already completed follow-up/i);

      // Attempting to reschedule an already completed follow-up throws error
      expect(() => {
        db.rescheduleFollowUp(
          fup.id,
          new Date(Date.now() + 86400000).toISOString(),
          'Postponing',
          telecallerA1
        );
      }).toThrow(/Cannot reschedule an already completed follow-up/i);
    });

    it('reschedules follow-up with mandatory reason and increments reschedule count', () => {
      const initialDate = new Date(Date.now() + 3600000).toISOString();
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: initialDate,
          priority: 'MEDIUM',
          reason: 'Check exam score',
        },
        telecallerA1
      );

      // Fails if reason is empty
      expect(() => {
        db.rescheduleFollowUp(
          fup.id,
          new Date(Date.now() + 86400000).toISOString(),
          '   ',
          telecallerA1
        );
      }).toThrow(/Reschedule reason is mandatory/i);

      const newDate = new Date(Date.now() + 86400000).toISOString();
      const rescheduled = db.rescheduleFollowUp(
        fup.id,
        newDate,
        'Student is travelling today; requested call tomorrow at 11 AM',
        telecallerA1
      );

      expect(rescheduled.status).toBe('SCHEDULED');
      expect(rescheduled.previous_due_at).toBe(initialDate);
      expect(rescheduled.scheduled_at).toBe(newDate);
      expect(rescheduled.reschedule_reason).toBe(
        'Student is travelling today; requested call tomorrow at 11 AM'
      );
      expect(rescheduled.reschedule_count).toBe(1);
      expect(rescheduled.reminded_at).toBeNull(); // Reset reminder for new scheduled time
    });

    it('cancels follow-up with mandatory cancellation reason', () => {
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'MEDIUM',
          reason: 'Callback',
        },
        telecallerA1
      );

      expect(() => {
        db.cancelFollowUp(fup.id, '', telecallerA1);
      }).toThrow(/Cancellation reason is mandatory/i);

      const cancelled = db.cancelFollowUp(
        fup.id,
        'Customer enrolled in local college, closed file',
        telecallerA1
      );

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.notes).toContain('Cancelled: Customer enrolled in local college, closed file');

      // Cannot complete a cancelled follow-up
      expect(() => {
        db.completeFollowUp(fup.id, telecallerA1);
      }).toThrow(/Cannot complete a cancelled follow-up/i);
    });
  });

  // ==========================================================================
  // 2. Dynamic Due and Overdue Calculations Across Timezones
  // ==========================================================================
  describe('2. Dynamic Due & Overdue Calculation', () => {
    it('dynamically computes SCHEDULED, DUE, and OVERDUE without client timer drift', () => {
      const now = new Date('2026-10-15T10:00:00Z');

      // 1. Scheduled far in future (> 15 minutes)
      const futureFup = {
        status: 'SCHEDULED' as const,
        scheduled_at: '2026-10-15T12:00:00Z',
      };
      expect(getDerivedFollowUpStatus(futureFup, now)).toBe('SCHEDULED');

      // 2. Due soon (<= 15 minutes before scheduled_at)
      const dueSoonFup = {
        status: 'SCHEDULED' as const,
        scheduled_at: '2026-10-15T10:10:00Z',
      };
      expect(getDerivedFollowUpStatus(dueSoonFup, now)).toBe('DUE');

      // 3. Exactly at scheduled time
      const exactDueFup = {
        status: 'SCHEDULED' as const,
        scheduled_at: '2026-10-15T10:00:00Z',
      };
      expect(getDerivedFollowUpStatus(exactDueFup, now)).toBe('DUE');

      // 4. Overdue (now > scheduled_at)
      const overdueFup = {
        status: 'SCHEDULED' as const,
        scheduled_at: '2026-10-15T09:45:00Z',
      };
      expect(getDerivedFollowUpStatus(overdueFup, now)).toBe('OVERDUE');

      // 5. Completed follow-up remains COMPLETED regardless of past due date
      const completedFup = {
        status: 'COMPLETED' as const,
        scheduled_at: '2026-10-15T08:00:00Z',
      };
      expect(getDerivedFollowUpStatus(completedFup, now)).toBe('COMPLETED');
    });

    it('correctly compares UTC timestamps regardless of local timezone', () => {
      // 10:00 UTC is 15:30 IST (+05:30)
      const testNow = new Date('2026-10-15T10:00:00Z');
      const istScheduled = '2026-10-15T09:50:00Z'; // 10 minutes past due in UTC

      const fup = {
        status: 'SCHEDULED' as const,
        scheduled_at: istScheduled,
      };

      expect(getDerivedFollowUpStatus(fup, testNow)).toBe('OVERDUE');
    });
  });

  // ==========================================================================
  // 3. Server-Side Reminder & Cron Idempotency
  // ==========================================================================
  describe('3. Reminder Engine & Idempotent Cron Delivery', () => {
    it('fires in-app notifications for upcoming and overdue follow-ups idempotently', () => {
      const now = new Date('2026-10-15T10:00:00Z');

      // Follow-up 1: Due in 10 minutes (upcoming reminder)
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:10:00Z',
          priority: 'HIGH',
          reason: 'Upcoming call',
        },
        telecallerA1
      );

      // Follow-up 2: 20 minutes past due (overdue escalation)
      db.createFollowUp(
        {
          lead_id: testLeadA2.id,
          scheduled_at: '2026-10-15T09:40:00Z',
          priority: 'URGENT',
          reason: 'Overdue call',
        },
        telecallerA2
      );

      // Run 1: Should deliver reminders
      const run1 = db.processFollowUpReminders(ownerA, now);
      expect(run1.remindedCount).toBe(1);
      expect(run1.overdueCount).toBe(1);

      // Verify Telecaller A1 received FOLLOW_UP_DUE notification
      const notifsA1 = db.getNotifications(telecallerA1);
      expect(notifsA1.some((n) => n.type === 'FOLLOW_UP_DUE')).toBe(true);

      // Verify Telecaller A2 received FOLLOW_UP_OVERDUE notification
      const notifsA2 = db.getNotifications(telecallerA2);
      expect(notifsA2.some((n) => n.type === 'FOLLOW_UP_OVERDUE')).toBe(true);

      // Run 2 (Immediately after): Idempotency check — ZERO duplicate notifications
      const run2 = db.processFollowUpReminders(ownerA, now);
      expect(run2.remindedCount).toBe(0);
      expect(run2.overdueCount).toBe(0);

      const notifsA1After = db.getNotifications(telecallerA1);
      expect(notifsA1After.filter((n) => n.type === 'FOLLOW_UP_DUE')).toHaveLength(1);
    });

    it('notifies organization owner when follow-up is severely overdue (>= 30 mins)', () => {
      const now = new Date('2026-10-15T11:00:00Z');

      // Follow-up scheduled 45 minutes ago (severely overdue)
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:15:00Z',
          priority: 'URGENT',
          reason: 'Severe overdue test',
        },
        telecallerA1
      );

      db.processFollowUpReminders(ownerA, now);

      // Verify Owner received overdue alert
      const ownerNotifs = db.getNotifications(ownerA);
      expect(ownerNotifs.some((n) => n.type === 'FOLLOW_UP_OVERDUE')).toBe(true);
      expect(ownerNotifs[0].title).toBe('Overdue Lead Callback');
    });

    it('ensures telecaller overdue alert at minute 5 does not suppress owner overdue alert at minute 30', () => {
      // Follow-up scheduled for 10:00
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:00:00Z',
          priority: 'URGENT',
          reason: 'Non-suppression verification',
        },
        telecallerA1
      );

      // Time passes to 10:05 (5 minutes overdue)
      const t1 = new Date('2026-10-15T10:05:00Z');
      const run1 = db.processFollowUpReminders(ownerA, t1);
      expect(run1.overdueCount).toBe(1);

      // Telecaller received overdue notification
      const tcNotifs1 = db.getNotifications(telecallerA1);
      expect(tcNotifs1.some((n) => n.type === 'FOLLOW_UP_OVERDUE')).toBe(true);

      // Owner has NOT received alert yet (since it is only 5 mins overdue, threshold is 30 mins)
      const ownerNotifs1 = db.getNotifications(ownerA);
      expect(ownerNotifs1.some((n) => n.type === 'FOLLOW_UP_OVERDUE')).toBe(false);

      // Now time advances to 10:35 (35 minutes overdue)
      const t2 = new Date('2026-10-15T10:35:00Z');
      db.processFollowUpReminders(ownerA, t2);

      // Owner receives the 30-minute overdue alert!
      const ownerNotifs2 = db.getNotifications(ownerA);
      expect(ownerNotifs2.some((n) => n.type === 'FOLLOW_UP_OVERDUE')).toBe(true);

      // Telecaller did NOT receive a duplicate overdue alert
      const tcNotifs2 = db.getNotifications(telecallerA1);
      expect(tcNotifs2.filter((n) => n.type === 'FOLLOW_UP_OVERDUE')).toHaveLength(1);
    });

    it('handles simultaneous cron invocations with zero duplicate notifications', async () => {
      process.env.CRON_SECRET = 'cron-concurrency-test-secret';
      const now = '2026-10-15T10:00:00.000Z';

      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:05:00.000Z',
          priority: 'HIGH',
          reason: 'Concurrency test',
        },
        telecallerA1
      );

      const makeReq = () => {
        const { req, res } = createMockReqRes({
          method: 'POST',
          headers: {
            authorization: 'Bearer cron-concurrency-test-secret',
          },
          body: {
            referenceTime: now,
          },
        });
        return cronReminderHandler(req, res).then(() => res);
      };

      // Run two invocations concurrently
      const [res1, res2] = await Promise.all([makeReq(), makeReq()]);
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);

      // Total delivered reminder notifications is exactly 1 (zero duplicates)
      const notifs = db.getNotifications(telecallerA1);
      const reminderNotifs = notifs.filter((n) => n.type === 'FOLLOW_UP_DUE');
      expect(reminderNotifs).toHaveLength(1);
    });

    it('rescheduling callback prevents old due time from triggering reminders and triggers at new time', () => {
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:15:00Z',
          priority: 'MEDIUM',
          reason: 'Initial schedule',
        },
        telecallerA1
      );

      // Reschedule to 12:00
      db.rescheduleFollowUp(fup.id, '2026-10-15T12:00:00Z', 'Client requested afternoon', telecallerA1);

      // Advance time to 10:10 (5 mins before old time, but 1h50m before new time)
      const tOld = new Date('2026-10-15T10:10:00Z');
      const runOld = db.processFollowUpReminders(ownerA, tOld);
      expect(runOld.remindedCount).toBe(0);
      expect(db.getNotifications(telecallerA1).filter((n) => n.type === 'FOLLOW_UP_DUE')).toHaveLength(0);

      // Advance time to 11:50 (10 mins before new time)
      const tNew = new Date('2026-10-15T11:50:00Z');
      const runNew = db.processFollowUpReminders(ownerA, tNew);
      expect(runNew.remindedCount).toBe(1);
      expect(db.getNotifications(telecallerA1).filter((n) => n.type === 'FOLLOW_UP_DUE')).toHaveLength(1);
    });

    it('completed or cancelled callbacks never trigger upcoming or overdue reminders', () => {
      const fupCompleted = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:15:00Z',
          priority: 'HIGH',
        },
        telecallerA1
      );
      db.completeFollowUp(fupCompleted.id, telecallerA1, 'Done', 'POSITIVE');

      const fupCancelled = db.createFollowUp(
        {
          lead_id: testLeadA2.id,
          scheduled_at: '2026-10-15T10:15:00Z',
          priority: 'MEDIUM',
        },
        telecallerA2
      );
      db.cancelFollowUp(fupCancelled.id, 'Not needed', telecallerA2);

      // Advance time to overdue state (11:00)
      const overdueTime = new Date('2026-10-15T11:00:00Z');
      const result = db.processFollowUpReminders(ownerA, overdueTime);
      expect(result.remindedCount).toBe(0);
      expect(result.overdueCount).toBe(0);
    });
  });

  // ==========================================================================
  // 4. Serverless Scheduled Job API Endpoint Authorization
  // ==========================================================================
  describe('4. Serverless Cron Endpoint Authorization & Execution', () => {
    it('rejects requests missing or using an invalid CRON_SECRET or session token', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: 'Bearer forged-secret-12345',
        },
      });

      await cronReminderHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized/i);
    });

    it('authorizes requests with the valid CRON_SECRET and executes reminders', async () => {
      process.env.CRON_SECRET = 'encrix-secret-test-token-789';

      const now = '2026-10-15T10:00:00.000Z';
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:05:00.000Z',
          priority: 'HIGH',
          reason: 'API cron reminder test',
        },
        telecallerA1
      );

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: 'Bearer encrix-secret-test-token-789',
        },
        body: {
          referenceTime: now,
        },
      });

      await cronReminderHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.remindedCount).toBeGreaterThanOrEqual(1);
    });

    it('authorizes endpoint via /api/followups/reminders alias with Owner signed session', async () => {
      const sessionToken = createSignedSessionToken({
        profileId: ownerA.id,
        userId: ownerA.user_id,
        organizationId: ownerA.organization_id,
        role: 'OWNER',
        email: ownerA.email || 'vikram@vertex.com',
        fullName: ownerA.full_name,
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
        query: {
          referenceTime: '2026-10-15T10:00:00.000Z',
        },
      });

      await followUpRemindersAliasHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('prevents an authenticated Owner from processing follow-ups of another tenant', async () => {
      const sessionToken = createSignedSessionToken({
        profileId: ownerA.id,
        userId: ownerA.user_id,
        organizationId: ownerA.organization_id,
        role: 'OWNER',
        email: ownerA.email || 'vikram@vertex.com',
        fullName: ownerA.full_name,
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
        body: {
          referenceTime: '2026-10-15T10:00:00.000Z',
          organizationId: orgBId, // Cross-tenant attempt!
        },
      });

      await cronReminderHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Cannot process follow-up reminders for another organization/i);
    });
  });

  // ==========================================================================
  // 5. Security, RBAC, and Tenant Isolation
  // ==========================================================================
  describe('5. Security, RBAC & Tenant Isolation', () => {
    it('prevents telecallers from scheduling follow-ups on unassigned leads', () => {
      expect(() => {
        db.createFollowUp(
          {
            lead_id: testLeadA2.id, // Assigned to telecallerA2, not A1
            scheduled_at: new Date(Date.now() + 3600000).toISOString(),
            priority: 'HIGH',
          },
          telecallerA1
        );
      }).toThrow(/Cannot schedule follow-ups on leads not assigned to you/i);

      // Verify security event logged
      const secEvents = db.getSecurityEvents(ownerA);
      expect(secEvents.some((e) => e.event_type === 'UNAUTHORIZED_FOLLOWUP_ATTEMPT')).toBe(true);
    });

    it('prevents telecallers from rescheduling or completing peer telecaller follow-ups', () => {
      const fupA2 = db.createFollowUp(
        {
          lead_id: testLeadA2.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'MEDIUM',
        },
        telecallerA2
      );

      // Telecaller A1 attempts to reschedule A2's follow-up
      expect(() => {
        db.rescheduleFollowUp(
          fupA2.id,
          new Date(Date.now() + 86400000).toISOString(),
          'Sneaky reschedule',
          telecallerA1
        );
      }).toThrow(/Cannot reschedule another telecaller's follow-up/i);

      // Telecaller A1 attempts to complete A2's follow-up
      expect(() => {
        db.completeFollowUp(fupA2.id, telecallerA1);
      }).toThrow(/Cannot complete another telecaller's follow-up/i);

      // Telecaller A1 attempts to cancel A2's follow-up
      expect(() => {
        db.cancelFollowUp(fupA2.id, 'Sneaky cancel', telecallerA1);
      }).toThrow(/Cannot cancel another telecaller's follow-up/i);
    });

    it('strictly forbids cross-tenant access and modification', () => {
      const fupOrgB = db.createFollowUp(
        {
          lead_id: testLeadB1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'HIGH',
        },
        telecallerB1
      );

      // Owner A attempts to complete follow-up of Org B
      expect(() => {
        db.completeFollowUp(fupOrgB.id, ownerA);
      }).toThrow(/Follow-up belongs to another organization/i);

      // Owner A only sees Org A follow-ups
      const ownerAFollowUps = db.getFollowUps(ownerA);
      expect(ownerAFollowUps.some((f) => f.id === fupOrgB.id)).toBe(false);
    });

    it('telecallers are forbidden from escalating or reassigning follow-ups', () => {
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'HIGH',
        },
        telecallerA1
      );

      expect(() => {
        db.escalateFollowUp(fup.id, telecallerA2.id, 'Taking too long', telecallerA1);
      }).toThrow(/Telecallers are not authorized to escalate or reassign/i);
    });
  });

  // ==========================================================================
  // 6. Overdue Escalation & Lead Reassignment Cascade
  // ==========================================================================
  describe('6. Overdue Escalation & Lead Reassignment Cascade', () => {
    it('allows owner to escalate overdue follow-up with mandatory reason', () => {
      const overdueTime = new Date(Date.now() - 3600000).toISOString();
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: overdueTime,
          priority: 'URGENT',
          reason: 'Critical high-intent admission',
        },
        telecallerA1
      );

      expect(() => {
        db.escalateFollowUp(fup.id, telecallerA2.id, '', ownerA);
      }).toThrow(/Escalation reason is mandatory/i);

      const escalated = db.escalateFollowUp(
        fup.id,
        telecallerA2.id,
        'Agent A1 on emergency leave; escalating to Senior Agent A2',
        ownerA
      );

      expect(escalated.assigned_to).toBe(telecallerA2.id);
      expect(escalated.escalated_at).toBeDefined();
      expect(escalated.escalated_by).toBe(ownerA.id);
      expect(escalated.escalation_reason).toBe(
        'Agent A1 on emergency leave; escalating to Senior Agent A2'
      );

      // Verifies notification was dispatched to newly assigned telecaller
      const notifsA2 = db.getNotifications(telecallerA2);
      expect(notifsA2.some((n) => n.type === 'FOLLOW_UP_ESCALATED')).toBe(true);

      // Lead assignment also updated
      const lead = db.getLeadById(testLeadA1.id, ownerA);
      expect(lead.assigned_to).toBe(telecallerA2.id);
    });

    it('cascades lead reassignment to all active follow-ups for that lead', () => {
      const fup = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'MEDIUM',
          reason: 'Initial intake callback',
        },
        telecallerA1
      );

      expect(fup.assigned_to).toBe(telecallerA1.id);

      // Owner reassigns lead from telecallerA1 to telecallerA2
      db.reassignLead(
        testLeadA1.id,
        telecallerA2.id,
        'Shift handover from Arjun to Priya',
        ownerA
      );

      // Verify active follow-up was automatically cascaded to telecallerA2
      const allFollowUps = db.getFollowUps(ownerA);
      const updatedFup = allFollowUps.find((f) => f.id === fup.id);
      expect(updatedFup?.assigned_to).toBe(telecallerA2.id);

      // Telecaller A2 now sees it in their workspace
      const a2FollowUps = db.getFollowUps(telecallerA2);
      expect(a2FollowUps.some((f) => f.id === fup.id)).toBe(true);
    });
  });

  // ==========================================================================
  // 7. Duplicate Prevention & Superseding Next Action
  // ==========================================================================
  describe('7. Duplicate Prevention & Active Follow-Up Superseding', () => {
    it('supersedes previous active follow-up when new next action is scheduled for the lead', () => {
      const fup1 = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'MEDIUM',
          reason: 'Callback 1',
        },
        telecallerA1
      );

      expect(fup1.status).toBe('SCHEDULED');

      // Scheduling a second follow-up on the same lead supersedes fup1
      const fup2 = db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 7200000).toISOString(),
          priority: 'HIGH',
          reason: 'Callback 2',
        },
        telecallerA1
      );

      const all = db.getFollowUps(ownerA);
      const oldFup = all.find((f) => f.id === fup1.id);
      expect(oldFup?.status).toBe('RESCHEDULED');
      expect(oldFup?.reschedule_reason).toBe('Superseded by new scheduled follow-up');

      expect(fup2.status).toBe('SCHEDULED');
    });
  });

  // ==========================================================================
  // 8. Zero Phone Exposure Invariant in Follow-Up Views & Reminders
  // ==========================================================================
  describe('8. Zero Phone Exposure Invariant (Phase 18 Preservation)', () => {
    it('strictly masks phone numbers when telecallers query follow-ups', () => {
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
          priority: 'HIGH',
        },
        telecallerA1
      );

      const telecallerFollowUps = db.getFollowUps(telecallerA1);
      expect(telecallerFollowUps.length).toBeGreaterThan(0);

      for (const fup of telecallerFollowUps) {
        // Zero Phone Exposure: Neither raw nor masked phone numbers are serialized for telecallers
        expect(fup.lead_phone).toBeUndefined();
      }

      const ownerFollowUps = db.getFollowUps(ownerA);
      for (const fup of ownerFollowUps) {
        expect(fup.lead_phone).not.toBe('+919876543210');
        expect(fup.lead_phone).toMatch(/\*\*\*/);
      }
    });

    it('never leaks raw phone numbers in reminder notification payloads or messages', () => {
      const now = new Date('2026-10-15T10:00:00Z');
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: '2026-10-15T10:05:00Z',
          priority: 'HIGH',
          reason: 'Follow-up consultation',
        },
        telecallerA1
      );

      db.processFollowUpReminders(ownerA, now);

      const notifications = db.getNotifications(telecallerA1);
      for (const notif of notifications) {
        expect(notif.message).not.toContain('+919876543210');
        expect(notif.title).not.toContain('+919876543210');
      }
    });
  });

  // ==========================================================================
  // 9. Notification Center Persistence & Realtime Read State
  // ==========================================================================
  describe('9. Notification Center & Read State Persistence', () => {
    it('marks individual and all notifications as read', () => {
      // Clear baseline
      db.markAllNotificationsRead(telecallerA1);

      db.createNotification({
        organization_id: orgAId,
        user_id: telecallerA1.id,
        type: 'FOLLOW_UP_DUE',
        title: 'Upcoming Callback',
        message: 'Lead LV-1001 callback scheduled soon',
      });

      db.createNotification({
        organization_id: orgAId,
        user_id: telecallerA1.id,
        type: 'FOLLOW_UP_OVERDUE',
        title: 'Overdue Callback',
        message: 'Lead LV-1002 callback is overdue',
      });

      let notifs = db.getNotifications(telecallerA1);
      expect(notifs.filter((n) => !n.read)).toHaveLength(2);

      // Mark individual as read
      db.markNotificationRead(notifs[0].id);
      notifs = db.getNotifications(telecallerA1);
      expect(notifs.filter((n) => !n.read)).toHaveLength(1);

      // Mark all as read
      db.markAllNotificationsRead(telecallerA1);
      notifs = db.getNotifications(telecallerA1);
      expect(notifs.filter((n) => !n.read)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 10. Owner Follow-Up Overview Metrics & Telecaller Breakdown
  // ==========================================================================
  describe('10. Owner Metrics & Leads Without Next Action', () => {
    it('provides accurate overview metrics and telecaller breakdown', () => {
      // Create one due today (1 minute in future, so status is dynamically DUE)
      db.createFollowUp(
        {
          lead_id: testLeadA1.id,
          scheduled_at: new Date(Date.now() + 60000).toISOString(),
          priority: 'HIGH',
        },
        telecallerA1
      );

      const metrics = db.getFollowUpOverviewMetrics(ownerA);
      expect(metrics.dueToday).toBeGreaterThanOrEqual(1);
      expect(metrics.telecallerBreakdown.length).toBe(2);

      const tc1Metrics = metrics.telecallerBreakdown.find((t) => t.telecaller_id === telecallerA1.id);
      expect(tc1Metrics).toBeDefined();
      expect(tc1Metrics?.scheduled).toBeGreaterThanOrEqual(1);

      // Leads without next action queue should contain testLeadA2 since it has no follow-up
      const withoutAction = db.getLeadsWithoutNextAction(ownerA);
      expect(withoutAction.some((l) => l.id === testLeadA2.id)).toBe(true);
      expect(withoutAction.some((l) => l.id === testLeadA1.id)).toBe(false);
    });
  });
});
