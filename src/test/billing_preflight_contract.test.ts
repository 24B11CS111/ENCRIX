import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = [
  resolve(root, 'docs/sql/ENCRIX_BILLING_PREFLIGHT.sql'),
  resolve(root, 'docs/sql/ENCRIX_BILLING_POSTFLIGHT.sql'),
];
const deploymentChecks = [
  resolve(root, 'docs/sql/production_preflight.sql'),
  resolve(root, 'docs/sql/production_postflight.sql'),
];
const splitFiles = [
  'ENCRIX_PREFLIGHT_TABLES.sql',
  'ENCRIX_PREFLIGHT_COLUMNS.sql',
  'ENCRIX_PREFLIGHT_DUPLICATES.sql',
  'ENCRIX_PREFLIGHT_INDEXES_CONSTRAINTS.sql',
  'ENCRIX_PREFLIGHT_FUNCTIONS_PERMISSIONS.sql',
  'ENCRIX_PREFLIGHT_RLS_POLICIES.sql',
  'ENCRIX_PREFLIGHT_TRIGGERS.sql',
  'ENCRIX_PREFLIGHT_MIGRATION_HISTORY.sql',
].map((name) => resolve(root, 'docs/sql/preflight', name));

describe('billing catalog preflight SQL safety contract', () => {
  it.each(files)('keeps %s read-only and transaction-bounded', (file) => {
    const sql = readFileSync(file, 'utf8');
    expect(sql).toMatch(/BEGIN TRANSACTION READ ONLY;/i);
    expect(sql.trimEnd()).toMatch(/ROLLBACK;$/i);
    expect(sql).toContain('wrzoqxesffbfirjgotbr');
    expect(sql).toMatch(/organization_has_active_paid_entitlement\(uuid\)/i);
    expect(sql).toContain('pg_get_functiondef');
    expect(sql).toContain('has_function_privilege');
    expect(sql).toContain('relrowsecurity');
    expect(sql).toContain('pg_get_triggerdef');
    expect(sql).toContain('schema_migrations');
    if (file.endsWith('ENCRIX_BILLING_PREFLIGHT.sql')) expect(sql).toContain('S04_DUPLICATES');
    else expect(sql).toContain('P09_TABLE_PRIVILEGES');

    const uncommented = sql.replace(/--[^\r\n]*/g, '');
    expect(uncommented).not.toMatch(/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE\b|ALTER\b|CREATE\b|DROP\b|GRANT\b|REVOKE\b|CALL\b|DO\s+\$)/gim);
  });
});

describe('requested production deployment checks', () => {
  it.each(deploymentChecks)('keeps %s read-only and verifies new corrections', (file) => {
    const sql = readFileSync(file, 'utf8');
    const uncommented = sql.replace(/--[^\r\n]*/g, '');
    expect(sql).toMatch(/BEGIN TRANSACTION READ ONLY;/i);
    expect(sql.trimEnd()).toMatch(/ROLLBACK;$/i);
    const statements = uncommented
      .replace(/\bBEGIN TRANSACTION READ ONLY\s*;/i, '')
      .replace(/\bROLLBACK\s*;\s*$/i, '')
      .split(';').map((statement) => statement.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(1);
    expect(statements.every((statement) => /^(SELECT|WITH)\b/i.test(statement))).toBe(true);
    expect(uncommented).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL|DO)\b/i);
    expect(sql).toContain('20261105150000');
    expect(sql).toContain('20261105160000');
    if (file.endsWith('production_preflight.sql')) {
      expect(sql).toContain("'registration_otp_attempts', 'created_at'");
      expect(sql).toContain('duplicate_groups');
      expect(sql).toContain('pg_get_indexdef');
    } else {
      expect(sql).toContain('active_provider_state_required');
      expect(sql).toContain('five_send_limit_present');
      expect(sql).toContain("'partially_refunded','refunded','failed'");
    }
  });
});

