import { describe, expect, it } from 'vitest';
import {
  ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF,
  validateFrontendSupabaseBuildEnvironment,
} from '../lib/supabaseProject';
import {
  isRealSupabaseServerConfigured,
  validateProductionSupabaseServerEnvironment,
} from '../../api/_lib/supabaseServer';

const productionUrl = `https://${ENCRIX_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const stagingUrl = 'https://vhqqczgomrznisvbhpvf.supabase.co';

function serviceRoleJwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role' })}.synthetic-signature`;
}

describe('Supabase production environment validation', () => {
  it('accepts the configured production project and canonical service-role key', () => {
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: productionUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt(),
      NODE_ENV: 'production',
    })).toEqual({ valid: true });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: productionUrl,
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
    })).toEqual({ valid: true });
  });

  it('rejects staging as the production backend or frontend project', () => {
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: stagingUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt(),
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'unexpected_project' });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: stagingUrl,
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
    })).toEqual({ valid: false, reason: 'unexpected_project' });
  });

  it('rejects missing canonical backend URL, service-role key, and use of the legacy key', () => {
    expect(validateProductionSupabaseServerEnvironment({
      VITE_SUPABASE_URL: productionUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt(),
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'missing_url' });
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: productionUrl,
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'missing_service_role_key' });
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: productionUrl,
      SUPABASE_SERVICE_KEY: serviceRoleJwt(),
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'legacy_service_key_forbidden' });
  });

  it('rejects malformed URLs, short keys, and non-service-role JWT keys', () => {
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: 'http://wrzoqxesffbfirjgotbr.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt(),
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'unexpected_project' });
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: productionUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'short',
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'invalid_service_role_key' });
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(validateProductionSupabaseServerEnvironment({
      SUPABASE_URL: productionUrl,
      SUPABASE_SERVICE_ROLE_KEY: `${encode({ alg: 'HS256' })}.${encode({ role: 'anon' })}.synthetic-signature`,
      NODE_ENV: 'production',
    })).toEqual({ valid: false, reason: 'invalid_service_role_key' });
  });

  it('requires frontend production variables and refuses mock placeholders', () => {
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {}))
      .toEqual({ valid: false, reason: 'missing_url' });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: productionUrl,
    })).toEqual({ valid: false, reason: 'missing_anon_key' });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: 'https://mock-vault.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
    })).toEqual({ valid: false, reason: 'unexpected_project' });
  });

  it('rejects the demo sandbox in production builds while allowing staging and development modes', () => {
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: productionUrl,
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
      VITE_ENABLE_DEMO_SANDBOX: 'true',
    })).toEqual({ valid: false, reason: 'demo_sandbox_enabled' });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'production', {
      VITE_SUPABASE_URL: productionUrl,
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
      VITE_ENABLE_DEMO_SANDBOX: 'false',
    })).toEqual({ valid: true });
    expect(validateFrontendSupabaseBuildEnvironment('staging', undefined, {
      VITE_ENABLE_DEMO_SANDBOX: 'true',
    })).toEqual({ valid: true });
  });

  it('preserves configured staging builds and development mock behavior', () => {
    expect(validateFrontendSupabaseBuildEnvironment('staging', undefined, {})).toEqual({ valid: true });
    expect(validateFrontendSupabaseBuildEnvironment('development', undefined, {})).toEqual({ valid: true });
    expect(validateFrontendSupabaseBuildEnvironment('production', 'preview', {
      VITE_SUPABASE_URL: stagingUrl,
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-for-production-tests',
    })).toEqual({ valid: true });
    expect(isRealSupabaseServerConfigured({
      SUPABASE_URL: stagingUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-staging-service-key',
      NODE_ENV: 'development',
    })).toBe(true);
    expect(isRealSupabaseServerConfigured({
      SUPABASE_URL: stagingUrl,
      SUPABASE_SERVICE_KEY: 'synthetic-staging-service-key',
      NODE_ENV: 'development',
    })).toBe(true);
  });
});
