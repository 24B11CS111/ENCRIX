import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(resolve(root, 'supabase/migrations/20261031180000_paid_subscription_entitlement_gate.sql'), 'utf8');
const regression = readFileSync(resolve(root, 'supabase/tests/paid_subscription_entitlement_gate.test.sql'), 'utf8');
const preflight = readFileSync(resolve(root, 'supabase/tests/preflight_20261031180000.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'supabase/tests/apply_20261031180000_local.ps1'), 'utf8');
const apiTests = readFileSync(resolve(root, 'src/test/paid_entitlement.test.ts'), 'utf8');

describe('Razorpay entitlement gate migration 180000 validation contract', () => {
  it('preserves the server-authoritative Business plan, amount, capture, signature, refund and period rules', () => {
    for (const fragment of [
      "s.plan_code = 'business'",
      's.amount_paise = 999900',
      "s.entitlement_source = 'razorpay'",
      "s.status = 'active'",
      's.is_current IS TRUE',
      "p.status = 'captured'",
      "p.currency = 'INR'",
      'p.signature_verified_at IS NOT NULL',
      'p.amount_refunded_paise < p.amount_paise',
      'p.organization_id = s.organization_id',
      's.current_period_end > pg_catalog.statement_timestamp()',
    ]) expect(migration).toContain(fragment);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.organization_has_active_paid_entitlement(UUID)');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('SET search_path = pg_catalog, pg_temp');
  });

  it('preflights the exact local history prerequisites and refuses an existing target function', () => {
    expect(preflight).toMatch(/BEGIN TRANSACTION READ ONLY;/);
    expect(preflight.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(preflight).toContain("('20261031170000',1::bigint)");
    expect(preflight).toContain("('20261031180000',0::bigint)");
    expect(preflight).toContain('organization_has_active_paid_entitlement');
    expect(preflight).toContain('target function absent');
    expect(preflight).toContain('ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031180000');
    expect(preflight).toContain('ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required');
    expect(preflight).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/gim);
  });

  it('tests entitlement decisions and rolls every SQL fixture back', () => {
    expect(regression).toMatch(/BEGIN;[\s\S]*DO \$test\$/);
    expect(regression.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(regression).toContain('status, signature_verified_at, paid_at, failed_at');
    expect(regression).toContain("'failed', NULL, NULL, v_now)");
    for (const assertion of [
      'Verified active Business subscription was denied',
      'Expired period was entitled',
      'Unpaid subscription was entitled',
      'Fully refunded subscription was entitled',
      'Partial refund incorrectly removed otherwise-valid access',
      'A different organization payment was used to grant entitlement',
      'Non-Business plan was entitled',
      'Non-9999 annual amount was entitled',
      'Unknown organization was entitled',
      'A valid verified renewal did not restore entitlement',
    ]) expect(regression).toContain(assertion);
  });

  it('has API-boundary fail-closed tests for database failures and fresh authorization decisions', () => {
    expect(apiTests).toContain('fails closed on database errors, malformed responses and missing organization scope');
    expect(apiTests).toContain('returns consistent API responses for non-entitled and unavailable states');
    expect(apiTests).toContain('concurrent requests each consult the database rather than sharing cached entitlement state');
    expect(apiTests).toContain('PAID_ENTITLEMENT_UNAVAILABLE');
  });

  it('pins the isolated runner and performs migration, checks, fixture rollback and history insert in one transaction', () => {
    expect(runner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(runner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(runner).toContain('C8D70B7C601E10F9F7BF1C4566C07AEBA63ECAC93B41E2072FBE7FA4DED243B7');
    expect(runner).toContain('772B5BD2A77D9E31373CDB02A721AD2F473126DD44CA6176EB9572E6FCF5C138');
    expect(runner).toContain('ON_ERROR_STOP=1');
    expect(runner).toContain('ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031180000');
    expect(runner).toContain('SAVEPOINT entitlement_regression_fixtures;');
    expect(runner).toContain('ROLLBACK TO SAVEPOINT entitlement_regression_fixtures;');
    expect(runner).toContain("INSERT INTO supabase_migrations.schema_migrations(version,statements,name)");
    expect(runner).toContain('COMMIT;');
    expect(runner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });
});