describe('split billing preflight SQL safety contract', () => {
  it.each(splitFiles)('keeps %s independent and read-only', (file) => {
    const sql = readFileSync(file, 'utf8');
    const uncommented = sql.replace(/--[^\r\n]*/g, '');
    expect(uncommented).toMatch(/\b(SELECT|WITH)\b/i);
    expect(uncommented.match(/;/g) || []).toHaveLength(1);
    expect(uncommented).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|TEMP|TEMPORARY)\b/i);
    expect(uncommented).not.toMatch(/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE\b|ALTER\b|CREATE\b|DROP\b|GRANT\b|REVOKE\b|CALL\b|DO\s+\$)/gim);
    expect(uncommented).not.toMatch(/\b(pg_temp|current_setting\s*\(\s*'search_path')/i);
  });

  it('returns aggregate-only duplicate results', () => {
    const sql = readFileSync(splitFiles[2], 'utf8');
    expect(sql).toContain('duplicate_key_count');
    expect(sql).not.toMatch(/SELECT\s+(?:lower\([^\n]*email|[^\n]*owner_key)\s+(?:AS\s+)?(?:email|owner_id)/i);
  });

  it('lists every repository migration and checks the legacy function 310000 would drop', () => {
    const migrationFiles = readdirSync(resolve(root, 'supabase/migrations'))
      .filter((name: string) => /^\d{14}_.*\.sql$/.test(name));
    const historySql = readFileSync(resolve(root, 'docs/sql/preflight/ENCRIX_PREFLIGHT_MIGRATION_HISTORY.sql'), 'utf8');
    const historyVersions = [...historySql.matchAll(/\('([0-9]{14})'\)/g)].map((match) => match[1]);
    expect(historyVersions).toEqual(migrationFiles.map((name: string) => name.slice(0, 14)).sort());
    expect(new Set(historyVersions).size).toBe(historyVersions.length);

    const functionSql = readFileSync(resolve(root, 'docs/sql/preflight/ENCRIX_PREFLIGHT_FUNCTIONS_PERMISSIONS.sql'), 'utf8');
    const migration310 = readFileSync(resolve(root, 'supabase/migrations/20261031000000_onboarding_billing_integrity.sql'), 'utf8');
    expect(migration310).toContain('DROP FUNCTION IF EXISTS public.record_registration_otp_failure(UUID,TEXT)');
    expect(functionSql).toContain('public.record_registration_otp_failure(uuid,text)');
  });
});

describe('final Production database audit SQL contract', () => {
  const auditFile = resolve(root, 'docs/sql/ENCRIX_FINAL_PRODUCTION_DATABASE_AUDIT.sql');

  it('is one read-only standalone catalog query covering repository history and security checks', () => {
    const sql = readFileSync(auditFile, 'utf8');
    const uncommented = sql.replace(/--[^\r\n]*/g, '');
    expect(uncommented.match(/;/g) || []).toHaveLength(1);
    expect(uncommented.trim()).toMatch(/^WITH\b[\s\S]*\bSELECT\s+section,\s*object_name,\s*details\s+FROM\s+audit_rows/i);
    expect(uncommented).not.toMatch(/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE\b|ALTER\b|CREATE\b|DROP\b|GRANT\b|REVOKE\b|CALL\b|DO\s+\$)/im);
    expect(sql).toContain('wrzoqxesffbfirjgotbr');
    expect(sql).toContain('record_registration_otp_failure');
    expect(sql).toContain('get_auth_profile');
    expect(sql).toContain('prevent_audit_tampering');
    expect(sql).toContain('issue_email_otp_ticket');
    expect(sql).toContain('email_otps_ticket_id_uidx');
    expect(sql).toContain('DEFAULT_PRIVILEGES');
    expect(sql).toContain('RLS_AND_POLICIES');
    expect(sql).toContain('DUPLICATE_MIGRATION_HISTORY');

    const migrations = readdirSync(resolve(root, 'supabase/migrations'))
      .filter((name: string) => /^\d{14}_.*\.sql$/.test(name));
    const auditedMigrations = [...sql.matchAll(/\('([0-9]{14})','([^']+\.sql)'\)/g)]
      .map((match) => match[2])
      .sort();
    expect(auditedMigrations).toEqual(migrations.sort());
  });
});

describe('Production trigger inventory SQL safety contract', () => {
  it('checks all five requested tables in one standalone read-only query', () => {
    const sql = readFileSync(resolve(root, 'docs/sql/ENCRIX_PRODUCTION_TRIGGER_INVENTORY.sql'), 'utf8');
    const uncommented = sql.replace(/--[^\r\n]*/g, '');
    expect(uncommented.match(/;/g) || []).toHaveLength(1);
    expect(uncommented.trim()).toMatch(/^WITH\b[\s\S]*\bSELECT\b/i);
    expect(uncommented).not.toMatch(/^\s*(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE\b|ALTER\b|CREATE\b|DROP\b|GRANT\b|REVOKE\b|CALL\b|DO\s+\$)/im);
    for (const table of ['organizations','profiles','pending_registrations','billing_payments','organization_subscriptions']) {
      expect(sql).toContain(`('${table}')`);
    }
    expect(sql).toContain('NOT trigger_row.tgisinternal');
    expect(sql).toContain('pg_get_triggerdef');
  });
});
