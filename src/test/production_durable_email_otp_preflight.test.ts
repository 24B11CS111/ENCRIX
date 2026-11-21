import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const repair = readFileSync(resolve(root, 'supabase/tests/repair_production_durable_email_otp.sql'), 'utf8');
const preflight = readFileSync(resolve(root, 'supabase/tests/preflight_production_durable_email_otp.sql'), 'utf8');
const singleResultPreflight = readFileSync(resolve(root, 'supabase/tests/preflight_production_durable_email_otp_single_result.sql'), 'utf8');
const uuidDiagnostic = readFileSync(resolve(root, 'supabase/tests/verify_production_email_otps_uuid_default.sql'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20261031150000_durable_email_otp_attempts.sql'), 'utf8');

describe('production durable email OTP repair guards', () => {
  it('bounds the ACCESS EXCLUSIVE lock wait inside the repair transaction', () => {
    const beginIndex = repair.indexOf('BEGIN;');
    const timeoutStatement = "SET LOCAL lock_timeout = '5s';";
    const timeoutIndex = repair.indexOf(timeoutStatement);
    const lockStatement = 'LOCK TABLE public.email_otps IN ACCESS EXCLUSIVE MODE;';
    const lockIndex = repair.indexOf(lockStatement);

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(timeoutIndex).toBeGreaterThan(beginIndex);
    expect(lockIndex).toBeGreaterThan(timeoutIndex);
    expect(repair.slice(timeoutIndex + timeoutStatement.length, lockIndex).trim()).toBe('');
  });

  it('compares the complete purpose constraint expression, not token fragments', () => {
    const exactExpression = "check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))";
    expect(repair).toContain('pg_catalog.pg_get_constraintdef(c.oid, false)');
    expect(repair).toContain('v_purpose_constraint_definition IS DISTINCT FROM');
    expect(repair).toContain(exactExpression);
    expect(preflight).toContain('pg_catalog.pg_get_constraintdef(c.oid, false)');
    expect(preflight).toContain('c.normalized_definition IS DISTINCT FROM');
    expect(preflight).toContain(exactExpression);
    expect(repair).not.toMatch(/strpos\([^\n]*pg_get_constraintdef[^\n]*(LOGIN|REGISTER|INVITATION)/i);
  });

  it('accepts the confirmed PostgreSQL deparse after whitespace normalization and rejects a changed allowed value', () => {
    const normalizeConstraint = (definition: string) => definition.toLowerCase().replace(/\s+/g, '');
    const expected = "check(((purpose)::text = any ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'INVITATION'::character varying])::text[])))";
    const confirmedProductionDefinition = "CHECK (((purpose)::text = ANY ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'INVITATION'::character varying])::text[])))";
    const differentAllowedValueDefinition = "CHECK (((purpose)::text = ANY ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'RECOVERY'::character varying])::text[])))";

    expect(normalizeConstraint(confirmedProductionDefinition)).toBe(normalizeConstraint(expected));
    expect(normalizeConstraint(differentAllowedValueDefinition)).not.toBe(normalizeConstraint(expected));
  });

  it('guards the complete 080000 base contract and all required privileges', () => {
    for (const column of ['id', 'email', 'purpose', 'otp_hash', 'attempts', 'resend_after', 'expires_at', 'used', 'created_at']) {
      expect(repair).toContain(`'${column}'`);
      expect(preflight).toContain(`'${column}'`);
    }
    expect(repair).toContain('v_base_column_count <> 9');
    expect(repair).toContain("c.conkey = ARRAY[(SELECT a.attnum");
    expect(repair).toContain("pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')");
    expect(repair).toContain("e.extname = 'uuid-ossp'");
    expect(repair).toContain("en.nspname = 'extensions'");
    expect(repair).toContain("ed.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass");
    expect(repair).toContain("ed.objid = p.oid");
    expect(repair).toContain("ed.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass");
    expect(repair).toContain('ed.refobjid = e.oid');
    expect(repair).toContain("ed.deptype = 'e'");
    expect(repair).toContain('relrowsecurity');
    expect(repair).toContain("p.policyname = 'Service role only access to email_otps'");
    expect(repair).toContain("has_schema_privilege('service_role', 'public', 'USAGE')");
    expect(repair).toContain("has_schema_privilege(current_user, 'public', 'CREATE')");
    expect(repair).toContain("has_schema_privilege(current_user, 'public', 'USAGE')");
    expect(repair).toContain("has_schema_privilege(current_user, 'extensions', 'USAGE')");
    expect(repair).toContain("has_function_privilege(current_user, v_id_default_oid, 'EXECUTE')");
    expect(repair).toContain("has_table_privilege(current_user, v_table_oid, 'SELECT')");
    expect(repair).toContain("has_table_privilege(current_user, v_table_oid, 'INSERT')");
    expect(repair).toContain("has_table_privilege(current_user, v_table_oid, 'UPDATE')");
    expect(repair).toContain('r.rolname = current_user OR r.rolsuper');
  });

  it('fails closed on history conflicts and partially existing durable objects', () => {
    expect(repair).toContain("to_regclass('supabase_migrations.schema_migrations') IS NULL");
    expect(repair).toContain("WHERE version = '20261031150000'");
    expect(repair).toContain("attname IN ('ticket_id','verified_at')");
    expect(repair).toContain("c.relname = 'email_otps_ticket_id_uidx'");
    expect(repair).toContain("p.proname IN ('issue_email_otp_ticket'");
    expect(repair).toContain('CREATE FUNCTION public.issue_email_otp_ticket');
    expect(repair).not.toContain('CREATE OR REPLACE FUNCTION');
    expect(repair).not.toMatch(/INSERT\s+INTO\s+supabase_migrations/i);
    expect(repair.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(repair.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('keeps the diagnostic SELECT-only and limits data queries to migration-history count', () => {
    const executable = preflight
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|BEGIN|COMMIT|ROLLBACK)\b/im);
    expect(executable).toMatch(/^\s*SELECT\b/m);
    expect(preflight).toContain("query_to_xml(\n                          'SELECT count(*)::bigint AS version_count");
    expect(preflight).not.toMatch(/FROM\s+public\.email_otps\b/i);
    for (const status of ['PASS', 'MISSING', 'MISMATCH', 'UNKNOWN']) {
      expect(preflight).toContain(`'${status}'`);
    }
  });

  it('consolidates every existing preflight category into one read-only result statement', () => {
    expect(singleResultPreflight.trimStart()).toMatch(/^--[^\n]*\n(?:--[^\n]*\n)*\s*WITH\b/i);
    expect(singleResultPreflight).toContain('SELECT check_name, result, actual_value, expected_value, explanation');

    const requiredChecks = [
      'DATABASE_IDENTITY', 'POSTGRESQL_MAJOR_VERSION', 'EMAIL_OTPS_TABLE', 'BASE_COLUMN_COUNT', 'BASE_COLUMN:',
      'UUID_DEFAULT_RESOLUTION', 'ID_PRIMARY_KEY', 'PURPOSE_CONSTRAINT', 'EMAIL_OTPS_RLS_POLICY',
      'ROLE:', 'SERVICE_ROLE_PUBLIC_USAGE', 'EXECUTOR_PUBLIC_CREATE', 'EXECUTOR_PUBLIC_USAGE',
      'EXECUTOR_TABLE_OWNERSHIP', 'EXECUTOR_EMAIL_OTPS_PRIVILEGES', 'EXECUTOR_UUID_DEFAULT_PRIVILEGES',
      'MIGRATION_HISTORY_SCHEMA', 'MIGRATION_HISTORY_20261031150000', 'TARGET_COLUMN_ABSENT:',
      'TARGET_INDEX_NAME_ABSENT', 'TARGET_RPC_NAMES_ABSENT',
    ];
    for (const check of requiredChecks) expect(singleResultPreflight).toContain(check);
    for (const column of ['id', 'email', 'purpose', 'otp_hash', 'attempts', 'resend_after', 'expires_at', 'used', 'created_at', 'ticket_id', 'verified_at']) {
      expect(singleResultPreflight).toContain(`'${column}'`);
    }
    expect(singleResultPreflight).toContain("'20261031150000'");
    expect(singleResultPreflight).toContain("'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))'");
    expect(singleResultPreflight).toContain("p.policyname = 'Service role only access to email_otps'");
    expect(singleResultPreflight).toContain("'issue_email_otp_ticket', 'complete_email_otp_verification', 'cancel_email_otp_ticket'");
    expect(singleResultPreflight).toContain("ed.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass");
    expect(singleResultPreflight).toContain('ed.objid = p.oid');
    expect(singleResultPreflight).toContain("ed.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass");
    expect(singleResultPreflight).toContain("pg_catalog.pg_extension e ON ed.refobjid = e.oid");
    expect(singleResultPreflight).toContain("ed.deptype = 'e'");
    expect(singleResultPreflight).not.toContain("ed.classid = 'pg_catalog.pg_extension'::pg_catalog.regclass");

    const executable = singleResultPreflight
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/^\s*--.*$/gm, '');
    expect((executable.match(/;/g) ?? [])).toHaveLength(1);
    expect(executable).toMatch(/^\s*WITH\b/i);
    expect(executable).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|BEGIN|COMMIT|ROLLBACK)\b/i);
    expect(singleResultPreflight).not.toMatch(/FROM\s+public\.email_otps\b/i);
  });

  it('normalizes the confirmed single-result purpose constraint exactly and rejects a changed value', () => {
    const normalize = (definition: string) => definition.toLowerCase().replace(/\s+/g, '');
    const expected = "CHECK (((purpose)::text = ANY ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'INVITATION'::character varying])::text[])))";
    const confirmed = "CHECK (((purpose)::text = ANY ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'INVITATION'::character varying])::text[])))";
    const altered = "CHECK (((purpose)::text = ANY ((ARRAY['LOGIN'::character varying, 'REGISTER'::character varying, 'RECOVERY'::character varying])::text[])))";

    expect(normalize(confirmed)).toBe(normalize(expected));
    expect(normalize(altered)).not.toBe(normalize(expected));
    expect(singleResultPreflight).toContain("'check(((purpose)::text=any((array[''login''::charactervarying,''register''::charactervarying,''invitation''::charactervarying])::text[])))'");
  });

  it('uses PostgreSQL pg_depend dependent-to-referenced direction for uuid-ossp ownership checks', () => {
    const expectedMembershipJoin = [
      "classid = 'pg_catalog.pg_proc'::pg_catalog.regclass",
      'objid = p.oid',
      "refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass",
      'refobjid = e.oid',
      "deptype = 'e'",
    ];
    for (const condition of expectedMembershipJoin) {
      expect(singleResultPreflight).toContain(condition);
      expect(repair).toContain(condition);
      expect(uuidDiagnostic).toContain(condition);
    }
    expect(singleResultPreflight).not.toContain("ed.classid = 'pg_catalog.pg_extension'::pg_catalog.regclass");
    expect(uuidDiagnostic).not.toContain("ed.classid = 'pg_catalog.pg_extension'::pg_catalog.regclass");
    expect(uuidDiagnostic).toContain("pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')");
    expect(uuidDiagnostic).toContain("r.extension_name <> 'uuid-ossp'");
    expect(uuidDiagnostic).toContain("r.extension_schema <> 'extensions'");

    const executable = uuidDiagnostic
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/^\s*--.*$/gm, '');
    expect((executable.match(/;/g) ?? [])).toHaveLength(1);
    expect(executable).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|BEGIN|COMMIT|ROLLBACK)\b/i);
  });

  it('keeps all RPC implementation bodies identical to migration 150000', () => {
    for (const name of ['issue_email_otp_ticket', 'complete_email_otp_verification', 'cancel_email_otp_ticket']) {
      const original = migration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
      const guarded = repair.match(new RegExp(`CREATE FUNCTION public\\.${name}\\b[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
      expect(original, `missing source RPC ${name}`).not.toBeNull();
      expect(guarded, `missing guarded RPC ${name}`).not.toBeNull();
      expect(guarded?.[1].trim()).toBe(original?.[1].trim());
    }
  });
});
