import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const preflight = readFileSync(resolve(root, 'supabase/tests/preflight_pending_migrations.sql'), 'utf8');
const otpMigrationBytes = readFileSync(resolve(root, 'supabase/migrations/20261031150000_durable_email_otp_attempts.sql'));
const otpMigration = otpMigrationBytes.toString('utf8');
const wrapper = readFileSync(resolve(root, 'supabase/tests/run_pending_migration_preflight.ps1'), 'utf8');
const applyRunner = readFileSync(resolve(root, 'supabase/tests/apply_20261031150000_local.ps1'), 'utf8');
const twilioMigrationBytes = readFileSync(resolve(root, 'supabase/migrations/20261031160000_organization_twilio_calling.sql'));
const twilioMigration = twilioMigrationBytes.toString('utf8');
const twilioRunner = readFileSync(resolve(root, 'supabase/tests/apply_20261031160000_local.ps1'), 'utf8');
const twilioRegression = readFileSync(resolve(root, 'supabase/tests/organization_twilio_calling.test.sql'), 'utf8');
const twilioPreflight = readFileSync(resolve(root, 'supabase/tests/preflight_20261031160000.sql'), 'utf8');
const twilioPreflightRunner = readFileSync(resolve(root, 'supabase/tests/run_20261031160000_preflight_local.ps1'), 'utf8');
const twilioPreflightBytes = readFileSync(resolve(root, 'supabase/tests/preflight_20261031160000.sql'));

