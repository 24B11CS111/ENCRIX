import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';
import { db } from '../../../src/services/supabase/db.js';
import type { DistributionMode } from '../../../src/types/index.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  try {
    // 1. Authenticate Request
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile || !user) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    // 2. Verify account is ACTIVE
    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    // 3. Strictly verify Role: Telecallers are forbidden from distributing leads
    if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Telecallers are not authorized to distribute or assign leads.',
      });
    }

    // GET: Distribution Preview & Workload Stats
    if (req.method === 'GET') {
      const rawLeadIds = req.query?.leadIds;
      const leadIds: string[] = typeof rawLeadIds === 'string'
        ? rawLeadIds.split(',').filter(Boolean)
        : Array.isArray(rawLeadIds)
        ? rawLeadIds
        : [];

      const mode = (req.query?.mode as DistributionMode) || undefined;
      const preview = db.previewDistribution(leadIds, mode, profile as any);
      const eligibleTelecallers = db.getEligibleTelecallers(profile as any).map((tc) => ({
        id: tc.id,
        full_name: tc.full_name,
        role: tc.role,
        status: tc.status,
        open_lead_count: db.getOpenLeadCount(tc.id, profile.organization_id),
      }));

      return res.status(200).json({
        success: true,
        preview,
        eligible_telecallers: eligibleTelecallers,
      });
    }

    // POST: Execute Lead Distribution or Reassignment
    const body = req.body || {};
    const { leadIds, leadId, targetTelecallerId, mode, reason, isReassignment } = body;

    // Handle Single Lead Reassignment
    if (isReassignment) {
      const targetLeadId = leadId || (Array.isArray(leadIds) ? leadIds[0] : null);
      if (!targetLeadId) {
        return res.status(400).json({ error: 'leadId is required for reassignment' });
      }

      if (!targetTelecallerId) {
        return res.status(400).json({ error: 'targetTelecallerId is required for reassignment' });
      }

      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ error: 'Reassignment reason is mandatory' });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const { error: upErr } = await supabase
          .from('leads')
          .update({
            assigned_to: targetTelecallerId,
            status: 'ASSIGNED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', targetLeadId)
          .eq('organization_id', profile.organization_id);

        if (upErr) {
          return res.status(500).json({ error: 'Failed to persist lead reassignment.' });
        }
      } else if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Lead reassignment requires a configured database.' });
      }

      const updatedLead = db.reassignLead(targetLeadId, targetTelecallerId, reason, profile as any);

      // CRITICAL SECURITY INVARIANT: Strip or mask phone from response
      const { phone: _phone, ...sanitizedLead } = updatedLead;

      return res.status(200).json({
        success: true,
        reassigned: true,
        lead: sanitizedLead,
      });
    }

    // Handle Batch Distribution
    const ids: string[] = Array.isArray(leadIds)
      ? leadIds
      : typeof leadId === 'string'
      ? [leadId]
      : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'leadIds array is required' });
    }

    const result = db.distributeLeads(
      {
        leadIds: ids,
        mode,
        targetTelecallerId,
        reason,
        isReassignment: false,
      },
      profile as any
    );

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();
      const updatedLeads = (db.getLeads(profile as any) as any[]).filter(
        (l) => ids.includes(l.id) && l.assigned_to
      );
      for (const lead of updatedLeads) {
        await supabase
          .from('leads')
          .update({
            assigned_to: lead.assigned_to,
            status: 'ASSIGNED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id)
          .eq('organization_id', profile.organization_id);
      }
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Lead distribution requires a configured database.' });
    }

    return res.status(200).json({
      success: result.success,
      result,
    });
  } catch (error: any) {
    console.error('distribute handler error:', error);
    const statusCode = error.message?.includes('Forbidden')
      ? 403
      : error.message?.includes('mandatory') || error.message?.includes('Invalid')
      ? 400
      : 500;
    return res.status(statusCode).json({ error: error.message || 'Internal Server Error' });
  }
}
