import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(resolve(root, 'supabase/migrations/20261031170000_razorpay_atomic_subscription_lifecycle.sql'), 'utf8');
const regression = readFileSync(resolve(root, 'supabase/tests/razorpay_atomic_subscription_lifecycle.test.sql'), 'utf8');
const preflight = readFileSync(resolve(root, 'supabase/tests/preflight_20261031170000.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'supabase/tests/apply_20261031170000_local.ps1'), 'utf8');

describe('Razorpay migration 170000 local validation workflow', () => {
  it('pins target history and refuses to replay partial target artifacts', () => {
    for (const v of ['20261023000000', '20261030000000', '20261031000000', '20261031160000']) {
      expect(preflight).toContain(`('${v}',1::bigint)`);
      expect(runner).toContain(`version='${v}')<>1`);
    }
    expect(preflight).toContain("('20261031170000',0::bigint)");
    expect(runner).toContain("version='20261031170000')<>0");
    expect(preflight).toContain('amount_refunded_paise');
    expect(preflight).toContain('razorpay_total_count');
    expect(preflight).toContain('duplicate non-null Razorpay payment IDs');
    expect(preflight).toContain('target Razorpay RPC or overload already exists');
  });

  it('is read-only and reports the exact safe-to-apply marker only after all checks', () => {
    expect(preflight).toMatch(/BEGIN TRANSACTION READ ONLY;/);
    expect(preflight.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(preflight).toContain('RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031170000');
    expect(preflight).toContain('RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required');
    expect(preflight).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/gim);
  });

  it('guards the isolated local runner with pinned checksums and one atomic migration/test/history commit', () => {
    expect(runner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(runner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(runner).toContain('1855F5502C29AE65BBC9E3D5C0771E98A3360A9C65817A95D69DF4EA6D9A71BD');
    expect(runner).toContain('F571338D922BE4EA0B477529D5D024324A13B8EC4398738F4764AB26D4053B72');
    expect(runner).toContain('ON_ERROR_STOP=1');
    expect(runner).toContain('RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031170000');
    expect(runner).toContain('SAVEPOINT razorpay_regression_fixtures;');
    expect(runner).toContain('ROLLBACK TO SAVEPOINT razorpay_regression_fixtures;');
    expect(runner).toContain('RAZORPAY_CATALOG_VERIFY|PASS|');
    expect(runner).toContain('RAZORPAY_SQL_REGRESSION|PASS|fixtures rolled back to savepoint');
    expect(runner).toContain("INSERT INTO supabase_migrations.schema_migrations(version,statements,name)");
    expect(runner).toContain('COMMIT;');
    expect(runner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });

  it('regression SQL exercises atomic payment and subscription protections and rolls back fixtures', () => {
    expect(regression).toContain('BEGIN;');
    expect(regression.trimEnd()).toMatch(/ROLLBACK;$/);
    for (const assertion of [
      'Failed payment activated',
      'Verified captured payment did not activate',
      'Duplicate or out-of-order payment event',
      'Partial refund handling',
      'Full refund did not remove active billing status',
      'different subscription',
      'different organization',
      'Wrong amount was accepted',
      'Wrong currency was accepted',
      'Incomplete refund was accepted',
    ]) expect(regression).toContain(assertion);
    expect(migration).toContain('CREATE INDEX billing_payments_verified_subscription_period');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, pg_temp');
    expect(migration).toContain('TO service_role');
  });
});