describe('pending migration read-only preflight contract', () => {
  it('pins the exact 150000 migration bytes and confirms transaction-compatible statements', () => {
    expect(createHash('sha256').update(otpMigrationBytes).digest('hex').toUpperCase())
      .toBe('11E88F5FEC735067FAE1632BA7A6B8133513B6C9309E9B99DE2D3DD9FCCE89A8');
    expect(otpMigration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS email_otps_ticket_id_uidx/);
    expect(otpMigration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
    expect(otpMigration).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    expect(otpMigration).not.toMatch(/^\s*(VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE)\b/im);
  });

  it('guards database identity and the exact migration history prerequisites', () => {
    expect(preflight).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(preflight).toContain("current_database() <> 'postgres'");
    expect(preflight).toContain("current_user <> 'postgres'");
    expect(preflight).toContain("current_setting('port') <> '5432'");
    expect(preflight).toContain("'20261008000000','20261031130000','20261031140000','20261031150000'");
    expect(preflight).toContain("v_version_count <> 1");
    expect(preflight).toContain("v_version_count <> 0");
    expect(preflight).toContain('unexpected migration history table columns or primary key');
    expect(preflight).toContain("v_130_history_count = 1");
    expect(preflight).toContain('MIGRATION_HISTORY|20261031130000|count=1|status=RECORDED');
    expect(preflight).toContain("'PREFLIGHT_MIGRATION_HISTORY|PASS|prerequisites=exactly-once target_20261031150000=ABSENT'");
  });

  it('checks the complete OTP table contract, target columns, duplicate tickets, and exact index shape', () => {
    for (const column of ['id', 'email', 'purpose', 'otp_hash', 'attempts', 'resend_after', 'expires_at', 'used', 'created_at', 'ticket_id', 'verified_at']) {
      expect(preflight).toContain(`'${column}'`);
    }
    for (const columnType of [
      "('id','uuid',true,'extensions.uuid_generate_v4()')",
      "('email','character varying(255)',true,NULL)",
      "('purpose','character varying(50)',true,NULL)",
      "('otp_hash','character varying(255)',true,NULL)",
      "('attempts','integer',true,'0')",
      "('resend_after','timestamp with time zone',true,NULL)",
      "('expires_at','timestamp with time zone',true,NULL)",
      "('used','boolean',true,'false')",
      "('created_at','timestamp with time zone',true,'now()')",
      "('ticket_id','uuid',false,NULL)",
      "('verified_at','timestamp with time zone',false,NULL)",
    ]) {
      expect(preflight).toContain(columnType);
    }
    expect(preflight).toContain('duplicate non-null email_otps.ticket_id values');
    expect(preflight).toContain("v_index_unique IS DISTINCT FROM true");
    expect(preflight).toContain("v_index_keys IS DISTINCT FROM v_ticket_attnum::text");
    expect(preflight).toContain("v_index_predicate IS DISTINCT FROM 'ticket_idisnotnull'");
    expect(preflight).toContain("v_index_method IS DISTINCT FROM 'btree'");
  });

  it('accepts both UUID default spellings only when catalog resolution is the expected uuid-ossp function', () => {
    expect(preflight).toContain("'extensions.uuid_generate_v4()','uuid_generate_v4()'");
    expect(preflight).toContain("pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')::oid");
    expect(preflight).toContain("p.proname='uuid_generate_v4' AND pn.nspname='extensions'");
    expect(preflight).toContain("e.extname='uuid-ossp' AND en.nspname='extensions'");
    expect(preflight).toContain('v_id_default_function_count<>1 OR NOT v_id_default_uses_expected_function OR NOT v_uuid_extension_ok');
  });

  it('pins each present OTP RPC body hash to the current migration source', () => {
    const bodyPattern = /CREATE OR REPLACE FUNCTION public\.(issue_email_otp_ticket|complete_email_otp_verification|cancel_email_otp_ticket)\b[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g;
    const hashes = new Map<string, string>();
    for (const match of otpMigration.matchAll(bodyPattern)) {
      hashes.set(match[1], createHash('md5').update(match[2], 'utf8').digest('hex'));
    }

    expect(hashes.size).toBe(3);
    expect(preflight).toContain(`'public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',\n     ARRAY['p_ticket_id','p_email','p_purpose','p_otp_hash','p_resend_after','p_expires_at']::text[],\n     'jsonb','${hashes.get('issue_email_otp_ticket')}'`);
    expect(preflight).toContain(`'public.complete_email_otp_verification(uuid,text,text,boolean)',\n     ARRAY['p_ticket_id','p_email','p_purpose','p_is_valid']::text[],\n     'jsonb','${hashes.get('complete_email_otp_verification')}'`);
    expect(preflight).toContain(`'public.cancel_email_otp_ticket(uuid,text,text)',\n     ARRAY['p_ticket_id','p_email','p_purpose']::text[],\n     'boolean','${hashes.get('cancel_email_otp_ticket')}'`);
  });

  it('checks exact RPC metadata and stored/effective execute permissions, failing closed on partial state', () => {
    for (const check of [
      "v_proc.owner_name IS DISTINCT FROM 'postgres'",
      'v_proc.prosecdef IS DISTINCT FROM true',
      "v_proc.provolatile IS DISTINCT FROM 'v'",
      'v_proc.proisstrict IS DISTINCT FROM false',
      "v_proc.proparallel IS DISTINCT FROM 'u'",
      'v_proc.proargmodes IS NOT NULL',
      'v_proc.proallargtypes IS NOT NULL',
      "v_proc.lanname IS DISTINCT FROM 'plpgsql'",
      "ARRAY['search_path=pg_catalog, pg_temp']::text[]",
      'v_direct_public OR v_direct_anon OR v_direct_authenticated',
      'NOT v_effective_service OR NOT v_effective_postgres',
      'partial or incompatible target OTP RPC set',
      'PREFLIGHT_MIGRATION_HISTORY|PASS|prerequisites=exactly-once target_20261031150000=ABSENT',
      'PREFLIGHT_MIGRATION_HISTORY|FAIL|',
      'PREFLIGHT_SAFE_TO_APPLY|PASS|history prerequisites recorded exactly-once target_20261031150000=ABSENT',
      'PREFLIGHT_BLOCKED|FAIL|',
    ]) {
      expect(preflight).toContain(check);
    }
    expect(preflight).not.toContain('PREFLIGHT|OVERALL|');
  });

  it('runs only inside the pinned local container and accepts only SAFE_TO_APPLY PASS', () => {
    expect(wrapper).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(wrapper).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(wrapper).toContain('docker exec -i $expectedContainerId psql -U postgres -d postgres -X -v ON_ERROR_STOP=1');
    expect(wrapper).toContain("$ErrorActionPreference = 'Continue'");
    expect(wrapper).toContain('$PSNativeCommandUseErrorActionPreference = $false');
    expect(wrapper).toContain('$psqlExitCode = $LASTEXITCODE');
    expect(wrapper).toContain('if ($psqlExitCode -ne 0)');
    expect(wrapper).toContain('2>&1');
    expect(wrapper).toContain('PREFLIGHT_SAFE_TO_APPLY\\|PASS');
    expect(wrapper).toContain('PREFLIGHT_BLOCKED\\|FAIL');
    expect(wrapper).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });

  it('pins migration application to one local version and requires preflight, rollback test, and post-checks', () => {
    expect(applyRunner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(applyRunner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(applyRunner).toContain('20261031150000_durable_email_otp_attempts.sql');
    expect(applyRunner).toContain('11E88F5FEC735067FAE1632BA7A6B8133513B6C9309E9B99DE2D3DD9FCCE89A8');
    expect(applyRunner).toContain("[BitConverter]::ToString($sha.ComputeHash($migrationBytes)).Replace('-', '').ToUpperInvariant()");
    expect(applyRunner).not.toContain('[Convert]::ToHexString');
    expect(applyRunner).toContain('Migration checksum mismatch');
    expect(applyRunner).toContain("'PREFLIGHT_SAFE_TO_APPLY|PASS|history prerequisites recorded exactly-once target_20261031150000=ABSENT'");
    expect(applyRunner).toContain("LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;");
    expect(applyRunner).toContain("INSERT INTO supabase_migrations.schema_migrations(version,statements,name)");
    expect(applyRunner).toContain("VALUES ('20261031150000',NULL,'durable_email_otp_attempts')");
    expect(applyRunner).toContain("AND name='durable_email_otp_attempts'");
    expect(applyRunner).toContain('AND statements IS NULL');
    expect(applyRunner).toContain("'POST_MIGRATION_VERIFY|PASS|history_count=1 otp_fixture_count=0'");
    expect(applyRunner).toContain("'ON_ERROR_STOP=1'");
    expect(applyRunner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });

  it('captures docker exec exit status immediately and preserves full psql diagnostics', () => {
    const invoke = twilioRunner.slice(twilioRunner.indexOf('function Invoke-LocalPsql'), twilioRunner.indexOf('\nfunction Assert-Marker'));
    expect(invoke).toContain("$PSNativeCommandUseErrorActionPreference = $false");
    expect(invoke).toContain('$output = @($SqlText | & docker exec -i $expectedContainerId psql @args 2>&1)');
    expect(invoke).toMatch(/docker exec -i \$expectedContainerId psql @args 2>&1\)[\s\S]*?\$psqlExitCode = \[int\]\$LASTEXITCODE/);
    expect(invoke).toContain('if ($psqlExitCode -ne 0)');
    expect(invoke).toContain('Complete captured stdout/stderr follows:');
    expect(invoke).toContain('ON_ERROR_STOP=1');
  });

  it('pins Twilio migration bytes and confirms its explicit transaction envelope', () => {
    expect(createHash('sha256').update(twilioMigrationBytes).digest('hex').toUpperCase())
      .toBe('9B6F8915F688B8709643092E452BCB778CA985BBEE2DAE80E1EFCEFC35DF331D');
    expect(twilioMigration).toMatch(/^--[\s\S]*?^BEGIN;[\s\S]*^COMMIT;\s*$/m);
    expect(twilioMigration).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/im);
    expect(twilioMigration).toContain('CREATE TABLE public.organization_twilio_credentials');
    expect(twilioMigration).toContain('CREATE TABLE public.telephony_inbound_attempts');
    for (const fn of [
      'prepare_twilio_outbound_call', 'claim_twilio_customer_leg', 'attach_twilio_leg_sid',
      'record_twilio_inbound_attempt', 'prepare_twilio_inbound_call',
      'save_organization_twilio_credentials', 'revoke_organization_twilio_credentials',
    ]) expect(twilioMigration).toContain(`FUNCTION public.${fn}`);
  });

  it('guards the Twilio local runner, transaction rewrapping, catalog checks, and history order', () => {
    expect(twilioRunner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(twilioRunner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(twilioRunner).toContain('9B6F8915F688B8709643092E452BCB778CA985BBEE2DAE80E1EFCEFC35DF331D');
    expect(twilioRunner).toContain('6451DED6DEA1DC6CCC59FED84D348D9358E1A6976C2F72AB5E44B022842967E5');
    expect(twilioRunner).toContain("Join-Path $PSScriptRoot 'preflight_20261031160000.sql'");
    expect(twilioRunner).toContain('Preflight checksum mismatch');
    expect(twilioRunner).toContain('Migration checksum mismatch');
    expect(twilioRunner).toContain("TWILIO_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031160000");
    expect(twilioRunner).not.toContain('preflight_pending_migrations.sql');
    expect(twilioRunner).not.toContain('MIGRATION|20261031140000');
    expect(twilioRunner).not.toContain('MIGRATION|20261031150000');
    expect(twilioRunner.indexOf('$preflightSha.ComputeHash'))
      .toBeLessThan(twilioRunner.indexOf('docker inspect'));
    expect(twilioRunner).toContain("version='20261031150000')<>1");
    expect(twilioRunner).toContain("version='20261031160000')<>0");
    expect(twilioRunner).toContain('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;');
    expect(twilioRunner).toContain('organization_twilio_credentials');
    expect(twilioRunner).toContain('TWILIO_CATALOG_VERIFY|PASS|');
    expect(twilioRunner).toContain("VALUES ('20261031160000',NULL,'organization_twilio_calling')");
    expect(twilioRunner).toContain("AND statements IS NULL AND name='organization_twilio_calling'");
    expect(twilioRunner).toContain('organization_twilio_active_phone_uidx');
    expect(twilioRunner).toContain('search_path=pg_catalog, pg_temp');
    expect(twilioRunner).toContain('service_role');
    expect(twilioRunner).toContain("Assert-Marker $apply.Text 'PASS: 17 organization Twilio schema, RLS, grants and call-flow assertions'");
    expect(twilioRunner).toContain("TWILIO_HISTORY_VERIFY|PASS|version=20261031160000 count=1 statements=NULL name=organization_twilio_calling");
    expect(twilioRunner).toMatch(/\$applySql\s*=\s*@"[\s\S]*?\$catalogVerify[\s\S]*?\$testBody[\s\S]*?SELECT true AS twilio_regression_passed \\gset[\s\S]*?\\if :twilio_regression_passed[\s\S]*?\$historyAndCommit/);
    expect(twilioRunner).toContain("Assert-Marker $apply.Text 'PASS: 17 organization Twilio schema, RLS, grants and call-flow assertions'");
    expect(twilioRunner).not.toContain('$testResult = Invoke-LocalPsql');
    expect(twilioRunner).not.toContain('$recordSql =');
    expect(twilioRunner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
    expect(twilioRegression).toMatch(/^BEGIN;[\s\S]*^ROLLBACK;\s*$/m);
    expect(twilioRegression).toContain('PASS: % organization Twilio schema, RLS, grants and call-flow assertions');
    expect(twilioRegression).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|CALL|COPY)\b/im);
    expect(twilioRegression).not.toMatch(/^\s*\\(connect|include|ir|i|!)\b/im);
    expect(twilioRegression).not.toMatch(/https?:\/\/|fetch\s*\(|twilio\.calls|dblink/i);
  });

  it('uses a dedicated read-only 160000 preflight with exact local identity and checksum guards', () => {
    expect(createHash('sha256').update(twilioPreflightBytes).digest('hex').toUpperCase())
      .toBe('6451DED6DEA1DC6CCC59FED84D348D9358E1A6976C2F72AB5E44B022842967E5');
    expect(twilioPreflight).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(twilioPreflight.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(twilioPreflight).toContain("version='20261031150000')<>1");
    expect(twilioPreflight).toContain("version='20261031160000')<>0");
    expect(twilioPreflight).toContain('call_bridges_customer_leg_state_check');
    expect(twilioPreflight).toContain('call_bridges_flow_check');
    expect(twilioPreflight).toContain('call_bridges_telecaller_idempotency_key');
    expect(twilioPreflight).toContain('calls_id_organization_telecaller_unique_idx');
    expect(twilioPreflight).toContain("ARRAY['id','organization_id','telecaller_id']::text[]");
    expect(twilioPreflight).toContain('i.indrelid=\'public.calls\'::pg_catalog.regclass');
    expect(twilioPreflight).toContain('i.indnatts=3 AND i.indnkeyatts=3 AND i.indpred IS NULL');
    expect(twilioPreflight).toContain("c.confrelid='public.calls'::pg_catalog.regclass AND c.confdeltype='c'");
    expect(twilioPreflight).toContain("c.confrelid='public.profiles'::pg_catalog.regclass AND c.confdeltype='c'");
    expect(twilioPreflight).toContain("ARRAY['call_id','organization_id','telecaller_id']::text[]");
    expect(twilioPreflight).toContain("ARRAY['telecaller_id','organization_id']::text[]");
    expect(twilioPreflight).toContain('duplicate Twilio provider_call_id');
    expect(twilioPreflight).toContain('TWILIO_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031160000');
    expect(twilioPreflight).toContain('TWILIO_PREFLIGHT_SAFE_TO_APPLY|FAIL|review required');
    expect(twilioPreflight).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/im);
    expect(twilioPreflight).not.toContain('preflight_pending_migrations');

    expect(twilioPreflightRunner).toContain('6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b');
    expect(twilioPreflightRunner).toContain('/supabase_db_encrix-sql-validation-0ec65673d9ba');
    expect(twilioPreflightRunner).toContain('9B6F8915F688B8709643092E452BCB778CA985BBEE2DAE80E1EFCEFC35DF331D');
    expect(twilioPreflightRunner).toContain('6451DED6DEA1DC6CCC59FED84D348D9358E1A6976C2F72AB5E44B022842967E5');
    expect(twilioPreflightRunner).toContain('Preflight checksum mismatch');
    expect(twilioPreflightRunner.indexOf('$actualPreflightHash'))
      .toBeLessThan(twilioPreflightRunner.indexOf('docker inspect'));
    expect(twilioPreflightRunner).toContain('Migration checksum mismatch');
    expect(twilioPreflightRunner).toContain('TWILIO_PREFLIGHT_SAFE_TO_APPLY\\|PASS\\|target=20261031160000');
    expect(twilioPreflightRunner).not.toMatch(/db\s+(push|reset)|migration\s+repair|54322|https?:\/\//i);
  });
});
