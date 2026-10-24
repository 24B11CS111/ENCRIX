import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20261024100000_phase24_1_security_remediation.sql',
), 'utf8');
const priorEnrollmentMigration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20261023120000_secure_caller_enrollment_bridge_persistence.sql',
), 'utf8');
const webhook = readFileSync(resolve(process.cwd(), 'api/telephony/webhook.ts'), 'utf8');

describe('Phase 24.1 database security migration contract', () => {
  it('removes browser and inherited grants from the disabled call initiation RPC', () => {
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON FUNCTION public\.initiate_authorized_call\(UUID\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/aclexplode[\s\S]*?REVOKE ALL PRIVILEGES ON FUNCTION public\.initiate_authorized_call\(UUID\) FROM %I/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.initiate_authorized_call/i);
  });

  it('guards phone fields on authenticated profile inserts and updates while preserving service enrollment completion', () => {
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON public\.profiles/i);
    expect(migration).toMatch(/TG_OP = 'INSERT'[\s\S]*?NEW\.phone IS NOT NULL[\s\S]*?NEW\.phone_verified IS DISTINCT FROM FALSE/i);
    expect(migration).toMatch(/NEW\.phone IS DISTINCT FROM OLD\.phone[\s\S]*?NEW\.phone_verified IS DISTINCT FROM OLD\.phone_verified/i);
    expect(priorEnrollmentMigration).toMatch(/REVOKE ALL ON FUNCTION public\.complete_caller_phone_enrollment\(UUID, UUID, BOOLEAN\)[\s\S]*?FROM PUBLIC, anon, authenticated/i);
    expect(priorEnrollmentMigration).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_caller_phone_enrollment\(UUID, UUID, BOOLEAN\)[\s\S]*?TO service_role/i);
    expect(priorEnrollmentMigration).toMatch(/SET phone = v_enrollment\.phone_number,[\s\S]*?phone_verified = TRUE/i);
  });

  it('preserves row-level assignment controls and limits telecaller edits to status and notes', () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_restrict_telecaller_lead_update_columns[\s\S]*?BEFORE UPDATE ON public\.leads/i);
    expect(migration).toMatch(/OLD\.organization_id IS DISTINCT FROM v_profile\.organization_id[\s\S]*?OLD\.assigned_to IS DISTINCT FROM v_profile\.id/i);
    expect(migration).toMatch(/to_jsonb\(NEW\) - ARRAY\['status', 'notes'\][\s\S]*?to_jsonb\(OLD\) - ARRAY\['status', 'notes'\]/i);
  });

  it('does not publish call status on a broadcast channel without private-channel authorization', () => {
    expect(webhook).not.toMatch(/\.channel\s*\(/);
    expect(webhook).toMatch(/No Broadcast channel is used here/i);
  });
});
