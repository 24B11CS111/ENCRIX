import crypto from 'crypto';
import { getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer';
import { isLiveEmailConfigured } from './otpServer';
import { db } from '../../src/services/supabase/db';

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
  if (!isLiveEmailConfigured()) {
    return 'missing_provider_credentials';
  }
  return 'provider_not_integrated';
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

  // 1. Production Safety Check: Fail closed if real database configuration is absent
  if (isProd && !client) {
    throw new Error('Server Misconfiguration: Supabase database connection is required in production.');
  }

  // 2. Offline / Demo Sandbox Fallback (strictly in non-production mode when no Supabase client is available)
  if (!client) {
    let mockProfile: any = undefined;
    if (targetOrgId) {
      mockProfile = {
        id: 'system-cron',
        organization_id: targetOrgId,
        role: 'ADMIN',
        status: 'ACTIVE',
        full_name: 'ENCRIX Cron Daemon',
      };
    }
    const { remindedCount, overdueCount } = db.processFollowUpReminders(mockProfile, referenceTime);
    return {
      success: true,
      timestamp: referenceTime.toISOString(),
      remindedCount,
      overdueCount,
      escalatedCount: 0,
      emailStatus: evaluateEmailReminderStatus(),
    };
  }

  // 3. Attempt Atomic Stored Procedure Execution (Postgres FOR UPDATE SKIP LOCKED)
  try {
    const { data: rpcData, error: rpcError } = await client.rpc(
      'process_follow_up_reminders_cron',
      {
        p_reference_time: referenceTime.toISOString(),
        p_target_org_id: targetOrgId || null,
      }
    );

    if (!rpcError && rpcData && rpcData.success) {
      return {
        success: true,
        timestamp: referenceTime.toISOString(),
        remindedCount: rpcData.reminded_count || 0,
        overdueCount: rpcData.overdue_count || 0,
        escalatedCount: rpcData.escalated_count || 0,
        emailStatus: evaluateEmailReminderStatus(),
      };
    }
  } catch {
    // If stored procedure is not yet deployed, seamlessly fall through to client-side atomic pipeline
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
      // Completely independent of telecaller overdue notification
      if (isEscalationDue) {
        // Atomic database claim
        const { data: claim, error: claimErr } = await client
          .from('follow_ups')
          .update({
            owner_alerted_at: refIso,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fup.id)
          .is('owner_alerted_at', null)
          .select('id');

        if (!claimErr && claim && claim.length > 0) {
          try {
            // Resolve active owner(s) strictly within fup.organization_id
            const { data: owners, error: ownerErr } = await client
              .from('profiles')
              .select('id, organization_id, full_name, role, status')
              .eq('organization_id', fup.organization_id)
              .eq('role', 'OWNER')
              .eq('status', 'ACTIVE');

            if (!ownerErr && owners && owners.length > 0) {
              for (const owner of owners) {
                if (owner.organization_id !== fup.organization_id) continue;

                await client.from('notifications').insert({
                  organization_id: fup.organization_id,
                  user_id: owner.id,
                  type: 'FOLLOW_UP_OVERDUE',
                  title: 'Overdue Lead Callback',
                  message: `Lead ${leadCodeStr} is overdue for follow-up (assigned to agent). Review for escalation.`,
                  link: '/owner/follow-ups',
                  read: false,
                });
              }
            }

            await client.from('activity_logs').insert({
              organization_id: fup.organization_id,
              user_id: fup.assigned_to,
              action: 'FOLLOWUP_REMINDER_SENT',
              entity_type: 'follow_up',
              entity_id: fup.id,
              metadata: {
                leadCode: lead.lead_code,
                scheduledAt: fup.scheduled_at,
                type: 'OWNER_ESCALATION',
              },
            });

            escalatedCount++;
          } catch (insertErr: any) {
            await client
              .from('follow_ups')
              .update({ owner_alerted_at: null })
              .eq('id', fup.id)
              .eq('owner_alerted_at', refIso);
            processingErrors.push(`Failed to dispatch owner escalation for follow-up ${fup.id}: ${insertErr.message}`);
          }
        }
      }
    } catch (recordErr: any) {
      // Individual record failure must never abort processing for other tenant organizations
      processingErrors.push(`Error processing follow-up ${fup.id}: ${recordErr.message}`);
    }
  }

  return {
    success: true,
    timestamp: refIso,
    remindedCount,
    overdueCount,
    escalatedCount,
    emailStatus: evaluateEmailReminderStatus(),
    errors: processingErrors.length > 0 ? processingErrors : undefined,
  };
}
