import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLAN_CODES,
  BILLING_PLAN_DRAFTS,
  isSubscriptionEnforcementEnabled,
} from '../../api/_lib/billingPlans.js';

describe('billing foundation', () => {
  it('defines the three monthly INR plans as non-purchasable placeholders', () => {
    expect(BILLING_PLAN_CODES).toEqual(['starter', 'professional', 'business']);

    for (const plan of Object.values(BILLING_PLAN_DRAFTS)) {
      expect(plan.billingInterval).toBe('monthly');
      expect(plan.currency).toBe('INR');
      expect(plan.availability).toBe('draft');
      expect(plan.checkoutEnabled).toBe(false);
      expect(plan.priceInr).toBeNull();
      expect(plan.telecallerSeatLimit).toBeNull();
      expect(plan.leadLimit).toBeNull();
      expect(plan.followUpAutomationLimit).toBeNull();
      expect(Object.values(plan.featureEntitlements).every((value) => value === null)).toBe(true);
    }
  });

  it('keeps entitlement enforcement disabled unless the server flag is exactly true', () => {
    const original = process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
    try {
      delete process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
      expect(isSubscriptionEnforcementEnabled()).toBe(false);
      process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = 'false';
      expect(isSubscriptionEnforcementEnabled()).toBe(false);
      process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = 'true';
      expect(isSubscriptionEnforcementEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
      else process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = original;
    }
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
