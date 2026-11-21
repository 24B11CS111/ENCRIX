import { createClient } from '@supabase/supabase-js';
import { getSupabaseProjectRef } from '@/lib/supabaseProject';

const isProductionBuild = import.meta.env.MODE === 'production';
const expectedProductionProjectRef = __ENCRIX_EXPECTED_SUPABASE_PROJECT_REF__;
const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (isProductionBuild && (!configuredSupabaseUrl || !configuredSupabaseAnonKey)) {
  throw new Error('Production Supabase browser configuration is incomplete.');
}

const supabaseUrl = configuredSupabaseUrl || (isProductionBuild ? '' : 'https://mock-vault.supabase.co');
const supabaseAnonKey = configuredSupabaseAnonKey || (isProductionBuild ? '' : 'mock-anon-key-leadvault-2026');
const supabaseProjectRef = getSupabaseProjectRef(supabaseUrl);

if (isProductionBuild && !supabaseProjectRef) {
  throw new Error('Production Supabase browser URL is invalid.');
}
if (expectedProductionProjectRef && supabaseProjectRef !== expectedProductionProjectRef) {
  throw new Error('Production Supabase browser URL targets an unexpected project.');
}

export const isRealSupabaseConfigured = () => {
  return (
    Boolean(supabaseProjectRef) &&
    Boolean(supabaseAnonKey) &&
    !supabaseUrl.includes('mock-vault') &&
    !supabaseUrl.includes('your-project')
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
