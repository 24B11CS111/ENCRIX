import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import cronHandler from '../../api/cron/follow-up-reminders';
import {
  processFollowUpReminders,
  timingSafeCompare,
  getValidatedCronSecret,
  evaluateEmailReminderStatus,
} from '../../api/_lib/reminderProcessor';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { Profile } from '@/types';

// Helper to create mock Request and Response for serverless API handlers
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
  supabaseClient?: any;
}) {
  const req: any = {
    method: options.method || 'POST',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    url: '/api/cron/follow-up-reminders',
    supabaseClient: options.supabaseClient,
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

// In-Memory Database Harness for Mock Supabase Client
interface MockDatabaseState {
  followUps: any[];
  leads: any[];
  profiles: any[];
  notifications: any[];
  activityLogs: any[];
  securityEvents: any[];
}

function getTableData(state: MockDatabaseState, table: string): any[] {
  switch (table) {
    case 'follow_ups':
      return state.followUps;
    case 'leads':
      return state.leads;
    case 'profiles':
      return state.profiles;
    case 'notifications':
      return state.notifications;
    case 'activity_logs':
      return state.activityLogs;
    case 'security_events':
      return state.securityEvents;
    default:
      return [];
  }
}

function createMockSupabaseClient(state: MockDatabaseState, options?: { failNotificationInsert?: boolean; enableRpc?: boolean }) {
  return {
    rpc: async (fnName: string, params: any) => {
      if (options?.enableRpc && fnName === 'process_follow_up_reminders_cron') {
        return {
          data: {
            success: true,
            reminded_count: 1,
            overdue_count: 0,
            escalated_count: 0,
          },
          error: null,
        };
      }
      return {
        data: null,
        error: { code: '42883', message: 'function process_follow_up_reminders_cron does not exist' },
      };
    },
    from: (table: string) => {
      return {
        select: (fields?: string) => {
          const conditions: Array<{ type: 'eq' | 'in'; col: string; val: any }> = [];
          const execute = () => {
            let list = getTableData(state, table);
            for (const cond of conditions) {
              if (cond.type === 'eq') {
                list = list.filter((item: any) => item[cond.col] === cond.val);
              } else if (cond.type === 'in') {
                list = list.filter((item: any) => cond.val.includes(item[cond.col]));
              }
            }
            return list.map((x) => ({ ...x }));
          };

          const builder: any = {
            eq: (col: string, val: any) => {
              conditions.push({ type: 'eq', col, val });
              return builder;
            },
            in: (col: string, vals: any[]) => {
              conditions.push({ type: 'in', col, val: vals });
              return builder;
            },
            single: async () => {
              const rows = execute();
              if (rows.length === 0) {
                return { data: null, error: { message: 'Row not found' } };
              }
              return { data: rows[0], error: null };
            },
            then: (resolve: any, reject?: any) => {
              return Promise.resolve({ data: execute(), error: null }).then(resolve, reject);
            },
          };

          return builder;
        },
        update: (patch: any) => {
          const conditions: Array<{ type: 'eq' | 'is'; col: string; val: any }> = [];
          const execute = () => {
            const list = getTableData(state, table);
            const matched = list.filter((item: any) => {
              return conditions.every((cond) => {
                if (cond.type === 'is') {
                  return cond.val === null
                    ? item[cond.col] === null || item[cond.col] === undefined
                    : item[cond.col] === cond.val;
                }
                return item[cond.col] === cond.val;
              });
            });
            for (const item of matched) {
              Object.assign(item, patch);
            }
            return { data: matched.map((x) => ({ ...x })), error: null };
          };

          const builder: any = {
            eq: (col: string, val: any) => {
              conditions.push({ type: 'eq', col, val });
              return builder;
            },
            is: (col: string, val: any) => {
              conditions.push({ type: 'is', col, val });
              return builder;
            },
            select: async (fields?: string) => {
              return execute();
            },
            then: (resolve: any, reject?: any) => {
              return Promise.resolve(execute()).then(resolve, reject);
            },
          };

          return builder;
        },
        insert: async (records: any) => {
          if (table === 'notifications' && options?.failNotificationInsert) {
            throw new Error('Simulated database network failure on notifications insert');
          }
          const recs = Array.isArray(records) ? records : [records];
          const list = getTableData(state, table);
          for (const rec of recs) {
            const id = `${table.slice(0, 3)}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            list.push({ ...rec, id: rec.id || id });
          }
          return { error: null };
        },
      };
    },
  };
}

describe('ENCRIX Phase 23.3: Production-Safe Follow-Up Cron Remediation', () => {
  const originalEnv = { ...process.env };
  const validCronSecret = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0'; // 40 chars high entropy

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CRON_SECRET = validCronSecret;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ==========================================================================
  // SUITE 1: STRICT CRON AUTHENTICATION & PRODUCTION STARTUP CHECKS
  // ==========================================================================
  describe('1. Strict Cron Authentication & Production Preflight', () => {
    it('rejects requests missing an Authorization header with 401', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {},
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Missing Authorization header/i);
    });

    it('rejects forged or incorrect cron secrets with 401', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: 'Bearer forged-cron-secret-token',
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Unauthorized: Missing or invalid CRON_SECRET/i);
    });

    it('fails closed in production mode when CRON_SECRET is missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CRON_SECRET;

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: `Bearer ${validCronSecret}`,
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/CRON_SECRET is required in production/i);
    });

    it('fails closed in production mode when CRON_SECRET is weak (< 32 chars) or a placeholder', () => {
      process.env.NODE_ENV = 'production';
      process.env.CRON_SECRET = 'short-secret';
      expect(() => getValidatedCronSecret()).toThrow(/insecure or placeholder/i);

      process.env.CRON_SECRET = 'your-cron-secret-placeholder-value-32chars';
      expect(() => getValidatedCronSecret()).toThrow(/insecure or placeholder/i);
    });

    it('fails closed in production mode when Supabase database configuration is missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_KEY;

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: `Bearer ${validCronSecret}`,
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toMatch(/Supabase database connection is required in production/i);
    });

    it('strictly REJECTS caller-supplied organizationId for automated scheduled cron requests', async () => {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: `Bearer ${validCronSecret}`,
        },
        body: {
          organizationId: 'org-tenant-malicious-scope',
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/does not accept caller-supplied organization scope/i);
    });

    it('timingSafeCompare executes constant-time comparisons without timing leak', () => {
      expect(timingSafeCompare('valid-secret-1234', 'valid-secret-1234')).toBe(true);
      expect(timingSafeCompare('valid-secret-1234', 'invalid-secret-99')).toBe(false);
      expect(timingSafeCompare('', 'valid-secret-1234')).toBe(false);
      expect(timingSafeCompare('valid-secret-1234', '')).toBe(false);
    });

    it('authorizes authenticated Owner session token scoped strictly to their organization', async () => {
      const ownerProfile: Profile = {
        id: 'prof-owner-alpha',
        user_id: 'user-owner-alpha',
        organization_id: 'org-alpha',
        full_name: 'Aditya Birla',
        email: 'aditya@alpha.com',
        role: 'OWNER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const ownerToken = createSignedSessionToken({
        profileId: ownerProfile.id,
        userId: ownerProfile.user_id,
        organizationId: ownerProfile.organization_id,
        role: ownerProfile.role,
        fullName: ownerProfile.full_name,
        email: ownerProfile.email || '',
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('blocks an Owner session token from processing follow-ups of another tenant', async () => {
      const ownerToken = createSignedSessionToken({
        profileId: 'prof-owner-alpha',
        userId: 'user-owner-alpha',
        organizationId: 'org-alpha',
        role: 'OWNER',
        fullName: 'Aditya Birla',
        email: 'aditya@alpha.com',
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
        body: {
          organizationId: 'org-beta', // Unauthorized cross-tenant attempt
        },
      });

      await cronHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Cannot process follow-up reminders for another organization/i);
    });
  });

  // ==========================================================================
  // SUITE 2: MULTI-TENANT ISOLATION & CROSS-TENANT DEFENSE
  // ==========================================================================
  describe('2. Multi-Tenant Isolation & Cross-Tenant Defense', () => {
    it('processes two independent organizations concurrently without cross-contamination', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-org1',
            organization_id: 'org-1',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:05:00.000Z', // 5m ahead -> upcoming
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
          {
            id: 'fup-org2',
            organization_id: 'org-2',
            lead_id: 'lead-2',
            assigned_to: 'tc-2',
            scheduled_at: '2026-10-19T10:08:00.000Z', // 8m ahead -> upcoming
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [
          { id: 'lead-1', organization_id: 'org-1', lead_code: 'LV-ORG1-01', status: 'NEW' },
          { id: 'lead-2', organization_id: 'org-2', lead_code: 'LV-ORG2-02', status: 'NEW' },
        ],
        profiles: [
          { id: 'tc-1', organization_id: 'org-1', full_name: 'Arjun Org1', role: 'TELECALLER', status: 'ACTIVE' },
          { id: 'tc-2', organization_id: 'org-2', full_name: 'Priya Org2', role: 'TELECALLER', status: 'ACTIVE' },
        ],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({
        referenceTime: refTime,
        supabaseClient: mockSupabase,
      });

      expect(result.success).toBe(true);
      expect(result.remindedCount).toBe(2);

      // Verify each notification received the exact tenant organization_id
      const notif1 = state.notifications.find((n) => n.user_id === 'tc-1');
      const notif2 = state.notifications.find((n) => n.user_id === 'tc-2');
      expect(notif1.organization_id).toBe('org-1');
      expect(notif2.organization_id).toBe('org-2');
    });

    it('detects cross-organization lead mismatch, skips reminder, and logs security event', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-mismatch',
            organization_id: 'org-victim',
            lead_id: 'lead-rogue',
            assigned_to: 'tc-victim',
            scheduled_at: '2026-10-19T10:05:00.000Z',
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [
          { id: 'lead-rogue', organization_id: 'org-attacker', lead_code: 'ROGUE-01', status: 'NEW' },
        ],
        profiles: [
          { id: 'tc-victim', organization_id: 'org-victim', full_name: 'Victim Telecaller', role: 'TELECALLER', status: 'ACTIVE' },
        ],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({
        referenceTime: refTime,
        supabaseClient: mockSupabase,
      });

      expect(result.remindedCount).toBe(0);
      expect(state.notifications).toHaveLength(0);

      // Security event logged
      const mismatchEvent = state.securityEvents.find((e) => e.event_type === 'CROSS_TENANT_FOLLOWUP_MISMATCH');
      expect(mismatchEvent).toBeDefined();
      expect(mismatchEvent.organization_id).toBe('org-victim');
    });

    it('detects cross-organization assigned profile mismatch, skips telecaller notification, and logs event', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-mismatch-profile',
            organization_id: 'org-victim',
            lead_id: 'lead-valid',
            assigned_to: 'tc-other-org',
            scheduled_at: '2026-10-19T10:05:00.000Z',
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [
          { id: 'lead-valid', organization_id: 'org-victim', lead_code: 'VALID-01', status: 'NEW' },
        ],
        profiles: [
          { id: 'tc-other-org', organization_id: 'org-different', full_name: 'Alien Telecaller', role: 'TELECALLER', status: 'ACTIVE' },
        ],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({
        referenceTime: refTime,
        supabaseClient: mockSupabase,
      });

      expect(result.remindedCount).toBe(0);
      expect(state.notifications).toHaveLength(0);

      const secEvent = state.securityEvents.find((e) => e.event_type === 'CROSS_TENANT_PROFILE_MISMATCH');
      expect(secEvent).toBeDefined();
    });
  });

  // ==========================================================================
  // SUITE 3: REMINDER RULES, MILESTONES & EXCLUSIONS
  // ==========================================================================
  describe('3. Reminder Timing Rules & Status Exclusions', () => {
    it('dispatches upcoming reminder within the 15-minute window', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-upcoming-10m',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:10:00.000Z', // 10 mins ahead
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
          {
            id: 'fup-upcoming-25m',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:25:00.000Z', // 25 mins ahead (outside 15m)
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-TEST-01', status: 'NEW' }],
        profiles: [{ id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun', role: 'TELECALLER', status: 'ACTIVE' }],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase });

      expect(result.remindedCount).toBe(1);
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0].type).toBe('FOLLOW_UP_DUE');

      // 10m follow-up stamped
      const f10 = state.followUps.find((f) => f.id === 'fup-upcoming-10m');
      expect(f10.reminded_at).toBe('2026-10-19T10:00:00.000Z');

      // 25m follow-up untouched
      const f25 = state.followUps.find((f) => f.id === 'fup-upcoming-25m');
      expect(f25.reminded_at).toBeNull();
    });

    it('dispatches telecaller overdue alert when scheduled_at is past', async () => {
      const refTime = new Date('2026-10-19T10:10:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-overdue-5m',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:05:00.000Z', // 5 mins in the past
            status: 'SCHEDULED',
            reminded_at: '2026-10-19T09:55:00.000Z',
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-TEST-01', status: 'NEW' }],
        profiles: [{ id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun', role: 'TELECALLER', status: 'ACTIVE' }],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase });

      expect(result.overdueCount).toBe(1);
      expect(state.notifications[0].type).toBe('FOLLOW_UP_OVERDUE');
      expect(state.notifications[0].title).toBe('Follow-Up Overdue');
    });

    it('escalates to active Owner when follow-up is >= 30 minutes overdue without suppressing telecaller alert', async () => {
      const refTime = new Date('2026-10-19T10:45:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-severe-overdue',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:00:00.000Z', // 45 mins overdue!
            status: 'SCHEDULED',
            reminded_at: '2026-10-19T09:50:00.000Z',
            overdue_notified_at: null, // neither telecaller nor owner has received alert yet
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-TEST-01', status: 'NEW' }],
        profiles: [
          { id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun TC', role: 'TELECALLER', status: 'ACTIVE' },
          { id: 'owner-1', organization_id: 'org-test', full_name: 'Vikram Owner', role: 'OWNER', status: 'ACTIVE' },
        ],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase });

      // Both telecaller overdue AND owner escalation are delivered!
      expect(result.overdueCount).toBe(1);
      expect(result.escalatedCount).toBe(1);

      const tcNotif = state.notifications.find((n) => n.user_id === 'tc-1');
      const ownerNotif = state.notifications.find((n) => n.user_id === 'owner-1');
      expect(tcNotif).toBeDefined();
      expect(tcNotif.title).toBe('Follow-Up Overdue');
      expect(ownerNotif).toBeDefined();
      expect(ownerNotif.title).toBe('Overdue Lead Callback');
    });

    it('never triggers reminders for COMPLETED or CANCELLED follow-ups', async () => {
      const refTime = new Date('2026-10-19T11:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-done',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:00:00.000Z',
            status: 'COMPLETED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
          {
            id: 'fup-void',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:00:00.000Z',
            status: 'CANCELLED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-TEST-01', status: 'NEW' }],
        profiles: [{ id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun', role: 'TELECALLER', status: 'ACTIVE' }],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      const result = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase });

      expect(result.remindedCount).toBe(0);
      expect(result.overdueCount).toBe(0);
      expect(result.escalatedCount).toBe(0);
      expect(state.notifications).toHaveLength(0);
    });
  });

  // ==========================================================================
  // SUITE 4: ATOMIC CONCURRENCY & SAFE RETRY
  // ==========================================================================
  describe('4. Atomic Concurrency Control & Safe Retry', () => {
    it('prevents duplicate notifications when two cron invocations run simultaneously', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-concurrent-target',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:05:00.000Z',
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-CONCURRENCY-01', status: 'NEW' }],
        profiles: [{ id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun', role: 'TELECALLER', status: 'ACTIVE' }],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);

      // Run two concurrent promises representing concurrent cron runs
      const [res1, res2] = await Promise.all([
        processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase }),
        processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      // Combined delivered reminders is exactly 1 (one claimed, second received 0 rows to claim)
      expect(res1.remindedCount + res2.remindedCount).toBe(1);
      expect(state.notifications).toHaveLength(1);
    });

    it('rolls back atomic claim when notification insertion fails, ensuring safe retry on next run', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-retry-target',
            organization_id: 'org-test',
            lead_id: 'lead-1',
            assigned_to: 'tc-1',
            scheduled_at: '2026-10-19T10:05:00.000Z',
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [{ id: 'lead-1', organization_id: 'org-test', lead_code: 'LV-RETRY-01', status: 'NEW' }],
        profiles: [{ id: 'tc-1', organization_id: 'org-test', full_name: 'Arjun', role: 'TELECALLER', status: 'ACTIVE' }],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      // Create client configured to fail notification insertion
      const failingClient = createMockSupabaseClient(state, { failNotificationInsert: true });
      const failResult = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: failingClient });

      expect(failResult.remindedCount).toBe(0);
      expect(failResult.errors).toBeDefined();

      // Crucial Safety Assertion: reminded_at was rolled back to null
      const fup = state.followUps.find((f) => f.id === 'fup-retry-target');
      expect(fup.reminded_at).toBeNull();

      // Second run with normal client succeeds cleanly!
      const normalClient = createMockSupabaseClient(state, { failNotificationInsert: false });
      const successResult = await processFollowUpReminders({ referenceTime: refTime, supabaseClient: normalClient });

      expect(successResult.remindedCount).toBe(1);
      expect(state.notifications).toHaveLength(1);
      expect(fup.reminded_at).toBe('2026-10-19T10:00:00.000Z');
    });
  });

  // ==========================================================================
  // SUITE 5: DATA PRIVACY & TRUTHFUL EMAIL STATUS
  // ==========================================================================
  describe('5. Data Privacy & Truthful Email Reporting', () => {
    it('notification messages and activity logs contain zero raw phone numbers or masked digits', async () => {
      const refTime = new Date('2026-10-19T10:00:00.000Z');
      const state: MockDatabaseState = {
        followUps: [
          {
            id: 'fup-privacy-check',
            organization_id: 'org-privacy',
            lead_id: 'lead-privacy',
            assigned_to: 'tc-privacy',
            scheduled_at: '2026-10-19T10:05:00.000Z',
            status: 'SCHEDULED',
            reminded_at: null,
            overdue_notified_at: null,
            owner_alerted_at: null,
          },
        ],
        leads: [
          {
            id: 'lead-privacy',
            organization_id: 'org-privacy',
            lead_code: 'LV-PRIVACY-01',
            name: 'Rahul Verma',
            status: 'NEW',
          },
        ],
        profiles: [
          { id: 'tc-privacy', organization_id: 'org-privacy', full_name: 'Priya', role: 'TELECALLER', status: 'ACTIVE' },
        ],
        notifications: [],
        activityLogs: [],
        securityEvents: [],
      };

      const mockSupabase = createMockSupabaseClient(state);
      await processFollowUpReminders({ referenceTime: refTime, supabaseClient: mockSupabase });

      const notifText = state.notifications[0].message;
      const logMetadata = JSON.stringify(state.activityLogs[0].metadata);

      // Verify no phone patterns exist
      expect(notifText).not.toMatch(/\+?[0-9]{7,}/);
      expect(notifText).not.toMatch(/••••/);
      expect(logMetadata).not.toMatch(/\+?[0-9]{7,}/);
    });

    it('returns truthful email reminder status and never claims emails were sent without live integration', () => {
      delete process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS;
      expect(evaluateEmailReminderStatus()).toBe('disabled_by_feature_flag');

      process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS = 'true';
      delete process.env.RESEND_API_KEY;
      delete process.env.SENDGRID_API_KEY;
      expect(evaluateEmailReminderStatus()).toBe('missing_provider_credentials');

      process.env.RESEND_API_KEY = 're_valid_resend_api_key_sample_token';
      expect(evaluateEmailReminderStatus()).toBe('provider_not_integrated');
    });
  });

  // ==========================================================================
  // SUITE 6: ADDITIVE MIGRATION STATIC ARTIFACT VERIFICATION
  // ==========================================================================
  describe('6. Additive Migration 20261020000000_phase23_followup_reminder_concurrency.sql', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase',
      'migrations',
      '20261020000000_phase23_followup_reminder_concurrency.sql'
    );

    it('additive migration file exists and is readable', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
    });

    it('migration enforces row-level locking via FOR UPDATE SKIP LOCKED', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/FOR UPDATE OF f SKIP LOCKED/i);
    });

    it('migration enforces strict tenant isolation on lead reference', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/v_lead\.organization_id != v_fup\.organization_id/i);
      expect(sql).toMatch(/CROSS_TENANT_FOLLOWUP_MISMATCH/i);
    });

    it('migration pins search_path and restricts execution strictly to service_role', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);
      expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.process_follow_up_reminders_cron[\s\S]*?FROM PUBLIC, anon, authenticated/i);
      expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.process_follow_up_reminders_cron[\s\S]*?TO service_role/i);
    });

    it('migration includes explicit rollback instructions in comments', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/-- Rollback[\s\S]*?DROP FUNCTION IF EXISTS public\.process_follow_up_reminders_cron/i);
    });
  });
});
