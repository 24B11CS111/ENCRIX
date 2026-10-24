import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';
import { db } from '../../../src/services/supabase/db.js';
import type { DistributionMode } from '../../../src/types/index.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET, POST, or PUT.' });
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

    // 3. Verify Role: Strictly forbid Telecallers from distribution configuration
    if (profile.role !== 'OWNER' && profile.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Telecallers are not authorized to view or modify distribution configuration.',
      });
    }

    const orgId = profile.organization_id;

    // GET: Retrieve configuration
    if (req.method === 'GET') {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('distribution_configs')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle();

        if (error) {
          return res.status(500).json({ error: 'Database error reading configuration' });
        }

        if (!data) {
          // Create default
          const defaultConfig = {
            id: `dist-cfg-${orgId}`,
            organization_id: orgId,
            mode: 'MANUAL',
            enabled_for_import: false,
            max_workload: null,
            eligible_telecaller_ids: [],
            round_robin_index: 0,
            updated_at: new Date().toISOString(),
          };
          await supabase.from('distribution_configs').insert(defaultConfig);
          return res.status(200).json({ success: true, config: defaultConfig });
        }

        return res.status(200).json({ success: true, config: data });
      } else {
        const config = db.getDistributionConfig(profile as any);
        return res.status(200).json({ success: true, config });
      }
    }

    // POST / PUT: Update configuration
    const updates = req.body || {};

    if (updates.mode) {
      const validModes: DistributionMode[] = ['MANUAL', 'ROUND_ROBIN', 'WORKLOAD_BALANCED'];
      if (!validModes.includes(updates.mode)) {
        return res.status(400).json({ error: `Invalid distribution mode: ${updates.mode}` });
      }
    }

    if (updates.max_workload !== undefined && updates.max_workload !== null) {
      const val = Number(updates.max_workload);
      if (!Number.isInteger(val) || val <= 0) {
        return res.status(400).json({ error: 'max_workload must be a positive integer or null' });
      }
      updates.max_workload = val;
    }

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();
      const updatedFields: any = {
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      };
      if (updates.mode !== undefined) updatedFields.mode = updates.mode;
      if (updates.enabled_for_import !== undefined) updatedFields.enabled_for_import = updates.enabled_for_import;
      if (updates.max_workload !== undefined) updatedFields.max_workload = updates.max_workload;
      if (updates.eligible_telecaller_ids !== undefined) updatedFields.eligible_telecaller_ids = updates.eligible_telecaller_ids;

      const { data, error } = await supabase
        .from('distribution_configs')
        .upsert({ organization_id: orgId, ...updatedFields }, { onConflict: 'organization_id' })
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: 'Failed to update distribution configuration' });
      }

      return res.status(200).json({ success: true, config: data });
    } else {
      const updated = db.updateDistributionConfig(updates, profile as any);
      return res.status(200).json({ success: true, config: updated });
    }
  } catch (error: any) {
    console.error('distribution-config handler error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
