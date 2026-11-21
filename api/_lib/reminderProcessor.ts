import crypto from 'crypto';
import { getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer.js';
import { sendFollowUpReminderEmail } from './emailDelivery.js';
import { escapeHtml } from './emailHtml.js';

export interface ProcessRemindersOptions {
  referenceTime?: Date;
  targetOrganizationId?: string;
  supabaseClient?: any;
}

export interface ReminderProcessResult {
  success: boolean;
  timestamp: string;
  remindedCount: number;
  overdueCount: number;
  escalatedCount: number;
  emailStatus: string;
  errors?: string[];
}

/**
 * Constant-time comparison to prevent timing attacks against CRON_SECRET.
 */
export function timingSafeCompare(providedToken: string, expectedSecret: string): boolean {
  if (!providedToken || !expectedSecret) return false;
  const bufProvided = Buffer.from(providedToken, 'utf8');
  const bufExpected = Buffer.from(expectedSecret, 'utf8');
  if (bufProvided.length !== bufExpected.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Validates and retrieves the server-side CRON_SECRET.
 * In production, strictly enforces presence, entropy (>= 32 chars), and rejects placeholder values.
 */
export function getValidatedCronSecret(): string {
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.VITE_APP_ENV === 'production';
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.trim() !== secret) {
    if (isProd) {
      throw new Error('CRON_SECRET is missing or invalid in production environment');
    }
    return '';
  }

  const PLACEHOLDER_PATTERN =
    /(?:placeholder|your[-_ ]|change[-_ ]?me|replace[-_ ]?me|example|sample|dummy|default|(?:^|[-_ ])(?:test|mock|demo)(?:$|[-_ ]))/i;

  if (isProd) {
    if (secret.length < 32 || PLACEHOLDER_PATTERN.test(secret)) {
      throw new Error('CRON_SECRET is insecure or placeholder in production environment');
    }
  }

  return secret;
}

/**
 * Evaluates truthful email reminder status.
 * Never claims emails were sent unless a live delivery integration is actively verified.
 */
export function evaluateEmailReminderStatus(): string {
  const isEnabled = process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS === 'true';
  if (!isEnabled) {
    return 'disabled_by_feature_flag';
  }
  if (!process.env.RESEND_API_KEY || /placeholder|your-|test/i.test(process.env.RESEND_API_KEY) ||
      !process.env.RESEND_FROM_EMAIL || !process.env.RESEND_FROM_EMAIL.includes('@')) {
    return 'missing_provider_credentials';
  }
  return 'ready';
}

export async function enqueueAndDispatchReminderEmails(
  client: any,
  referenceTime: Date,
  targetOrganizationId?: string,
): Promise<{ sent: number; failed: number }> {
  if (process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS !== 'true') return { sent: 0, failed: 0 };
  if (evaluateEmailReminderStatus() !== 'ready' || !isSafeAppUrl(process.env.APP_URL)) return { sent: 0, failed: 1 };

  const referenceIso = referenceTime.toISOString();
  const eventColumns = [
    { column: 'reminded_at', milestone: 'UPCOMING_REMINDER', recipientRole: 'TELECALLER' },
    { column: 'overdue_notified_at', milestone: 'OVERDUE_ALERT', recipientRole: 'TELECALLER' },
    { column: 'owner_alerted_at', milestone: 'OWNER_ESCALATION', recipientRole: 'OWNER' },
  ] as const;
  let failed = 0;

  for (const event of eventColumns) {
    let query = client.from('follow_ups')
      .select('id, organization_id, assigned_to, scheduled_at')
      .eq(event.column, referenceIso);
    if (targetOrganizationId) query = query.eq('organization_id', targetOrganizationId);
    const { data: dueRows, error: dueError } = await query;
    if (dueError) { failed++; continue; }

    for (const followUp of dueRows || []) {
      const profileQuery = client.from('profiles')
        .select('id, organization_id, role, status, email, email_verified')
        .eq('organization_id', followUp.organization_id)
        .eq('role', event.recipientRole)
        .eq('status', 'ACTIVE')
        .eq('email_verified', true);
      if (event.recipientRole === 'TELECALLER') profileQuery.eq('id', followUp.assigned_to);
      const { data: recipients, error: recipientsError } = await profileQuery;
      if (recipientsError) { failed++; continue; }

      const scheduled = new Date(followUp.scheduled_at).toUTCString();
      const message = event.milestone === 'UPCOMING_REMINDER'
        ? `A follow-up is scheduled soon (${scheduled}). Sign in to ENCRIX to review it.`
        : event.milestone === 'OVERDUE_ALERT'
          ? `A scheduled follow-up is overdue (${scheduled}). Sign in to ENCRIX to review it.`
          : `A follow-up escalation requires review (${scheduled}). Sign in to ENCRIX to review it.`;
      const subject = event.milestone === 'UPCOMING_REMINDER'
        ? 'Upcoming ENCRIX follow-up'
        : event.milestone === 'OVERDUE_ALERT'
          ? 'Overdue ENCRIX follow-up'
          : 'ENCRIX follow-up escalation';
      for (const recipient of recipients || []) {
        if (recipient.organization_id !== followUp.organization_id || recipient.status !== 'ACTIVE' ||
            recipient.email_verified !== true || typeof recipient.email !== 'string') continue;
        const { error: queueError } = await client.rpc('queue_follow_up_reminder_email', {
          p_organization_id: followUp.organization_id,
          p_follow_up_id: followUp.id,
          p_recipient_profile_id: recipient.id,
          p_milestone: event.milestone,
          p_recipient_email: recipient.email,
          p_subject: subject,
          p_text_body: message,
          p_html_body: `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(process.env.APP_URL!)}/login">Open ENCRIX</a></p>`,
        });
        if (queueError) failed++;
      }
    }
  }

  const { data: deliveries, error: claimError } = await client.rpc('claim_follow_up_reminder_emails', {
    p_organization_id: targetOrganizationId || null,
    p_limit: 20,
  });
  if (claimError || !Array.isArray(deliveries)) return { sent: 0, failed: failed + 1 };

  let sent = 0;
  for (const delivery of deliveries) {
    try {
      const provider = await sendFollowUpReminderEmail({
        recipient: delivery.recipient_email,
        subject: delivery.subject,
        text: delivery.text_body,
        html: delivery.html_body,
        idempotencyKey: delivery.id,
      });
      const { data: completed, error: completeError } = await client.rpc('complete_follow_up_reminder_email', {
        p_id: delivery.id,
        p_claim_token: delivery.claim_token,
        p_sent: true,
        p_provider_message_id: provider.id || null,
        p_failure_code: null,
      });
      if (completeError || completed !== true) failed++;
      else sent++;
    } catch (error: any) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/i.test(error.code)
        ? error.code
        : 'DELIVERY_FAILED';
      const { error: completeError } = await client.rpc('complete_follow_up_reminder_email', {
        p_id: delivery.id,
        p_claim_token: delivery.claim_token,
        p_sent: false,
        p_provider_message_id: null,
        p_failure_code: code,
      });
      failed++;
      if (completeError) console.error('[reminders] Unable to record email delivery failure', { code: 'OUTBOX_UPDATE_FAILED' });
    }
  }
  return { sent, failed };
}

function isSafeAppUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * Core Production Follow-Up Reminder Processor.
 * Connects to Supabase, enforces tenant isolation, handles atomic claims,
 * and records notifications and audit activity logs.
 */
export async function processFollowUpReminders(
  options: ProcessRemindersOptions = {}
): Promise<ReminderProcessResult> {
  const referenceTime = options.referenceTime || new Date();
  const targetOrgId = options.targetOrganizationId;
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.VITE_APP_ENV === 'production';

  const client = options.supabaseClient || (isRealSupabaseServerConfigured() ? getSupabaseServerClient() : null);

  const unavailableResult = (message: string): ReminderProcessResult => ({
    success: false,
    timestamp: referenceTime.toISOString(),
    remindedCount: 0,
    overdueCount: 0,
    escalatedCount: 0,
    emailStatus: evaluateEmailReminderStatus(),
    errors: [message],
  });

  // 1. Production Safety Check: Fail closed if real database configuration is absent
  if (isProd && !client) {
    throw new Error('Server Misconfiguration: Supabase database connection is required in production.');
  }

  // Reminders are a paid CRM feature; never use the in-memory/demo fallback
  // because it cannot establish a verified subscription entitlement.
  if (!client) {
    return unavailableResult('PAID_ENTITLEMENT_UNAVAILABLE');
  }

  if (targetOrgId) {
    const { data: entitled, error: entitlementError } = await client.rpc(
      'organization_has_active_paid_entitlement',
      { p_organization_id: targetOrgId },
    );
    if (entitlementError) throw new Error('Paid entitlement could not be verified for reminder processing.');
    if (entitled !== true) {
      return {
        success: true,
        timestamp: referenceTime.toISOString(),
        remindedCount: 0,
        overdueCount: 0,
        escalatedCount: 0,
        emailStatus: evaluateEmailReminderStatus(),
      };
    }
  } else {
    // Scheduled all-tenant runs enumerate active organizations and invoke the
    // existing atomic reminder RPC only for organizations with paid access.
    const { data: organizations, error: organizationError } = await client
      .from('organizations').select('id').eq('status', 'ACTIVE');
    if (organizationError || !Array.isArray(organizations)) {
      throw new Error('Organization entitlement scan is unavailable.');
    }
    const totals: Omit<ReminderProcessResult, 'success' | 'timestamp' | 'errors'> = {
      remindedCount: 0,
      overdueCount: 0,
      escalatedCount: 0,
      emailStatus: evaluateEmailReminderStatus(),
    };
    const errors: string[] = [];
    for (const organization of organizations) {
      if (typeof organization?.id !== 'string') continue;
      try {
        const result = await processFollowUpReminders({
          ...options,
          referenceTime,
          targetOrganizationId: organization.id,
          supabaseClient: client,
        });
        totals.remindedCount += result.remindedCount;
        totals.overdueCount += result.overdueCount;
        totals.escalatedCount += result.escalatedCount;
        if (!result.success) errors.push(...(result.errors || [`Reminder processing failed for an organization.`]));
      } catch {
        errors.push('Reminder processing failed for an organization.');
      }
    }
    return { ...totals, success: errors.length === 0, timestamp: referenceTime.toISOString(), ...(errors.length ? { errors } : {}) };
  }

  // Attempt Atomic Stored Procedure Execution (Postgres FOR UPDATE SKIP LOCKED)
  const { data: rpcData, error: rpcError } = await client.rpc(
    'process_follow_up_reminders_cron',
    {
      p_reference_time: referenceTime.toISOString(),
      p_target_org_id: targetOrgId || null,
    }
  );

  if (!rpcError && rpcData?.success) {
    const emailResult = await enqueueAndDispatchReminderEmails(client, referenceTime, targetOrgId);
    return {
      success: true,
      timestamp: referenceTime.toISOString(),
      remindedCount: rpcData.reminded_count || 0,
      overdueCount: rpcData.overdue_count || 0,
      escalatedCount: rpcData.escalated_count || 0,
      emailStatus: process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS === 'true'
        ? (emailResult.failed ? 'delivery_failed' : 'sent')
        : evaluateEmailReminderStatus(),
      ...(emailResult.failed ? { errors: ['One or more reminder emails could not be delivered.'] } : {}),
    };
  }
  if (rpcError && !['42883', 'PGRST202'].includes(rpcError.code || '')) {
    throw new Error(`Database error executing follow-up reminder procedure: ${rpcError.message}`);
  }
  if (!rpcError && !rpcData?.success) {
    throw new Error('Follow-up reminder procedure returned an unsuccessful result.');
  }

  // 4. Client-Side Atomic Claim Pipeline (Database-backed row-level locking via conditional updates)
  const nowMs = referenceTime.getTime();
  const refIso = referenceTime.toISOString();
  const fifteenMinsMs = 15 * 60 * 1000;
  const thirtyMinsMs = 30 * 60 * 1000;

  let remindedCount = 0;
  let overdueCount = 0;
  let escalatedCount = 0;
  const processingErrors: string[] = [];

  // Query eligible follow-ups across active statuses
  let query = client
    .from('follow_ups')
    .select('id, organization_id, lead_id, assigned_to, scheduled_at, status, reminded_at, overdue_notified_at, owner_alerted_at')
    .in('status', ['SCHEDULED', 'PENDING', 'DUE', 'OVERDUE']);

  if (targetOrgId) {
    query = query.eq('organization_id', targetOrgId);
  }

  const { data: followUps, error: fupError } = await query;
  if (fupError) {
    throw new Error(`Database error querying follow-ups: ${fupError.message}`);
  }

  if (!followUps || followUps.length === 0) {
    return {
      success: true,
      timestamp: refIso,
      remindedCount: 0,
      overdueCount: 0,
      escalatedCount: 0,
      emailStatus: evaluateEmailReminderStatus(),
    };
  }

  for (const fup of followUps) {
    try {
      const scheduledTime = new Date(fup.scheduled_at).getTime();
      const isUpcomingDue =
        !fup.reminded_at &&
        scheduledTime >= nowMs &&
        scheduledTime - nowMs <= fifteenMinsMs;
      const isOverdueDue = !fup.overdue_notified_at && nowMs > scheduledTime;
      const isEscalationDue =
        !fup.owner_alerted_at && nowMs - scheduledTime >= thirtyMinsMs;

      // Skip early if no reminder milestone is due for this record
      if (!isUpcomingDue && !isOverdueDue && !isEscalationDue) {
        continue;
      }

      // 4a. Tenant Isolation: Verify linked lead exists and belongs to the exact same organization
      const { data: lead, error: leadError } = await client
        .from('leads')
        .select('id, organization_id, lead_code, status')
        .eq('id', fup.lead_id)
        .single();

      if (leadError || !lead) {
        continue;
      }

      if (lead.organization_id !== fup.organization_id) {
        // Cross-tenant mismatch detected! Never process under wrong tenant.
        await client.from('security_events').insert({
          organization_id: fup.organization_id,
          user_id: fup.assigned_to,
          event_type: 'CROSS_TENANT_FOLLOWUP_MISMATCH',
          severity: 'HIGH',
          description: `Follow-up ${fup.id} belongs to organization ${fup.organization_id} but links to lead ${fup.lead_id} of organization ${lead.organization_id}.`,
          metadata: { followUpId: fup.id, leadId: fup.lead_id },
        });
        continue;
      }

      if (lead.status === 'DO_NOT_CONTACT' || lead.status === 'INVALID') {
        continue;
      }

      // 4b. Verify assigned telecaller profile
      const { data: telecaller, error: tcError } = await client
        .from('profiles')
        .select('id, organization_id, full_name, role, status')
        .eq('id', fup.assigned_to)
        .single();

      const isTelecallerValid =
        !tcError &&
        telecaller &&
        telecaller.organization_id === fup.organization_id &&
        telecaller.status === 'ACTIVE';

      if (telecaller && telecaller.organization_id !== fup.organization_id) {
        await client.from('security_events').insert({
          organization_id: fup.organization_id,
          user_id: fup.assigned_to,
          event_type: 'CROSS_TENANT_PROFILE_MISMATCH',
          severity: 'HIGH',
          description: `Follow-up ${fup.id} is assigned to user ${fup.assigned_to} from a different organization (${telecaller.organization_id}).`,
          metadata: { followUpId: fup.id, userId: fup.assigned_to },
        });
      }

      const formattedTime = new Date(fup.scheduled_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const leadCodeStr = lead.lead_code || 'lead';

      // 4c. Milestone 1: Upcoming Reminder (within 15m)
      if (isUpcomingDue && isTelecallerValid) {
        // Atomic database claim: only succeeds if reminded_at is still null
        const { data: claim, error: claimErr } = await client
          .from('follow_ups')
          .update({
            reminded_at: refIso,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fup.id)
          .is('reminded_at', null)
          .select('id');

        if (!claimErr && claim && claim.length > 0) {
          try {
            await client.from('notifications').insert({
              organization_id: fup.organization_id,
              user_id: fup.assigned_to,
              type: 'FOLLOW_UP_DUE',
              title: 'Follow-Up Due Soon',
              message: `Upcoming callback for ${leadCodeStr} is scheduled at ${formattedTime}.`,
              link: '/telecaller/follow-ups',
              read: false,
            });

            await client.from('activity_logs').insert({
              organization_id: fup.organization_id,
              user_id: fup.assigned_to,
              action: 'FOLLOWUP_REMINDER_SENT',
              entity_type: 'follow_up',
              entity_id: fup.id,
              metadata: {
                leadCode: lead.lead_code,
                scheduledAt: fup.scheduled_at,
                type: 'UPCOMING_REMINDER',
              },
            });

            remindedCount++;
          } catch (insertErr: any) {
            // Revert claim on notification failure to permit safe retry on next cron run
            await client
              .from('follow_ups')
              .update({ reminded_at: null })
              .eq('id', fup.id)
              .eq('reminded_at', refIso);
            processingErrors.push(`Failed to dispatch upcoming reminder for follow-up ${fup.id}: ${insertErr.message}`);
          }
        }
      }

      // 4d. Milestone 2: Telecaller Overdue Notification (past scheduled_at)
      if (isOverdueDue && isTelecallerValid) {
        // Atomic database claim
        const { data: claim, error: claimErr } = await client
          .from('follow_ups')
          .update({
            overdue_notified_at: refIso,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fup.id)
          .is('overdue_notified_at', null)
          .select('id');

        if (!claimErr && claim && claim.length > 0) {
          try {
            await client.from('notifications').insert({
              organization_id: fup.organization_id,
              user_id: fup.assigned_to,
              type: 'FOLLOW_UP_OVERDUE',
              title: 'Follow-Up Overdue',
              message: `Scheduled callback for ${leadCodeStr} was due at ${formattedTime} and is now overdue.`,
              link: '/telecaller/follow-ups',
              read: false,
            });

            await client.from('activity_logs').insert({
              organization_id: fup.organization_id,
              user_id: fup.assigned_to,
              action: 'FOLLOWUP_REMINDER_SENT',
              entity_type: 'follow_up',
              entity_id: fup.id,
              metadata: {
                leadCode: lead.lead_code,
                scheduledAt: fup.scheduled_at,
                type: 'OVERDUE_ALERT',
              },
            });

            overdueCount++;
          } catch (insertErr: any) {
            await client
              .from('follow_ups')
              .update({ overdue_notified_at: null })
              .eq('id', fup.id)
              .eq('overdue_notified_at', refIso);
            processingErrors.push(`Failed to dispatch overdue alert for follow-up ${fup.id}: ${insertErr.message}`);
          }
        }
      }

      // 4e. Milestone 3: Owner Overdue Escalation (>= 30m overdue)
      // This fallback uses separate PostgREST transactions, so it cannot atomically
      // record the notification and escalation timestamp. Defer until the SQL RPC
      // is deployed rather than risk a permanently claimed or duplicate escalation.
      if (isEscalationDue) {
        processingErrors.push(
            `Owner escalation for follow-up ${fup.id} was deferred because the atomic database procedure is unavailable.`
        );
      }
    } catch (recordErr: any) {
      // Individual record failure must never abort processing for other tenant organizations
      processingErrors.push(`Error processing follow-up ${fup.id}: ${recordErr.message}`);
    }
  }

  const emailResult = await enqueueAndDispatchReminderEmails(client, referenceTime, targetOrgId);
  if (emailResult.failed) processingErrors.push('One or more reminder emails could not be delivered.');

  return {
    success: processingErrors.length === 0,
    timestamp: refIso,
    remindedCount,
    overdueCount,
    escalatedCount,
    emailStatus: process.env.ENABLE_FOLLOWUP_EMAIL_REMINDERS === 'true'
      ? (emailResult.failed ? 'delivery_failed' : 'sent')
      : evaluateEmailReminderStatus(),
    errors: processingErrors.length > 0 ? processingErrors : undefined,
  };
}
