import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import { db } from '../../src/services/supabase/db.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, PATCH, POST');
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
        error: 'Forbidden: Only organization owners or administrators can manage team members.',
      });
    }

    // -------------------------------------------------------------------------
    // GET: List Organization Telecallers
    // -------------------------------------------------------------------------
    if (req.method === 'GET') {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, user_id, organization_id, full_name, email, phone, role, status, phone_verified, email_verified, created_at, updated_at'
          )
          .eq('organization_id', profile.organization_id)
          .eq('role', 'TELECALLER')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[auth/team] Error fetching telecallers:', error.message);
          return res.status(500).json({ error: 'Failed to load team members from database.' });
        }

        return res.status(200).json({
          success: true,
          telecallers: data || [],
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Team member management requires a configured database.' });
      }
      const telecallers = db
        .getProfiles(profile as any)
        .filter((p) => p.role === 'TELECALLER');

      return res.status(200).json({
        success: true,
        telecallers,
      });
    }

    // -------------------------------------------------------------------------
    // PATCH / POST: Update Telecaller Status (ACTIVE / DISABLED)
    // -------------------------------------------------------------------------
    const body = req.body || {};
    const telecallerId = body.telecallerId || body.id;
    const nextStatus = body.status;

    if (!telecallerId || typeof telecallerId !== 'string') {
      return res.status(400).json({ error: 'telecallerId is required.' });
    }

    if (!nextStatus || !['ACTIVE', 'DISABLED'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Valid status (ACTIVE or DISABLED) is required.' });
    }

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();

      const { data: updatedProfile, error: updateErr } = await supabase
        .from('profiles')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', telecallerId)
        .eq('organization_id', profile.organization_id)
        .eq('role', 'TELECALLER')
        .select('*')
        .maybeSingle();

      if (updateErr) {
        console.error('[auth/team] Error updating telecaller status:', updateErr.message);
        return res.status(500).json({ error: 'Failed to update telecaller status.' });
      }

      if (!updatedProfile) {
        return res.status(404).json({
          error: 'Telecaller not found in your organization.',
        });
      }

      try {
        await supabase.from('security_events').insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'TELECALLER_STATUS_CHANGED',
          severity: 'MEDIUM',
          description: `Owner ${profile.full_name} changed telecaller ${updatedProfile.full_name} status to ${nextStatus}`,
          metadata: { targetId: telecallerId, nextStatus },
        });
      } catch {
        // Non-blocking logging
      }

      return res.status(200).json({
        success: true,
        telecaller: updatedProfile,
      });
    }

    // Offline / Test Fallback
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Team member status updates require a configured database.' });
    }
    db.updateProfileStatus(telecallerId, nextStatus, profile as any);
    const updated = db.getProfiles(profile as any).find((p) => p.id === telecallerId);

    return res.status(200).json({
      success: true,
      telecaller: updated,
    });
  } catch (error: any) {
    console.error('[auth/team] Unexpected error:', error?.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
