import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('migration 20261101100000 pending invitation uniqueness contract', () => {
  const migration = read('supabase/migrations/20261101100000_unique_pending_invitations.sql');
  const preflight = read('supabase/tests/preflight_20261101100000.sql');
  const regression = read('supabase/tests/pending_invitation_uniqueness.test.sql');
  const runner = read('supabase/tests/apply_20261101100000_local.ps1');
  const inviteApi = read('api/_lib/authHandlers/invite.ts');

  it('enforces one pending invitation per tenant and normalized email without rewriting existing rows', () => {
    expect(migration).toMatch(/GROUP BY organization_id,\s*pg_catalog\.lower\(pg_catalog\.btrim\(email\)\)/i);
    expect(migration).toMatch(/HAVING count\(\*\) > 1/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_org_email_uidx/i);
    expect(migration).toMatch(/ON public\.organization_invitations\s*\(organization_id,\s*pg_catalog\.lower\(pg_catalog\.btrim\(email\)\)\)\s*WHERE status = 'PENDING' AND email IS NOT NULL/i);
    expect(migration).not.toMatch(/\b(DELETE|UPDATE)\s+public\.organization_invitations/i);
  });

  it('expires stale invitations within the verified organization before duplicate lookup or insert', () => {
    const expireAt = inviteApi.indexOf(".update({ status: 'EXPIRED' })");
    const pendingLookup = inviteApi.indexOf('const { data: existingInvitation', expireAt);
    const insert = inviteApi.indexOf(".insert({", pendingLookup);
    expect(expireAt).toBeGreaterThan(-1);
    expect(inviteApi.slice(expireAt, pendingLookup)).toContain(".eq('organization_id', organizationId)");
    expect(inviteApi.slice(expireAt, pendingLookup)).toContain(".eq('status', 'PENDING')");
    expect(inviteApi.slice(expireAt, pendingLookup)).toContain(".lte('expires_at', expiryCutoff)");
    expect(inviteApi.slice(expireAt, pendingLookup)).toContain('if (expiryError)');
    expect(inviteApi.slice(pendingLookup, insert)).toContain(".gt('expires_at'");
    expect(expireAt).toBeLessThan(pendingLookup);
    expect(pendingLookup).toBeLessThan(insert);
  });

  it('fails safely in preflight on data conflicts, object collisions, or incorrect migration history', () => {
    expect(preflight).toMatch(/BEGIN TRANSACTION READ ONLY/);
    expect(preflight).toMatch(/20261031170000/);
    expect(preflight).toMatch(/20261031180000/);
    expect(preflight).toMatch(/20261101090000/);
    expect(preflight).toMatch(/20261101100000/);
    expect(preflight).toMatch(/GROUP BY organization_id, lower\(btrim\(email\)\)/i);
    expect(preflight).toMatch(/email IS DISTINCT FROM btrim\(email\)/i);
    expect(preflight).toMatch(/same-name index or relation already exists/i);
    expect(preflight).toMatch(/INVITATION_PREFLIGHT_SAFE_TO_APPLY\|PASS\|target=20261101100000/);
    expect(preflight).toMatch(/ROLLBACK;/);
  });

  it('covers normalized duplicates, tenant separation and non-pending lifecycle states in rollback SQL', () => {
    expect(regression).toMatch(/BEGIN;/);
    expect(regression).toMatch(/ROLLBACK;\s*$/);
    expect(regression).toMatch(/unique_violation/);
    expect(regression).toMatch(/lower\(btrim\(email\)\)/i);
    expect(regression).toContain("'ACCEPTED'");
    expect(regression).toContain("'REVOKED'");
    expect(regression).toContain("'EXPIRED'");
    expect(regression).toMatch(/v_org_b/);
    expect(regression).toMatch(/expires_at<=now\(\)/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX/i); // PostgreSQL arbitrates concurrent conflicts through the unique index.
  });

  it('keeps migration, catalog checks, rollback-only fixtures and history insertion atomic in the guarded runner', () => {
    const atomicBody = runner.slice(runner.indexOf('$transactionSql = @"'));
    expect(runner).toContain('$topLevelMigrationSql');
    expect(runner).toContain('$transactionControlInProcedure');
    expect(runner).toContain('INDEX\\s+[^;]*?\\bCONCURRENTLY\\b');
    expect(runner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5');
    expect(runner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(runner).toContain('ON_ERROR_STOP=1');
    expect(runner).toContain('INVITATION_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101100000');
    expect(atomicBody.indexOf('$migrationBody')).toBeLessThan(atomicBody.indexOf('$postCatalog'));
    expect(atomicBody.indexOf('$postCatalog')).toBeLessThan(atomicBody.indexOf('SAVEPOINT invitation_regression_fixtures'));
    expect(atomicBody.indexOf('ROLLBACK TO SAVEPOINT invitation_regression_fixtures')).toBeLessThan(atomicBody.indexOf('INSERT INTO supabase_migrations.schema_migrations'));
    expect(atomicBody.indexOf('INSERT INTO supabase_migrations.schema_migrations')).toBeLessThan(atomicBody.indexOf('COMMIT;'));
    expect(atomicBody).toMatch(/WHERE version='20261101100000' AND statements IS NULL AND name='unique_pending_invitations'/);
  });
});
