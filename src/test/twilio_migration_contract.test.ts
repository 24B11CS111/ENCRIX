import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20261031160000_organization_twilio_calling.sql');
const regressionPath = resolve(process.cwd(), 'supabase/tests/organization_twilio_calling.test.sql');
const runnerPath = resolve(process.cwd(), 'supabase/tests/apply_20261031160000_local.ps1');
const migration = readFileSync(migrationPath, 'utf8');
const sqlTest = readFileSync(regressionPath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

describe('organization Twilio calling migration contract', () => {
  it('stores only an authenticated encryption envelope and a phone lookup value', () => {
    expect(migration).toMatch(/CREATE TABLE public\.organization_twilio_credentials/i);
    expect(migration).toMatch(/twilio_phone_number TEXT NOT NULL/i);
    expect(migration).toMatch(/key_id TEXT NOT NULL/i);
    expect(migration).toMatch(/nonce TEXT NOT NULL/i);
    expect(migration).toMatch(/ciphertext TEXT NOT NULL/i);
    expect(migration).toMatch(/auth_tag TEXT NOT NULL/i);
    expect(migration).not.toMatch(/auth_token\s+TEXT/i);
    expect(migration).toMatch(/organization_twilio_active_phone_uidx/i);
  });

  it('restricts credential and call mutation tables and RPCs to service_role', () => {
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.organization_twilio_credentials FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\.organization_twilio_credentials TO service_role/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.telephony_inbound_attempts FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).not.toMatch(/GRANT ALL ON TABLE public\.telephony_inbound_attempts/i);
    expect(migration.match(/SET search_path = pg_catalog, pg_temp/gi)?.length).toBeGreaterThanOrEqual(5);
    expect(migration).toMatch(/prepare_twilio_outbound_call[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, pg_temp/i);
    expect(migration).toMatch(/claim_twilio_customer_leg[\s\S]*?FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.prepare_twilio_inbound_call\(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ\) TO service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_organization_twilio_credentials[\s\S]*?TO service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.revoke_organization_twilio_credentials[\s\S]*?TO service_role/i);
  });

  it('serializes idempotency, requires current assignment and verified callers, and claims only one customer leg', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock[\s\S]*?p_idempotency_key/i);
    expect(migration).toMatch(/l\.assigned_to = p_telecaller_id/i);
    expect(migration).toMatch(/p\.phone_verified IS TRUE/i);
    expect(migration).toMatch(/l\.status <> 'DO_NOT_CONTACT'/i);
    expect(migration).toMatch(/customer_leg_state = 'CREATING'[\s\S]*?AND b\.customer_provider_call_id IS NULL/i);
    expect(migration).toMatch(/b\.flow = 'OUTBOUND'[\s\S]*?b\.status IN \('PREPARING', 'WAITING_FOR_CALLER', 'CALLER_CONNECTED'\)[\s\S]*?c\.status IN \('INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS'\)/i);
    expect(migration).toMatch(/p_twilio_config_updated_at IS NULL[\s\S]*?FOR UPDATE[\s\S]*?twilio_configuration_changed/i);
  });

  it('resolves incoming requests by one exact lead and one active verified assigned telecaller', () => {
    expect(migration).toMatch(/COUNT\(\*\).*?organization_id = p_organization_id AND l\.phone = p_from_phone/is);
    expect(migration).toMatch(/AMBIGUOUS_LEAD/);
    expect(migration).toMatch(/NO_ELIGIBLE_TELECALLER/);
    expect(migration).toMatch(/p\.status = 'ACTIVE'[\s\S]*?p\.phone_verified IS TRUE/i);
    expect(migration).toMatch(/p_twilio_phone_number TEXT[\s\S]*?t\.twilio_phone_number = p_twilio_phone_number[\s\S]*?twilio_configuration_changed/i);
  });

  it('keeps the SQL regression test transactional and checks browser denial and function grants', () => {
    expect(sqlTest.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sqlTest.trimEnd()).toMatch(/ROLLBACK;$/);
    expect(sqlTest).toMatch(/has_table_privilege\('anon',[\s\S]*?encrypted organization credentials/is);
    expect(sqlTest).toMatch(/has_function_privilege\('authenticated', v_proc, 'EXECUTE'\)/i);
    expect(sqlTest).toMatch(/service_role credential table ACL is/i);
    expect(sqlTest).toMatch(/has_table_privilege\('service_role', v_table, 'MAINTAIN'\)/i);
    expect(sqlTest).toMatch(/pg_advisory_xact_lock/);
  });

  it('keeps the inbound parent SID canonical when attaching the telecaller child leg', () => {
    expect(migration).toMatch(/RETURNING b\.flow INTO v_flow/i);
    expect(migration).toMatch(/IF v_updated AND v_flow = 'OUTBOUND' THEN/i);
    expect(sqlTest).toMatch(/inbound telecaller child SID can overwrite the parent call identity/i);
  });

  it('diagnoses all Twilio column defaults and resolves the UUID default semantically', () => {
    for (const column of [
      "('public','organization_twilio_credentials','status'",
      "('public','organization_twilio_credentials','created_at'",
      "('public','organization_twilio_credentials','updated_at'",
      "('public','telephony_inbound_attempts','id'",
      "('public','telephony_inbound_attempts','created_at'",
      "('public','call_bridges','flow'",
    ]) {
      expect(runner).toContain(column);
    }
    expect(runner).toContain('TWILIO_DEFAULT_DIAGNOSTIC|schema=%|table=%|column=%');
    expect(runner).toContain("dep.refobjid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')");
    expect(runner).toContain("IN ('extensions.uuid_generate_v4()','uuid_generate_v4()')");
    expect(migration).toMatch(/status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'ACTIVE'/i);
    expect(runner).toContain("regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::text$','')='''ACTIVE''')");
    expect(runner).toContain("regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::text$','')='''OUTBOUND'''");
    expect(runner).not.toContain("regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::text$','','i')");
    expect(runner).toContain("'Twilio column default contract mismatch'");
  });
});
