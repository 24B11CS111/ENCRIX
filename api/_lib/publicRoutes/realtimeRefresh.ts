import { authenticateServerRequest, getSupabaseServerClient } from '../supabaseServer.js';
import { requirePaidEntitlement } from '../paidEntitlement.js';

/** Return only the lead refresh revision for the identity resolved from its bearer token. */
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { profile, error } = await authenticateServerRequest(req);
    if (error || !profile) return res.status(401).json({ error: error || 'Unauthorized' });
    if (profile.status !== 'ACTIVE') return res.status(403).json({ error: 'Active account required.' });
    if (!profile.organization_id || !['OWNER', 'ADMIN', 'TELECALLER'].includes(profile.role)) {
      return res.status(403).json({ error: 'This account cannot receive lead refresh signals.' });
    }
    if (!await requirePaidEntitlement(res, profile)) return;

    const supabase = getSupabaseServerClient();
    let query = supabase
      .from('lead_refresh_signals')
      .select('revision')
      .eq('organization_id', profile.organization_id);
    if (profile.role === 'TELECALLER') {
      query = query.eq('recipient_profile_id', profile.id);
    } else {
      query = query.is('recipient_profile_id', null);
    }

    const { data, error: queryError } = await query.maybeSingle();
    if (queryError) return res.status(503).json({ error: 'Lead refresh state is temporarily unavailable.' });

    const revision = data?.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      return res.status(503).json({ error: 'Lead refresh state is invalid.' });
    }

    res.setHeader?.('Cache-Control', 'no-store, private');
    return res.status(200).json({ revision });
  } catch {
    return res.status(503).json({ error: 'Lead refresh state is temporarily unavailable.' });
  }
}
