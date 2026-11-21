import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(resolve(root, 'supabase/migrations/20261101090000_followup_email_outbox.sql'), 'utf8');
const regression = readFileSync(resolve(root, 'supabase/tests/followup_email_outbox.test.sql'), 'utf8');
const preflight = readFileSync(resolve(root, 'supabase/tests/preflight_20261101090000.sql'), 'utf8');
const runner = readFileSync(resolve(root, 'supabase/tests/apply_20261101090000_local.ps1'), 'utf8');
const processor = readFileSync(resolve(root, 'api/_lib/reminderProcessor.ts'), 'utf8');
const mailer = readFileSync(resolve(root, 'api/_lib/emailDelivery.ts'), 'utf8');

describe('follow-up email outbox migration 20261101090000 workflow contract', () => {
  it('keeps queue creation tenant-scoped, recipient-verified and idempotent', () => {
    expect(migration).toContain('ON CONFLICT (follow_up_id, recipient_profile_id, milestone) DO NOTHING');
    expect(migration).toContain('p.status = \'ACTIVE\'');
    expect(migration).toContain('p.email_verified = TRUE');
    expect(migration).toContain('g.owner_id = p.user_id');
    expect(migration).toContain('p.id = v_follow_up.assigned_to');
    expect(migration).toContain('l.organization_id = f.organization_id');
    expect(migration).toContain('pg_catalog.lower(pg_catalog.btrim(p.email))');
  });

  it('revalidates authorization at claim time and bounds at-most-once delivery', () => {
    expect(migration).toContain('FOR UPDATE OF o SKIP LOCKED');
    expect(migration).toContain('FOR SHARE OF g, f, l, a, p');
    expect(migration).toContain('p_limit > 50');
    expect(migration).toContain("status = 'FAILED', attempts = 1");
    expect(migration).toContain('RECIPIENT_NO_LONGER_AUTHORIZED');
    expect(migration).toContain('AND c.authorized IS TRUE');
    expect(migration).toContain('RETURNING o.id, o.claim_token, o.recipient_email');
    expect(migration).toContain('FROM claimed AS c');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('TO service_role');
  });

  it('keeps integration bounded, entitlement-gated, provider-idempotent and does not retry uncertain failures', () => {
    expect(processor).toContain("'organization_has_active_paid_entitlement'");
    expect(processor).toContain('p_limit: 20');
    expect(processor).toContain('complete_follow_up_reminder_email');
    expect(processor).toContain('p_sent: false');
    expect(mailer).toContain("'Idempotency-Key'");
    expect(mailer).toContain('encrix-reminder-');
  });

  it('covers authorization changes, tenant mismatches, cascades, duplicate events, batch limits and repeat claims', () => {
    expect(regression).toMatch(/BEGIN;[\s\S]*ROLLBACK;\s*$/);
    expect((regression.match(/DO\s+\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g) || []).length).toBe(2);
    for (const assertion of [
      'follow_up_email_outbox_event_unique',
      'duplicate follow-up milestone reminder was enqueued',
      'API roles have direct outbox table privileges',
      'RECIPIENT_NO_LONGER_AUTHORIZED',
      'deleting a follow-up did not cascade its reminder history',
      'deleting a recipient did not cascade its reminder history',
      'deleting an organization did not cascade its reminder history',
      'a repeated competing claim returned an already claimed or suppressed reminder',
      'valid uncertain provider failure was not recorded',
      'completion accepted a mismatched claim token',
      'completed delivery accepted a replayed completion',
      'uncertain delivery state is not terminal and truthful',
      'claim RPC accepted a batch larger than its 50-row bound',
      'organization-cascade fixture did not survive unrelated parent cleanup',
      'FOR SHARE OF g, f, l, a, p',
    ]) expect(regression).toContain(assertion);
    expect(regression.indexOf('DELETE FROM public.leads WHERE organization_id = v_org_b'))
      .toBeLessThan(regression.indexOf('DELETE FROM public.organizations WHERE id = v_org_b'));
    expect(regression).toContain('follow_up_id=v_f_active AND recipient_profile_id=v_active');
  });

  it('uses read-only preflight checks for prerequisites and a rollback-only atomic local runner', () => {
    expect(preflight).toMatch(/BEGIN TRANSACTION READ ONLY;/);
    expect(preflight.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(preflight).toContain("('20261031170000',1::bigint)");
    expect(preflight).toContain("('20261031180000',1::bigint)");
    expect(preflight).toContain("('20261101090000',0::bigint)");
    expect(preflight).toContain('OUTBOX_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101090000');
    expect(preflight).toContain('OUTBOX_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required');
    expect(preflight).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/gim);

    expect(runner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(runner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(runner).toContain('4084EAFAFA0BFDF065478287A1F6F84B5361E4430766D6C56EADCFD1B2902E1E');
    expect(runner).toContain('3FFD7597234C86B18AE205B2A83EF242D6925C285E8A097C579F514F1F3A962A');
    expect(runner).toContain('4996CCA8A1C8A675BBA91021A4B1E697115018BA3F067EA2C5DE9918CF70862A');
    expect(runner).toContain('ON_ERROR_STOP=1');
    expect(runner).toContain('OUTBOX_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101090000');
    expect(runner).toContain('SAVEPOINT outbox_regression_fixtures;');
    expect(runner).toContain('ROLLBACK TO SAVEPOINT outbox_regression_fixtures;');
    expect(runner).toContain('INSERT INTO supabase_migrations.schema_migrations(version,statements,name)');
    expect(runner).toContain('OUTBOX_SQL_REGRESSION|PASS|fixtures rolled back to savepoint');
    expect(runner).toContain('COMMIT;');
    expect(runner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });
});
