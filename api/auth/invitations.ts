import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import {
  getCanonicalBaseUrl,
  updateServerInvitationStatus,
} from '../_lib/invitationServer.js';

function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user, profile, error: authError } =
      await authenticateServerRequest(req);

    if (authError || !user || !profile) {
      return res.status(401).json({
        error: authError || 'Unauthorized',
      });
    }

    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is not active.' });
    }

    if (!['OWNER', 'ADMIN'].includes(profile.role)) {
      return res.status(403).json({
        error: 'Only organization owners or administrators can manage invitations.',
      });
    }

    if (!isRealSupabaseServerConfigured()) {
      return res.status(503).json({
        error: 'Invitation management requires a configured database.',
      });
    }

    const supabase = getSupabaseServerClient();
    const canonicalBaseUrl = getCanonicalBaseUrl(req);

    // -------------------------------------------------------------
    // GET: List organization invitations
    // -------------------------------------------------------------
    if (req.method === 'GET') {
      let query = supabase
        .from('organization_invitations')
        .select(
          'id, organization_id, full_name, email, invited_by, role, status, token, expires_at, created_at',
        )
        .order('created_at', { ascending: false });

      // Service-role queries bypass RLS, so enforce tenant scope explicitly.
      if (profile.role === 'OWNER') {
        if (!profile.organization_id) {
          return res.status(403).json({
            error: 'Your account is not assigned to an organization.',
          });
        }

        query = query.eq('organization_id', profile.organization_id);
      } else if (profile.role === 'ADMIN' && req.query?.organization_id) {
        query = query.eq('organization_id', req.query.organization_id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Invitation list query failed:', error.code);
        return res.status(500).json({
          error: 'Unable to load invitations from the database.',
        });
      }

      const formatted = (data || []).map((inv: any) => ({
        ...inv,
        fullName: inv.full_name,
        expiresAt: inv.expires_at,
        createdAt: inv.created_at,
        inviteUrl: `${canonicalBaseUrl}/accept-invitation?token=${inv.token}`,
      }));

      return res.status(200).json({
        invitations: formatted,
      });
    }

    // -------------------------------------------------------------
    // DELETE: Revoke pending invitation
    // -------------------------------------------------------------
    const invitationId = req.body?.id;

    if (!isValidId(invitationId)) {
      return res.status(400).json({
        error: 'A valid invitation ID is required.',
      });
    }

    let query = supabase
      .from('organization_invitations')
      .update({ status: 'REVOKED' })
      .eq('id', invitationId)
      .eq('status', 'PENDING');

    if (profile.role === 'OWNER') {
      if (!profile.organization_id) {
        return res.status(403).json({
          error: 'Your account is not assigned to an organization.',
        });
      }

      query = query.eq('organization_id', profile.organization_id);
    }

    const { data, error } = await query
      .select('id, organization_id, full_name, email, status, token')
      .maybeSingle();

    if (error) {
      console.error('Invitation revocation failed:', error.code);
      return res.status(500).json({
        error: 'Unable to revoke the invitation.',
      });
    }

    if (!data) {
      return res.status(404).json({
        error: 'Pending invitation not found or you do not have permission to revoke it.',
      });
    }

    // Sync in-memory fallback store if active
    if (data.token) {
      updateServerInvitationStatus(data.token, 'REVOKED');
    }

    // Audit event logging
    try {
      await supabase.from('security_events').insert({
        organization_id: data.organization_id || profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        event_type: 'INVITATION_REVOKED',
        severity: 'LOW',
        description: `Owner ${profile.full_name} revoked invitation for ${data.full_name || data.email}`,
        metadata: { invitationId: data.id, targetEmail: data.email },
      });

      await supabase.from('activity_logs').insert({
        organization_id: data.organization_id || profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'INVITATION_REVOKED',
        entity_type: 'invitation',
        entity_id: data.id,
        metadata: { targetEmail: data.email },
      });
    } catch {
      // Audit logging failure is non-blocking
    }

    return res.status(200).json({
      success: true,
      invitation: {
        id: data.id,
        status: 'REVOKED',
      },
    });
  } catch (error: any) {
    console.error('Invitation management request failed:', error?.message);
    return res.status(500).json({
      error: 'Invitation management request failed.',
    });
  }
}
