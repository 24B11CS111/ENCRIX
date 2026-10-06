import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://prod-leadvault.supabase.co';

const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

/**
 * Returns a secure server-side Supabase client equipped with service-role permissions.
 * This client runs strictly within serverless execution environments and is NEVER bundled to the browser.
 */
export const getSupabaseServerClient = () => {
  return createClient(supabaseUrl, supabaseServiceRoleKey || 'service-role-placeholder', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

export interface AuthContext {
  user: { id: string; email?: string } | null;
  profile: {
    id: string;
    user_id: string;
    organization_id: string;
    full_name: string;
    role: 'ADMIN' | 'OWNER' | 'TELECALLER';
    status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  } | null;
  error: string | null;
}

/**
 * Validates the caller's JWT token from the Authorization header and loads their tenant profile.
 */
export async function authenticateServerRequest(req: any): Promise<AuthContext> {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { user: null, profile: null, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const supabase = getSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return { user: null, profile: null, error: authError?.message || 'Invalid auth token' };
  }

  const { data: profile, error: profError } = await supabase
    .from('profiles')
    .select('id, user_id, organization_id, full_name, role, status')
    .eq('user_id', user.id)
    .single();

  if (profError || !profile) {
    return { user, profile: null, error: 'Profile not found' };
  }

  return { user, profile, error: null };
}
