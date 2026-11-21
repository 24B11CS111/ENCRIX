import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLAN_CODES,
  BILLING_PLAN_DRAFTS,
} from '../../api/_lib/billingPlans.js';

describe('billing foundation', () => {
  it('keeps only the annual Business plan purchasable at the approved price', () => {
    expect(BILLING_PLAN_CODES).toEqual(['starter', 'professional', 'business']);

    for (const plan of Object.values(BILLING_PLAN_DRAFTS)) {
      expect(plan.currency).toBe('INR');
      expect(plan.telecallerSeatLimit).toBeNull();
      expect(plan.leadLimit).toBeNull();
      expect(plan.followUpAutomationLimit).toBeNull();
      expect(Object.values(plan.featureEntitlements).every((value) => value === null)).toBe(true);
    }

    expect(BILLING_PLAN_DRAFTS.starter.availability).toBe('draft');
    expect(BILLING_PLAN_DRAFTS.starter.checkoutEnabled).toBe(false);
    expect(BILLING_PLAN_DRAFTS.professional.availability).toBe('draft');
    expect(BILLING_PLAN_DRAFTS.professional.checkoutEnabled).toBe(false);

    expect(BILLING_PLAN_DRAFTS.starter.priceInr).toBeNull();
    expect(BILLING_PLAN_DRAFTS.professional.priceInr).toBeNull();
    expect(BILLING_PLAN_DRAFTS.starter.billingInterval).toBe('monthly');
    expect(BILLING_PLAN_DRAFTS.professional.billingInterval).toBe('monthly');
    expect(BILLING_PLAN_DRAFTS.business).toMatchObject({
      billingInterval: 'yearly',
      billingIntervalCount: 1,
      currency: 'INR',
      priceInr: 9999,
      availability: 'available',
      checkoutEnabled: false,
    });
  });

  it('does not use a feature flag that could accidentally bypass paid entitlement checks', () => {
    const planSource = readFileSync(resolve(process.cwd(), 'api/_lib/billingPlans.ts'), 'utf8');
    expect(planSource).not.toContain('SUBSCRIPTION_ENFORCEMENT_ENABLED');
  });

  it('keeps plan configuration server-only and billing writes unavailable to browser roles', () => {
    const planSource = readFileSync(resolve(process.cwd(), 'api/_lib/billingPlans.ts'), 'utf8');
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20261023000000_billing_foundation.sql'),
      'utf8',
    );

    expect(planSource).not.toContain('import.meta.env');
    for (const table of ['organization_subscriptions', 'billing_payments', 'billing_webhook_events']) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
      expect(migration).toContain(`GRANT ALL ON TABLE public.${table} TO service_role`);
    }
    expect(migration).toContain('UNIQUE (provider, provider_event_id)');
    expect(migration).toContain('organization_subscriptions_one_current_per_org');
  });
});
