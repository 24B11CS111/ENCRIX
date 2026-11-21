import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const candidateDir = resolve(root, 'docs/sql/validated_candidate_migrations');
const read = (filename: string) => readFileSync(resolve(candidateDir, filename), 'utf8');
const registrationRateLimitMigration = readFileSync(
  resolve(root, 'supabase/migrations/20261105160000_registration_otp_send_rate_limit.sql'),
  'utf8',
);

describe('reviewed billing candidate migration contract', () => {
  it('bounds 230, 300, and 310 in explicit transactions', () => {
    for (const filename of [
      '20261023000000_billing_foundation_candidate.sql',
      '20261030000000_owner_business_billing_details_candidate.sql',
      '20261031000000_onboarding_billing_integrity_candidate.sql',
    ]) {
      const sql = read(filename).trim();
      expect(sql).toMatch(/^BEGIN;[\s\S]*COMMIT;$/i);
    }
  });

  it('revokes default billing table access and grants only API-required service-role operations', () => {
    const sql = read('20261023000000_billing_foundation_candidate.sql');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.organization_subscriptions FROM PUBLIC, anon, authenticated, service_role;');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.billing_payments FROM PUBLIC, anon, authenticated, service_role;');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE public.billing_webhook_events FROM PUBLIC, anon, authenticated, service_role;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.organization_subscriptions TO service_role;');
    expect(sql).toContain('GRANT SELECT ON TABLE public.billing_payments TO service_role;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_webhook_events TO service_role;');
    expect(sql).not.toMatch(/GRANT\s+ALL\s+ON\s+TABLE/i);
  });

  it('validates exact existing indexes before idempotent index creation', () => {
    const sql = read('20261030000000_owner_business_billing_details_candidate.sql');
    expect(sql).toContain('DO $index_definition_preflight$');
    expect(sql).toContain('indisunique');
    expect(sql).toContain('indisvalid');
    expect(sql).toContain('indisready');
    expect(sql).toContain('indnkeyatts');
    expect(sql).toContain('indnatts');
    expect(sql).toContain('pg_get_expr(i.indexprs, i.indrelid)');
    expect(sql).toContain('pg_get_expr(i.indpred, i.indrelid)');
    expect(sql).toContain('i.indkey[0]');
    expect(sql).toContain('pg_get_expr(i.indexprs, i.indrelid)');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_lower');
    expect(sql).toContain('ON public.profiles (LOWER(BTRIM(email)))');
    expect(sql).toContain("<> 'lowerbtrimemail::text'");
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_id_unique');
  });

  it('revokes trigger-only function EXECUTE without removing the trigger', () => {
    const sql = read('20261031000000_onboarding_billing_integrity_candidate.sql');
    const triggerAt = sql.indexOf('CREATE TRIGGER protect_billing_payment_identity');
    const revokeAt = sql.indexOf('REVOKE ALL PRIVILEGES ON FUNCTION public.protect_billing_payment_identity()');
    expect(triggerAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(triggerAt);
    expect(sql.slice(revokeAt, revokeAt + 180)).toContain('FROM PUBLIC, anon, authenticated, service_role;');
  });

  it('limits registration OTP sends in the database rolling window', () => {
    const sql = read('20261031000000_onboarding_billing_integrity_candidate.sql');
    expect(sql).toContain('registration_otp_attempts_email_created_at_idx');
    expect(sql).toContain("created_at >= v_now - INTERVAL '15 minutes'");
    expect(sql).toContain("'rate_limited', TRUE");
    expect(sql).toContain("p_expires_at > v_now + INTERVAL '15 minutes'");
    expect(registrationRateLimitMigration).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/i);
    expect(registrationRateLimitMigration).toContain("'rate_limited', TRUE");
    expect(registrationRateLimitMigration).toContain('REVOKE ALL ON FUNCTION public.issue_registration_otp_ticket');
    expect(registrationRateLimitMigration).toContain('TO service_role');
  });

  it('keeps lifecycle and entitlement functions server-only with fixed definer paths', () => {
    const lifecycle = read('20261031170000_razorpay_atomic_subscription_lifecycle_candidate.sql');
    const entitlement = read('20261031180000_paid_subscription_entitlement_gate_candidate.sql');
    expect(lifecycle).toMatch(/BEGIN;[\s\S]*COMMIT;/i);
    expect(entitlement).toMatch(/BEGIN;[\s\S]*COMMIT;/i);
    for (const sql of [lifecycle, entitlement]) {
      expect(sql).toContain('SECURITY DEFINER');
      expect(sql).toContain('SET search_path = pg_catalog, pg_temp');
      expect(sql).toContain('FROM PUBLIC, anon, authenticated');
      expect(sql).toContain('TO service_role');
    }
    expect(lifecycle).toContain("p_provider_subscription_status = 'active' AND v_has_current_period_capture");
  });

  it('keeps verified full refunds from failed payments within a narrow state transition', () => {
    const correction = read('20261105130000_razorpay_failed_refund_transition_candidate.sql');
    expect(correction).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/i);
    expect(correction).toContain("OLD.status = 'failed' AND NEW.status = 'captured'");
    expect(correction).toContain("OLD.status = 'failed' AND NEW.status = 'refunded'");
    expect(correction).toContain('NEW.amount_refunded_paise = NEW.amount_paise');
    expect(correction).toContain('NEW.signature_verified_at IS NOT NULL');
    expect(correction).toContain('NEW.paid_at IS NOT NULL');
    expect(correction).toContain('OLD.organization_id IS DISTINCT FROM NEW.organization_id');
    expect(correction).toContain('OLD.subscription_id IS DISTINCT FROM NEW.subscription_id');
  });

  it('requires provider-shaped Razorpay IDs in paid-entitlement decisions', () => {
    const correction = read('20261105140000_paid_entitlement_provider_identity_candidate.sql');
    expect(correction).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/i);
    expect(correction).toContain("s.razorpay_subscription_id ~ '^sub_[A-Za-z0-9]+$'");
    expect(correction).toContain("p.razorpay_payment_id ~ '^pay_[A-Za-z0-9]+$'");
    expect(correction).toContain('FROM PUBLIC, anon, authenticated');
    expect(correction).toContain('TO service_role');
  });
});
