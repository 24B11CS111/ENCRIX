import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mailer = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../api/_lib/emailDelivery.js', () => ({
  sendInvitationEmail: vi.fn(),
  sendFollowUpReminderEmail: (...args: any[]) => mailer.send(...args),
}));

import { enqueueAndDispatchReminderEmails, evaluateEmailReminderStatus } from '../../api/_lib/reminderProcessor';

function createOutboxClient(options: { profile?: any; shouldFailSend?: boolean } = {}) {
  const reference = '2026-11-01T10:00:00.000Z';
  const followUp = {
    id: 'follow-up-1', organization_id: 'org-a', assigned_to: 'telecaller-a',
    scheduled_at: reference, reminded_at: reference, overdue_notified_at: null, owner_alerted_at: null,
  };
  const profile = options.profile || {
    id: 'telecaller-a', organization_id: 'org-a', role: 'TELECALLER', status: 'ACTIVE',
    email: 'caller@example.test', email_verified: true,
  };
  let queued = false;
  let deliveryState: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | null = null;
  let sent = 0;
  const client = {
    from(table: string) {
      let filters: Record<string, unknown> = {};
      const query: any = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters[field] = value; return query; },
        then: (resolve: any) => {
          const markerField = Object.keys(filters).find((key) => ['reminded_at', 'overdue_notified_at', 'owner_alerted_at'].includes(key));
          const data = table === 'follow_ups'
            ? (markerField && (followUp as any)[markerField] === filters[markerField] &&
                (!filters.organization_id || filters.organization_id === followUp.organization_id) ? [followUp] : [])
            : (profile.organization_id === filters.organization_id && profile.role === filters.role &&
                profile.status === filters.status && profile.email_verified === filters.email_verified &&
                (!filters.id || profile.id === filters.id) ? [profile] : []);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
    async rpc(name: string, args: any) {
      if (name === 'queue_follow_up_reminder_email') {
        expect(args.p_organization_id).toBe('org-a');
        const inserted = !queued;
        if (inserted) { queued = true; deliveryState = 'QUEUED'; }
        return { data: inserted, error: null };
      }
      if (name === 'claim_follow_up_reminder_emails') {
        expect(args.p_organization_id).toBeNull();
        if (deliveryState !== 'QUEUED') return { data: [], error: null };
        deliveryState = 'SENDING';
        return { data: [{
          id: 'outbox-1', claim_token: 'claim-1', recipient_email: 'caller@example.test',
          subject: 'Upcoming ENCRIX follow-up', text_body: 'A follow-up is scheduled soon.',
          html_body: '<p>Test</p>',
        }], error: null };
      }
      if (name === 'complete_follow_up_reminder_email') {
        deliveryState = args.p_sent ? 'SENT' : 'FAILED';
        if (args.p_sent) sent++;
        return { data: true, error: null };
      }
      return { data: null, error: { code: 'unexpected_rpc' } };
    },
    get state() { return { queued, deliveryState, sent }; },
  };
  if (options.shouldFailSend) mailer.send.mockRejectedValue(new Error('provider unavailable'));
  else mailer.send.mockResolvedValue({ id: 'provider-message' });
  return client;
}

describe('follow-up reminder email outbox', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS = 'true';
    process.env.RESEND_API_KEY = 'synthetic_resend_key_for_unit_spec_123';
    process.env.RESEND_FROM_EMAIL = 'ENCRIX <staging@example.test>';
    process.env.APP_URL = 'https://staging.example.test';
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('queues and sends once only to a verified active same-organization assignee', async () => {
    const client = createOutboxClient();
    const result = await enqueueAndDispatchReminderEmails(client, new Date('2026-11-01T10:00:00.000Z'));
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(client.state).toMatchObject({ queued: true, deliveryState: 'SENT', sent: 1 });
    expect(mailer.send.mock.calls[0][0].text).not.toMatch(/phone|@example\.test/i);
  });

  it('does not deliver to inactive or unverified users', async () => {
    const client = createOutboxClient({ profile: {
      id: 'telecaller-a', organization_id: 'org-a', role: 'TELECALLER', status: 'SUSPENDED',
      email: 'caller@example.test', email_verified: false,
    } });
    const result = await enqueueAndDispatchReminderEmails(client, new Date('2026-11-01T10:00:00.000Z'));
    expect(result.sent).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('marks provider failures as failed and does not automatically resend them', async () => {
    const client = createOutboxClient({ shouldFailSend: true });
    const first = await enqueueAndDispatchReminderEmails(client, new Date('2026-11-01T10:00:00.000Z'));
    const second = await enqueueAndDispatchReminderEmails(client, new Date('2026-11-01T10:00:00.000Z'));
    expect(first.failed).toBe(1);
    expect(second.sent).toBe(0);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(client.state.deliveryState).toBe('FAILED');
  });

  it('keeps reminder email status truthful when Resend is not configured', () => {
    delete process.env.RESEND_API_KEY;
    expect(evaluateEmailReminderStatus()).toBe('missing_provider_credentials');
  });

  it('defines unique outbox event keys and service-role-only RPCs in the migration', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261101090000_followup_email_outbox.sql'), 'utf8');
    expect(sql).toContain('UNIQUE (follow_up_id, recipient_profile_id, milestone)');
    expect(sql).toContain('FOR UPDATE OF o SKIP LOCKED');
    expect(sql).toContain('p.email_verified IS TRUE');
    expect(sql).toContain('g.owner_id = p.user_id');
    expect(sql).toContain('p.id = f.assigned_to');
    expect(sql).toContain('l.organization_id = f.organization_id');
    expect(sql).toContain('RECIPIENT_NO_LONGER_AUTHORIZED');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('TO service_role');
  });
});
