
import { createClient } from '@supabase/supabase-js';
import { ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF, getSupabaseProjectRef } from '../../src/lib/supabaseProject.js';

type ServerEnvironment = NodeJS.ProcessEnv;

function isProductionEnvironment(env: ServerEnvironment): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production';
  return env.NODE_ENV === 'production' || env.VITE_APP_ENV === 'production';
}

function getSupabaseUrl(env: ServerEnvironment = process.env): string {
  if (isProductionEnvironment(env)) return env.SUPABASE_URL || '';
  return env.SUPABASE_URL || env.VITE_SUPABASE_URL || '';
}

function getSupabaseServiceRoleKey(env: ServerEnvironment = process.env): string {
  if (isProductionEnvironment(env)) return env.SUPABASE_SERVICE_ROLE_KEY || '';
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
}

function hasUsableSecret(value: string): boolean {
  return value.length >= 20 && value.trim() === value &&
    !/(placeholder|mock|dummy|example|your[-_ ]|change[-_ ]?me)/i.test(value);
}

function isProductionServiceRoleKey(value: string): boolean {
  if (!hasUsableSecret(value)) return false;
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(value)) return true;

  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export type ProductionSupabaseConfigurationResult =
  | { valid: true }
  | { valid: false; reason: 'missing_url' | 'unexpected_project' | 'missing_service_role_key' | 'invalid_service_role_key' | 'legacy_service_key_forbidden' };

/** Validation result contains only a reason code and never includes configuration values. */
export function validateProductionSupabaseServerEnvironment(
  env: ServerEnvironment,
): ProductionSupabaseConfigurationResult {
  if (!env.SUPABASE_URL) return { valid: false, reason: 'missing_url' };
  const projectRef = getSupabaseProjectRef(env.SUPABASE_URL);
  if (!projectRef || projectRef !== ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF) {
    return { valid: false, reason: 'unexpected_project' };
  }
  if (env.SUPABASE_SERVICE_KEY) return { valid: false, reason: 'legacy_service_key_forbidden' };
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { valid: false, reason: 'missing_service_role_key' };
  if (!isProductionServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return { valid: false, reason: 'invalid_service_role_key' };
  }
  return { valid: true };
}

export const isRealSupabaseServerConfigured = (env: ServerEnvironment = process.env) => {
  if (isProductionEnvironment(env)) {
    const validation = validateProductionSupabaseServerEnvironment(env);
    return validation.valid;
  }

  const url = getSupabaseUrl(env);
  const key = getSupabaseServiceRoleKey(env);
  return Boolean(getSupabaseProjectRef(url)) && hasUsableSecret(key);
};

export const getSupabaseServerClient = () => {
  if (!isRealSupabaseServerConfigured()) {
    throw new Error('Secure Supabase server configuration is unavailable.');
  }

  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};


import { verifySignedSessionToken } from './sessionServer.js';

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
      if (!sessionPayload.sessionId) {
        return { user: null, profile: null, error: 'Invalid or expired auth token' };
      }
      const { data: sessionRevoked, error: revocationError } = await supabase.rpc(
        'is_server_session_revoked',
        { p_session_id: sessionPayload.sessionId },
      );
      if (revocationError || typeof sessionRevoked !== 'boolean') {
        return {
          user: null,
          profile: null,
          error: 'Unable to verify the current account status',
        };
      }
      if (sessionRevoked) {
        return { user: null, profile: null, error: 'Invalid or expired auth token' };
      }

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
