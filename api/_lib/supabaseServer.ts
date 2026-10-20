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

export const isRealSupabaseServerConfigured = () => {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseServiceRoleKey) &&
    !supabaseUrl.includes('placeholder') &&
    !supabaseUrl.includes('mock') &&
    !supabaseUrl.includes('sb-mock-vault') &&
    !supabaseServiceRoleKey.includes('placeholder') &&
    !supabaseServiceRoleKey.includes('mock')
  );
};

import { verifySignedSessionToken } from './sessionServer';

export interface AuthContext {
  user: { id: string; email?: string } | null;
  profile: {
    id: string;
    user_id: string;
    organization_id: string;
    full_name: string;
    role: 'ADMIN' | 'OWNER' | 'TELECALLER';
    status: 'ACTIVE' | 'DISABLED' | 'PENDING' | 'PENDING_VERIFICATION' | 'SUSPENDED';
    phone_verified?: boolean;
    email?: string;
  } | null;
  error: string | null;
}

/**
 * Validates the caller's JWT token or server-signed session token from the Authorization header
 * and resolves their tenant profile.
 */
export async function authenticateServerRequest(req: any): Promise<AuthContext> {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { user: null, profile: null, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 1. Check server-signed cryptographic HMAC-SHA256 session token first
  const sessionPayload = verifySignedSessionToken(token);
  if (sessionPayload) {
    if (!isRealSupabaseServerConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        return {
          user: null,
          profile: null,
          error: 'Server authentication is unavailable',
        };
      }
      return {
        user: { id: sessionPayload.userId, email: sessionPayload.email },
        profile: {
          id: sessionPayload.profileId,
          user_id: sessionPayload.userId,
          organization_id: sessionPayload.organizationId,
          full_name: sessionPayload.fullName,
          role: sessionPayload.role,
          status: sessionPayload.status || 'ACTIVE',
          phone_verified: true,
          email: sessionPayload.email,
        },
        error: null,
      };
    }

    const supabase = getSupabaseServerClient();
    try {
      const { data: dbProfile, error: profError } = await supabase
        .from('profiles')
        .select('id, user_id, organization_id, full_name, role, status, phone_verified, email')
        .eq('id', sessionPayload.profileId)
        .single();

      if (profError || !dbProfile || dbProfile.user_id !== sessionPayload.userId) {
        return {
          user: null,
          profile: null,
          error: 'Unable to verify the current account status',
        };
      }
      if (dbProfile.status !== 'ACTIVE') {
        return {
          user: { id: dbProfile.user_id, email: dbProfile.email || sessionPayload.email },
          profile: dbProfile,
          error: 'User account is inactive or suspended',
        };
      }
      return {
        user: { id: dbProfile.user_id, email: dbProfile.email || sessionPayload.email },
        profile: dbProfile,
        error: null,
      };
    } catch {
      return {
        user: { id: sessionPayload.userId, email: sessionPayload.email },
        profile: null,
        error: 'Unable to verify the current account status',
      };
    }
  }

  if (!isRealSupabaseServerConfigured()) {
    return { user: null, profile: null, error: 'Invalid or expired auth token' };
  }

  // 2. Fallback to Supabase Auth JWT token
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
    .select('id, user_id, organization_id, full_name, role, status, email')
    .eq('user_id', user.id)
    .single();

  if (profError || !profile) {
    return { user, profile: null, error: 'Profile not found' };
  }

  if (profile.status !== 'ACTIVE') {
    return { user, profile, error: 'User account is inactive or suspended' };
  }

  return { user, profile, error: null };
}
