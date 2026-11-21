/**
 * Server-only catalog. The Business plan is the sole purchasable offer. The
 * API still fails closed unless an exact Razorpay Test Mode plan and test
 * credentials are configured and verified at runtime.
 */
export const BILLING_PLAN_CODES = ['starter', 'professional', 'business'] as const;

export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];
export type BillingInterval = 'monthly' | 'yearly';
export type BillingFeature = 'calling' | 'reporting' | 'followUpAutomation';

export interface BillingPlanDraft {
  code: BillingPlanCode;
  displayName: string;
  billingInterval: BillingInterval;
  billingIntervalCount: number;
  currency: 'INR';
  priceInr: number | null;
  telecallerSeatLimit: number | null;
  leadLimit: number | null;
  followUpAutomationLimit: number | null;
  featureEntitlements: Record<BillingFeature, boolean | null>;
  availability: 'draft' | 'available';
  checkoutEnabled: boolean;
}

export const BILLING_PLAN_DRAFTS: Readonly<Record<BillingPlanCode, BillingPlanDraft>> = {
  starter: {
    code: 'starter',
    displayName: 'Starter',
    billingInterval: 'monthly',
    billingIntervalCount: 1,
    currency: 'INR',
    priceInr: null,
    telecallerSeatLimit: null,
    leadLimit: null,
    followUpAutomationLimit: null,
    featureEntitlements: { calling: null, reporting: null, followUpAutomation: null },
    availability: 'draft',
    checkoutEnabled: false,
  },
  professional: {
    code: 'professional',
    displayName: 'Professional',
    billingInterval: 'monthly',
    billingIntervalCount: 1,
    currency: 'INR',
    priceInr: null,
    telecallerSeatLimit: null,
    leadLimit: null,
    followUpAutomationLimit: null,
    featureEntitlements: { calling: null, reporting: null, followUpAutomation: null },
    availability: 'draft',
    checkoutEnabled: false,
  },
  business: {
    code: 'business',
    displayName: 'Business',
    billingInterval: 'yearly',
    billingIntervalCount: 1,
    currency: 'INR',
    priceInr: 9999,
    telecallerSeatLimit: null,
    leadLimit: null,
    followUpAutomationLimit: null,
    featureEntitlements: { calling: null, reporting: null, followUpAutomation: null },
    availability: 'available',
    // Pilot release holds checkout closed until pricing, provider and database
    // lifecycle verification is complete. Tests may opt into synthetic Test Mode.
    checkoutEnabled: false,
  },
};
