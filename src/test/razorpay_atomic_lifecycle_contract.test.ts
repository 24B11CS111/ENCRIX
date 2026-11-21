import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const api = readFileSync(resolve(root, 'api/_lib/billingApi.ts'), 'utf8');
const plan = readFileSync(resolve(root, 'api/_lib/billingPlans.ts'), 'utf8');
const security = readFileSync(resolve(root, 'api/_lib/billingSecurity.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20261031170000_razorpay_atomic_subscription_lifecycle.sql'), 'utf8');
const activeStatusCorrection = readFileSync(resolve(root, 'supabase/migrations/20261105150000_razorpay_active_subscription_required.sql'), 'utf8');
const sqlTest = readFileSync(resolve(root, 'supabase/tests/razorpay_atomic_subscription_lifecycle.test.sql'), 'utf8');

describe('Razorpay atomic lifecycle migration contract', () => {
  it('uses one server-only transaction for payment identity, refund amount and subscription status', () => {
    expect(migration.startsWith('--')).toBe(true);
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('ON CONFLICT (razorpay_payment_id) DO UPDATE');
    expect(migration).toContain('razorpay_payment_identity_or_amount_conflict');
    expect(migration).toContain('amount_refunded_paise');
    expect(migration).toContain("'past_due'");
    expect(migration).toContain("'active'");
    expect(migration).toContain("'expired'");
    expect(migration).toContain('SET search_path = pg_catalog, pg_temp');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });

  it('requires an active provider subscription as well as a verified current-period capture', () => {
    expect(activeStatusCorrection).toMatch(/^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/i);
    expect(activeStatusCorrection).toContain("p_provider_subscription_status = 'active' AND v_has_current_period_capture");
    expect(activeStatusCorrection).not.toContain('ELSIF v_has_current_period_capture THEN');
    expect(sqlTest).toContain('A captured payment activated a non-active provider subscription');
  });

  it('routes both browser verification and signed webhooks through the transaction RPC', () => {
    expect(api).toContain("supabase.rpc('apply_verified_razorpay_payment'");
    expect(api).toContain('verifySubscriptionCheckoutSignature');
    expect(api).toContain('verifyRazorpayWebhookSignature(rawBody');
    expect(api).toContain('remoteSubscription.notes?.encrix_organization_id');
    expect(api).toContain('remoteSubscription.notes?.encrix_subscription_record_id');
    expect(api).toContain('payment.amount !== local.data.amount_paise');
    expect(api).toContain("payment.currency !== 'INR'");
    expect(api).toContain('amount_refunded');
  });

  it('keeps the only catalog price fixed at ₹9,999/year and requires Test Mode credentials', () => {
    expect(plan).toContain("priceInr: 9999");
    expect(plan).toContain("availability: 'available'");
    expect(plan).toContain('checkoutEnabled: false');
    expect(security).toContain('/^rzp_test_[A-Za-z0-9]+$/');
    expect(security).not.toContain('rzp_live_');
  });

  it('keeps SQL fixtures transactional and asserts identity, replay, refund, and role safety', () => {
    expect(sqlTest).toContain('BEGIN;');
    expect(sqlTest.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    for (const assertion of [
      'Failed payment activated',
      'Duplicate or out-of-order payment event',
      'Partial refund handling',
      'Full refund did not remove active billing status',
      'different subscription',
      'different organization',
      'service-role-only',
    ]) expect(sqlTest).toContain(assertion);
  });

  it('uses provider-shaped Razorpay identifiers in success and negative-case fixtures', () => {
    expect(sqlTest).toContain("'pay_' || replace(extensions.uuid_generate_v4()::text, '-', '')");
    expect(sqlTest).toContain("'sub_' || replace(extensions.uuid_generate_v4()::text, '-', '')");
    expect(sqlTest).toContain("'pay_badamount'");
    expect(sqlTest).toContain("'pay_badcurrency'");
    expect(sqlTest).toContain("'pay_badrefund'");
    expect(sqlTest).not.toContain('pay_encrix_');
    expect(sqlTest).not.toContain('sub_encrix_');
  });
});
