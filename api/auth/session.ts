import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import { revokeSession } from '../_lib/sessionServer.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      const { user, profile, error: authError } = await authenticateServerRequest(req);
      if (authError || !profile || !user) {
        return res.status(401).json({ authenticated: false, error: authError || 'Unauthorized' });
      }

      if (profile.status !== 'ACTIVE') {
        return res.status(403).json({
          authenticated: false,
          error: 'Forbidden: Account has been suspended or deactivated',
        });
      }

      let organization: any = null;

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        try {
          const { data: orgData, error: orgErr } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', profile.organization_id)
            .single();

          if (!orgErr && orgData) {
            organization = orgData;
          }
        } catch {
          // Fallback
        }
      }

      if (!organization) {
        organization = {
          id: profile.organization_id,
          name: 'ENCRIX Organization',
          status: 'ACTIVE',
        };
      }

      return res.status(200).json({
        authenticated: true,
        user,
        profile,
        organization,
        role: profile.role,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Session verification failed' });
    }
  }

  if (req.method === 'DELETE' || req.method === 'POST') {
    // Explicit session revocation / logout
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      revokeSession(token);
    }

    return res.status(200).json({ success: true, message: 'Session revoked successfully' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
