import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';
import { db } from '../../../src/services/supabase/db.js';
import { sanitizeText } from '../../../src/lib/validation.js';
import { requirePaidEntitlement } from '../paidEntitlement.js';

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
    if (req.method === 'GET') {
      if (!await requirePaidEntitlement(res, profile)) return;
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

    // CSV imports use the existing owner endpoint and a dedicated transactional RPC.
    if (req.method === 'POST' && body.action === 'import') {
      if (!isRealSupabaseServerConfigured()) {
        return res.status(503).json({ error: 'Lead import requires a configured database.' });
      }
      if (
        typeof body.importId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.importId) ||
        !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 100
      ) {
        return res.status(400).json({ error: 'A valid importId and 1–100 rows are required.' });
      }

      const seenIndexes = new Set<number>();
      const seenPhones = new Set<string>();
      const rejectedRows: Array<{ rowIndex: number; reason: string }> = [];
      const duplicateRowIndexes: number[] = [];
      const validRows: Array<Record<string, unknown>> = [];

      for (const row of body.rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          return res.status(400).json({ error: 'Each import row must be an object.' });
        }
        const rowIndex = row.rowIndex;
        if (!Number.isSafeInteger(rowIndex) || rowIndex < 1 || seenIndexes.has(rowIndex)) {
          return res.status(400).json({ error: 'Each import row must have a unique positive rowIndex.' });
        }
        seenIndexes.add(rowIndex);

        const name = typeof row.name === 'string' ? sanitizeText(row.name).trim() : '';
        const rawPhone = typeof row.phone === 'string' ? row.phone.trim() : '';
        const phone = rawPhone.startsWith("'+") ? rawPhone.slice(1) : rawPhone.startsWith('+') ? rawPhone : sanitizeText(rawPhone).trim();
        const digits = phone.replace(/\D/g, '');
        if (!name || name.length > 255) {
          rejectedRows.push({ rowIndex, reason: 'Name is required and must be 255 characters or fewer.' });
          continue;
        }
        if (!phone || phone.length > 50 || digits.length < 10 || !/^\+?[0-9\s().-]+$/.test(phone)) {
          rejectedRows.push({ rowIndex, reason: 'Phone must be 50 characters or fewer, use a valid dialing format, and contain at least 10 digits.' });
          continue;
        }
        if (row.email !== undefined && row.email !== null && (typeof row.email !== 'string' || row.email.length > 255)) {
          rejectedRows.push({ rowIndex, reason: 'Email must be 255 characters or fewer.' });
          continue;
        }
        if (row.source !== undefined && row.source !== null && (typeof row.source !== 'string' || row.source.length > 100)) {
          rejectedRows.push({ rowIndex, reason: 'Source must be 100 characters or fewer.' });
          continue;
        }
        if (row.notes !== undefined && row.notes !== null && (typeof row.notes !== 'string' || row.notes.length > 10000)) {
          rejectedRows.push({ rowIndex, reason: 'Notes must be text and 10,000 characters or fewer.' });
          continue;
        }
        const priority = typeof row.priority === 'string' ? row.priority.toUpperCase() : 'MEDIUM';
        if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) {
          rejectedRows.push({ rowIndex, reason: 'Priority is invalid.' });
          continue;
        }
        if (seenPhones.has(digits)) {
          duplicateRowIndexes.push(rowIndex);
          continue;
        }
        seenPhones.add(digits);
        validRows.push({
          row_index: rowIndex,
          name,
          phone,
          email: typeof row.email === 'string' ? row.email.trim().toLowerCase() || null : null,
          source: typeof row.source === 'string' ? sanitizeText(row.source).slice(0, 100) : 'CSV Import',
          priority,
          notes: typeof row.notes === 'string' ? sanitizeText(row.notes) : 'Imported via CSV/XLSX wizard',
        });
      }

      if (validRows.length === 0) {
        return res.status(200).json({
          success: true,
          importedCount: 0,
          duplicateRowIndexes,
          rejectedRows,
          distribution: null,
        });
      }

      if (!await requirePaidEntitlement(res, profile)) return;

      try {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase.rpc('import_owner_leads', {
          p_organization_id: profile.organization_id,
          p_actor_profile_id: profile.id,
          p_import_id: body.importId,
          p_rows: validRows,
        });
        if (error || !data || typeof data !== 'object') {
          if (error?.code === '42501') return res.status(403).json({ error: 'Owner authorization could not be verified.' });
          console.error('[leads/owner] CSV import RPC failed:', error?.message);
          return res.status(503).json({ error: 'Lead import could not be saved. Retry safely using the same import.' });
        }
        return res.status(200).json({
          success: true,
          importedCount: Number((data as any).imported_count) || 0,
          duplicateRowIndexes: [...duplicateRowIndexes, ...((data as any).duplicate_row_indexes || [])],
          rejectedRows,
          distribution: (data as any).distribution || null,
        });
      } catch (error: any) {
        console.error('[leads/owner] CSV import failed:', error?.message);
        return res.status(503).json({ error: 'Lead import could not be saved. Retry safely using the same import.' });
      }
    }

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
        if (!await requirePaidEntitlement(res, profile, supabase)) return;

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
      if (!await requirePaidEntitlement(res, profile)) return;
      const count = db.assignLeads(leadIds, telecallerId, profile as any);
      return res.status(200).json({ success: true, assigned_count: count });
    }

    // 2. Create Lead (owner-create)
    if (route === 'owner-create' || body.action === 'create' || (!route && req.method === 'POST')) {
      const { name, phone, email, source, priority, notes, assigned_to } = body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Lead name is required.' });
      }
      if (!await requirePaidEntitlement(res, profile)) return;

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const { data, error: createErr } = await supabase.rpc('create_owner_lead', {
          p_organization_id: profile.organization_id,
          p_actor_profile_id: profile.id,
          p_name: sanitizeText(name),
          p_phone: phone ? String(phone).trim() : null,
          p_email: email ? String(email).trim().toLowerCase() : null,
          p_source: sanitizeText(source || 'Direct'),
          p_priority: typeof priority === 'string' ? priority.toUpperCase() : 'MEDIUM',
          p_notes: notes ? sanitizeText(notes) : null,
          p_assigned_to: assigned_to || null,
        });

        if (createErr || !data || typeof data !== 'object' || !(data as any).lead) {
          if (createErr?.code === '23505') return res.status(409).json({ error: 'A lead with this phone number already exists in your organization.' });
          if (createErr?.code === '42501') return res.status(403).json({ error: 'Lead creation authorization could not be verified.' });
          if (createErr?.code === '22023') return res.status(400).json({ error: 'Lead details are invalid. Check the phone, priority and field lengths.' });
          console.error('[leads/owner] Failed to create lead through RPC:', createErr?.message);
          return res.status(500).json({ error: 'Failed to persist new lead.' });
        }
        const createdLead = (data as any).lead;

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

      if (!isRealSupabaseServerConfigured()) {
        await requirePaidEntitlement(res, profile);
        return;
      }
      const accessDb = getSupabaseServerClient();
      const { data: existingLead, error: leadLookupError } = await accessDb
        .from('leads').select('id').eq('id', leadId).eq('organization_id', profile.organization_id).maybeSingle();
      if (leadLookupError) return res.status(503).json({ error: 'Lead authorization is temporarily unavailable.' });
      if (!existingLead) return res.status(404).json({ error: 'Lead not found or unauthorized.' });
      if (!await requirePaidEntitlement(res, profile, accessDb)) return;

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
