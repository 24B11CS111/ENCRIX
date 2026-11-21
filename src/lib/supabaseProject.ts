export const ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF = 'wrzoqxesffbfirjgotbr';

export interface FrontendSupabaseEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ENABLE_DEMO_SANDBOX?: string;
}

export interface FrontendSupabaseBuildValidation {
  valid: boolean;
  reason?: 'missing_url' | 'missing_anon_key' | 'malformed_url' | 'unexpected_project' | 'demo_sandbox_enabled';
}

/** Returns only the project ref; callers must never include the original URL in errors. */
export function getSupabaseProjectRef(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null;

  try {
    const parsed = new URL(value);
    const match = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    if (
      parsed.protocol !== 'https:' ||
      !match ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search ||
      parsed.hash
    ) return null;
    return match[1].toLowerCase();
  } catch {
    return null;
  }
}

function hasUsableAnonKey(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 20) return false;
  return !/(placeholder|mock|dummy|example|your[-_ ]|change[-_ ]?me)/i.test(value);
}

/**
 * Validates Vite build inputs without returning or logging their values.
 * Production Vercel builds must target ENCRIX production; Preview builds may
 * use their separately configured Supabase project, but still need real inputs.
 */
export function validateFrontendSupabaseBuildEnvironment(
  mode: string,
  vercelEnvironment: string | undefined,
  env: FrontendSupabaseEnvironment,
): FrontendSupabaseBuildValidation {
  if (mode !== 'production') return { valid: true };
  if (env.VITE_ENABLE_DEMO_SANDBOX === 'true') {
    return { valid: false, reason: 'demo_sandbox_enabled' };
  }
  if (!env.VITE_SUPABASE_URL) return { valid: false, reason: 'missing_url' };
  if (!hasUsableAnonKey(env.VITE_SUPABASE_ANON_KEY)) return { valid: false, reason: 'missing_anon_key' };

  const projectRef = getSupabaseProjectRef(env.VITE_SUPABASE_URL);
  if (!projectRef) return { valid: false, reason: 'malformed_url' };
  if (vercelEnvironment !== 'preview' && projectRef !== ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF) {
    return { valid: false, reason: 'unexpected_project' };
  }
  return { valid: true };
}
