import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../supabaseServer.js';

const ALLOWED_STATUSES = new Set([
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'INTERESTED',
  'FOLLOW_UP',
  'CONVERTED',
  'NOT_INTERESTED',
  'INVALID',
  'DO_NOT_CONTACT',
]);

const SAFE_LEAD_FIELDS = [
  'id', 'organization_id', 'lead_code', 'name', 'email', 'source', 'status',
  'priority', 'assigned_to', 'notes', 'last_contacted_at', 'calls_count',
  'created_at', 'updated_at',
];

function projectLead(row: Record<string, unknown>) {
  // Defensive allowlist in addition to the fixed database function return type.
  return Object.fromEntries(SAFE_LEAD_FIELDS.map((field) => [field, row[field]]));
}

async function authorize(req: any, res: any) {
  const { user, profile, error } = await authenticateServerRequest(req);
  if (error || !user || !profile) {
    res.status(401).json({ error: 'Authentication is required.' });
    return null;
  }
  if (
    profile.status !== 'ACTIVE' ||
    profile.role !== 'TELECALLER' ||
    !profile.id ||
    !profile.organization_id ||
    !profile.user_id ||
    user.id !== profile.user_id
  ) {
    res.status(403).json({ error: 'An active telecaller account is required.' });
    return null;
  }
  if (!isRealSupabaseServerConfigured()) {
    res.status(503).json({ error: 'Secure lead access is unavailable.' });
    return null;
  }
  return profile;
}

export default async function handler(req: any, res: any) {
  const route = req.query?._route;
  const isUpdate = route === 'telecaller-update';
  if ((!isUpdate && route !== 'telecaller-list') || (isUpdate ? req.method !== 'POST' : req.method !== 'GET')) {
    res.setHeader?.('Allow', isUpdate ? 'POST' : 'GET');
    return res.status(isUpdate || route === 'telecaller-list' ? 405 : 404)
      .json({ error: 'Method Not Allowed.' });
  }

  try {
    const profile = await authorize(req, res);
    if (!profile) return;
    const supabase = getSupabaseServerClient();
    const identity = {
      p_user_id: profile.user_id,
      p_profile_id: profile.id,
      p_organization_id: profile.organization_id,
    };

    if (!isUpdate) {
      const { data, error } = await supabase.rpc('server_get_assigned_telecaller_leads', identity);
      if (error || !Array.isArray(data)) {
        return res.status(503).json({ error: 'Assigned leads could not be loaded.' });
      }
      return res.status(200).json({ leads: data.map(projectLead) });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Malformed JSON payload.' });
      }
    }
    body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const allowedBodyKeys = new Set(['leadId', 'status', 'notes']);
    if (Object.keys(body).some((key) => !allowedBodyKeys.has(key))) {
      return res.status(400).json({ error: 'Only leadId, status, and notes are accepted.' });
    }
    if (
      typeof body.leadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.leadId) ||
      typeof body.status !== 'string' || !ALLOWED_STATUSES.has(body.status) ||
      typeof body.notes !== 'string' || body.notes.length > 10000
    ) {
      return res.status(400).json({ error: 'Valid lead update fields are required.' });
    }

    const { data: updated, error: updateError } = await supabase.rpc(
      'server_update_assigned_telecaller_lead',
      {
        ...identity,
        p_lead_id: body.leadId,
        p_status: body.status,
        p_notes: body.notes,
      }
    );
    if (updateError || updated !== true) {
      return res.status(404).json({ error: 'This lead could not be updated.' });
    }

    const { data: rows, error: readError } = await supabase.rpc(
      'server_get_assigned_telecaller_leads',
      identity
    );
    if (readError || !Array.isArray(rows)) {
      return res.status(503).json({ error: 'The update was saved, but the lead could not be refreshed.' });
    }
    const lead = rows.find((row: Record<string, unknown>) => row.id === body.leadId);
    if (!lead) {
      return res.status(404).json({ error: 'This lead could not be refreshed.' });
    }
    return res.status(200).json({ lead: projectLead(lead) });
  } catch {
    return res.status(500).json({ error: 'Lead request failed.' });
  }
}
