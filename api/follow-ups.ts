import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from './_lib/supabaseServer.js';
import { db } from '../src/services/supabase/db.js';
import { sanitizeText } from '../src/lib/validation.js';
import { formatMaskedPhone } from '../src/lib/phoneNormalization.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !user || !profile) {
      const statusCode = authError?.includes('unavailable') ? 503 : 401;
      return res.status(statusCode).json({ error: authError || 'Unauthorized' });
    }

    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    // -------------------------------------------------------------------------
    // GET: List Follow-Ups (Organization and Role scoped)
    // -------------------------------------------------------------------------
    if (req.method === 'GET') {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        let query = supabase
          .from('follow_ups')
          .select(`
            id,
            organization_id,
            lead_id,
            assigned_to,
            scheduled_at,
            status,
            priority,
            notes,
            reason,
            completed_at,
            outcome,
            outcome_notes,
            rescheduled_at,
            reschedule_reason,
            previous_due_at,
            reschedule_count,
            created_at,
            updated_at
          `)
          .eq('organization_id', profile.organization_id)
          .order('scheduled_at', { ascending: true });

        // Telecallers only see their assigned follow-ups
        if (profile.role === 'TELECALLER') {
          query = query.eq('assigned_to', profile.id);
        }

        const statusFilter = req.query?.status;
        if (statusFilter && typeof statusFilter === 'string' && statusFilter !== 'ALL') {
          query = query.eq('status', statusFilter);
        }

        const { data: followUpsData, error } = await query;
        if (error) {
          console.error('[follow-ups] Error fetching follow-ups from Supabase:', error.message);
          return res.status(500).json({ error: 'Failed to load follow-ups.' });
        }

        // Fetch lead and telecaller info to enrich follow-ups
        const leadIds = Array.from(new Set((followUpsData || []).map((f: any) => f.lead_id).filter(Boolean)));
        let leadsMap = new Map<string, any>();

        if (leadIds.length > 0) {
          const { data: leadsData } = await supabase
            .from('leads')
            .select('id, lead_code, name, phone, status')
            .in('id', leadIds);

          if (leadsData) {
            leadsData.forEach((l: any) => leadsMap.set(l.id, l));
          }
        }

        const enriched = (followUpsData || []).map((f: any) => {
          const lead = leadsMap.get(f.lead_id);
          const rawPhone = lead?.phone || '';
          const displayPhone = profile.role === 'TELECALLER'
            ? formatMaskedPhone(rawPhone)
            : rawPhone;

          return {
            ...f,
            lead_code: lead?.lead_code || '',
            lead_name: lead?.name || '',
            lead_phone: displayPhone,
          };
        });

        return res.status(200).json({
          success: true,
          followUps: enriched,
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Database service is unavailable.' });
      }
      const followUps = db.getFollowUps(profile as any);
      return res.status(200).json({
        success: true,
        followUps,
      });
    }

    // -------------------------------------------------------------------------
    // POST: Create Follow-Up
    // -------------------------------------------------------------------------
    if (req.method === 'POST') {
      const { leadId, scheduledAt, priority, notes, assignedTo } = req.body || {};

      if (!leadId || typeof leadId !== 'string') {
        return res.status(400).json({ error: 'leadId is required.' });
      }

      if (!scheduledAt || typeof scheduledAt !== 'string') {
        return res.status(400).json({ error: 'scheduledAt is required.' });
      }

      const parsedDate = new Date(scheduledAt);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'scheduledAt must be a valid ISO date.' });
      }

      let targetAssignedTo = profile.id;
      if (profile.role === 'OWNER' || profile.role === 'ADMIN') {
        targetAssignedTo = assignedTo || profile.id;
      } else if (assignedTo && assignedTo !== profile.id) {
        return res.status(403).json({
          error: 'Forbidden: Telecallers cannot assign follow-ups to other agents.',
        });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();

        // 1. Verify lead exists and belongs strictly to caller's organization
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('id, organization_id, assigned_to')
          .eq('id', leadId)
          .eq('organization_id', profile.organization_id)
          .maybeSingle();

        if (leadError || !lead) {
          return res.status(404).json({ error: 'Lead not found in your organization.' });
        }

        // If telecaller, verify they are authorized on this lead
        if (profile.role === 'TELECALLER' && lead.assigned_to && lead.assigned_to !== profile.id) {
          return res.status(403).json({ error: 'Forbidden: You are not assigned to this lead.' });
        }

        // 2. Insert follow-up record
        const sanitizedNotes = notes ? sanitizeText(String(notes)) : '';
        const validPriority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority) ? priority : 'MEDIUM';

        const { data: newFollowUp, error: insertError } = await supabase
          .from('follow_ups')
          .insert({
            organization_id: profile.organization_id,
            lead_id: leadId,
            assigned_to: targetAssignedTo,
            scheduled_at: parsedDate.toISOString(),
            status: 'PENDING',
            priority: validPriority,
            notes: sanitizedNotes,
            created_by: profile.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          console.error('[follow-ups] Error creating follow-up in Supabase:', insertError.message);
          return res.status(500).json({ error: 'Failed to create follow-up.' });
        }

        return res.status(201).json({
          success: true,
          followUp: newFollowUp,
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Database service is unavailable. Cannot create follow-up.' });
      }
      const created = db.createFollowUp(
        {
          lead_id: leadId,
          assigned_to: targetAssignedTo,
          scheduled_at: parsedDate.toISOString(),
          priority: priority || 'MEDIUM',
          notes: notes || '',
        },
        profile as any
      );

      return res.status(201).json({
        success: true,
        followUp: created,
      });
    }

    // -------------------------------------------------------------------------
    // PATCH: Mutate Follow-Up (Reschedule, Complete, Cancel)
    // -------------------------------------------------------------------------
    if (req.method === 'PATCH') {
      const { id, action, scheduledAt, reason, outcome, outcomeNotes, notes } = req.body || {};

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Follow-up ID is required.' });
      }

      const validActions = ['reschedule', 'complete', 'cancel', 'update'];
      if (!action || !validActions.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
        });
      }

      if (action === 'reschedule') {
        if (!scheduledAt || typeof scheduledAt !== 'string') {
          return res.status(400).json({ error: 'scheduledAt is required for rescheduling.' });
        }
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
          return res.status(400).json({ error: 'Reschedule reason is mandatory.' });
        }
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();

        // 1. Fetch existing follow-up with tenant isolation
        const { data: existing, error: fetchError } = await supabase
          .from('follow_ups')
          .select('*')
          .eq('id', id)
          .eq('organization_id', profile.organization_id)
          .maybeSingle();

        if (fetchError || !existing) {
          return res.status(404).json({ error: 'Follow-up not found in your organization.' });
        }

        // Telecaller isolation
        if (profile.role === 'TELECALLER' && existing.assigned_to !== profile.id) {
          return res.status(403).json({
            error: 'Forbidden: You can only update follow-ups assigned to you.',
          });
        }

        const now = new Date().toISOString();
        const updatePayload: Record<string, any> = {
          updated_at: now,
        };

        if (action === 'reschedule') {
          if (!scheduledAt || typeof scheduledAt !== 'string') {
            return res.status(400).json({ error: 'scheduledAt is required for rescheduling.' });
          }
          const parsedDate = new Date(scheduledAt);
          if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: 'scheduledAt must be a valid ISO date.' });
          }

          updatePayload.scheduled_at = parsedDate.toISOString();
          updatePayload.status = 'PENDING';
          updatePayload.rescheduled_at = now;
          updatePayload.previous_due_at = existing.scheduled_at;
          updatePayload.reschedule_reason = reason ? sanitizeText(String(reason)) : '';
          updatePayload.reschedule_count = (existing.reschedule_count || 0) + 1;
        } else if (action === 'complete') {
          updatePayload.status = 'COMPLETED';
          updatePayload.completed_at = now;
          if (outcome) updatePayload.outcome = sanitizeText(String(outcome));
          if (outcomeNotes) updatePayload.outcome_notes = sanitizeText(String(outcomeNotes));
        } else if (action === 'cancel') {
          updatePayload.status = 'CANCELLED';
          if (reason) updatePayload.reason = sanitizeText(String(reason));
        } else if (action === 'update') {
          if (notes) updatePayload.notes = sanitizeText(String(notes));
        }

        const { data: updated, error: updateError } = await supabase
          .from('follow_ups')
          .update(updatePayload)
          .eq('id', id)
          .eq('organization_id', profile.organization_id)
          .select()
          .single();

        if (updateError) {
          console.error('[follow-ups] Error updating follow-up in Supabase:', updateError.message);
          return res.status(500).json({ error: 'Failed to update follow-up.' });
        }

        return res.status(200).json({
          success: true,
          followUp: updated,
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Database service is unavailable. Cannot update follow-up.' });
      }
      let updated: any = null;
      if (action === 'reschedule') {
        updated = db.rescheduleFollowUp(id, scheduledAt, reason, profile as any);
      } else if (action === 'complete') {
        updated = db.completeFollowUp(id, profile as any, outcomeNotes);
      } else if (action === 'cancel') {
        updated = db.cancelFollowUp(id, reason, profile as any);
      } else {
        updated = db.updateFollowUpNotes(id, notes, profile as any);
      }

      return res.status(200).json({
        success: true,
        followUp: updated,
      });
    }
  } catch (error: any) {
    console.error('[follow-ups] Unexpected handler error:', error?.message || error);
    return res.status(500).json({ error: 'Internal server error processing follow-ups.' });
  }
}
