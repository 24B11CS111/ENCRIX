import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';
import { db } from '../../../src/services/supabase/db.js';
import { sanitizeText } from '../../../src/lib/validation.js';

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

    if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Only organization owners or administrators can perform this action.',
      });
    }

    const route = req.query?._route;

    // -------------------------------------------------------------------------
    // GET: List Organization Leads (owner-list)
    // -------------------------------------------------------------------------
    if (req.method === 'GET' || route === 'owner-list') {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        let query = supabase
          .from('leads')
          .select('*')
          .eq('organization_id', profile.organization_id)
          .order('created_at', { ascending: false });

        const statusFilter = req.query?.status;
        if (statusFilter && typeof statusFilter === 'string' && statusFilter !== 'ALL') {
          query = query.eq('status', statusFilter);
        }

        const { data, error } = await query;
        if (error) {
          console.error('[leads/owner] Error loading leads from Supabase:', error.message);
          return res.status(500).json({ error: 'Failed to load organization leads.' });
        }

        return res.status(200).json({
          success: true,
          leads: data || [],
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Organization lead access requires a configured database.' });
      }
      return res.status(200).json({
        success: true,
        leads: db.getLeads(profile as any),
      });
    }

    // -------------------------------------------------------------------------
    // POST / PATCH: Create, Assign, or Update
    // -------------------------------------------------------------------------
    const body = req.body || {};

    // 1. Assign Leads (owner-assign)
    if (route === 'owner-assign' || body.action === 'assign') {
      const { leadIds, telecallerId } = body;
      if (!Array.isArray(leadIds) || leadIds.length === 0 || !telecallerId) {
        return res.status(400).json({ error: 'leadIds array and telecallerId are required.' });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();

        // Verify target telecaller exists in this organization
        const { data: tcProfile, error: tcErr } = await supabase
          .from('profiles')
          .select('id, organization_id, role, status, full_name')
          .eq('id', telecallerId)
          .eq('organization_id', profile.organization_id)
          .maybeSingle();

        if (tcErr || !tcProfile) {
          return res.status(404).json({ error: 'Selected telecaller not found in your organization.' });
        }

        const now = new Date().toISOString();
        const { error: updateErr } = await supabase
          .from('leads')
          .update({
            assigned_to: telecallerId,
            status: 'ASSIGNED',
            updated_at: now,
          })
          .in('id', leadIds)
          .eq('organization_id', profile.organization_id);

        if (updateErr) {
          console.error('[leads/owner] Failed to assign leads in Supabase:', updateErr.message);
          return res.status(500).json({ error: 'Failed to assign leads.' });
        }

        // Insert assignment audit records
        try {
          const assignmentRecords = leadIds.map((lid: string) => ({
            organization_id: profile.organization_id,
            lead_id: lid,
            user_id: telecallerId,
            assigned_by: profile.id,
            assigned_at: now,
            mode: 'MANUAL',
          }));
          await supabase.from('lead_assignments').insert(assignmentRecords);
        } catch {
          // Non-blocking assignment history failure
        }

        return res.status(200).json({
          success: true,
          assigned_count: leadIds.length,
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Lead assignment requires a configured database.' });
      }
      const count = db.assignLeads(leadIds, telecallerId, profile as any);
      return res.status(200).json({ success: true, assigned_count: count });
    }

    // 2. Create Lead (owner-create)
    if (route === 'owner-create' || body.action === 'create' || (!route && req.method === 'POST')) {
      const { name, phone, email, source, priority, notes, assigned_to } = body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Lead name is required.' });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const leadCode = `LV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
        const newLeadPayload: any = {
          organization_id: profile.organization_id,
          lead_code: leadCode,
          name: sanitizeText(name),
          phone: phone ? String(phone).trim() : null,
          email: email ? String(email).trim().toLowerCase() : null,
          source: sanitizeText(source || 'Direct'),
          priority: priority || 'MEDIUM',
          status: assigned_to ? 'ASSIGNED' : 'NEW',
          assigned_to: assigned_to || null,
          notes: notes ? sanitizeText(notes) : null,
          calls_count: 0,
        };

        const { data: createdLead, error: insertErr } = await supabase
          .from('leads')
          .insert(newLeadPayload)
          .select('*')
          .single();

        if (insertErr || !createdLead) {
          console.error('[leads/owner] Failed to create lead in Supabase:', insertErr?.message);
          return res.status(500).json({ error: 'Failed to persist new lead.' });
        }

        try {
          await supabase.from('activity_logs').insert({
            organization_id: profile.organization_id,
            user_id: profile.id,
            user_name: profile.full_name,
            user_role: profile.role,
            action: 'LEAD_CREATED',
            entity_type: 'lead',
            entity_id: createdLead.id,
            metadata: { leadCode: createdLead.lead_code, name: createdLead.name },
          });
        } catch {
          // Activity log error handled
        }

        return res.status(201).json({
          success: true,
          lead: createdLead,
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Lead creation requires a configured database.' });
      }
      const created = db.createLead(
        {
          name,
          phone: phone || '',
          email,
          status: assigned_to ? 'ASSIGNED' : 'NEW',
          source: source || 'Direct',
          priority: priority || 'MEDIUM',
          notes,
          assigned_to,
        },
        profile as any
      );

      return res.status(201).json({ success: true, lead: created });
    }

    // 3. Update Lead (owner-update)
    if (route === 'owner-update' || req.method === 'PATCH') {
      const { leadId, updates } = body;
      if (!leadId || !updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'leadId and updates object are required.' });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const safeUpdates: any = {};
        if (updates.status) safeUpdates.status = updates.status;
        if (updates.priority) safeUpdates.priority = updates.priority;
        if (updates.notes !== undefined) safeUpdates.notes = sanitizeText(updates.notes);
        if (updates.assigned_to !== undefined) safeUpdates.assigned_to = updates.assigned_to;
        safeUpdates.updated_at = new Date().toISOString();

        const { data: updatedLead, error: upErr } = await supabase
          .from('leads')
          .update(safeUpdates)
          .eq('id', leadId)
          .eq('organization_id', profile.organization_id)
          .select('*')
          .single();

        if (upErr || !updatedLead) {
          return res.status(500).json({ error: 'Failed to update lead.' });
        }

        return res.status(200).json({ success: true, lead: updatedLead });
      }

      // Offline Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Lead update requires a configured database.' });
      }
      const updated = db.updateLead(leadId, updates, profile as any);
      return res.status(200).json({ success: true, lead: updated });
    }

    return res.status(400).json({ error: 'Unrecognized action.' });
  } catch (error: any) {
    console.error('[leads/owner] Unexpected handler error:', error?.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
