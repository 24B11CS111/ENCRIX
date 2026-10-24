/**
 * Server-only draft catalog. Commercial values intentionally remain unset until
 * approved; checkout must reject every plan while checkoutEnabled is false.
 */
export const BILLING_PLAN_CODES = ['starter', 'professional', 'business'] as const;

export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];
export type BillingFeature = 'calling' | 'reporting' | 'followUpAutomation';

export interface BillingPlanDraft {
  code: BillingPlanCode;
  displayName: string;
  billingInterval: 'monthly';
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
    billingInterval: 'monthly',
    currency: 'INR',
    priceInr: null,
    telecallerSeatLimit: null,
    leadLimit: null,
    followUpAutomationLimit: null,
    featureEntitlements: { calling: null, reporting: null, followUpAutomation: null },
    availability: 'draft',
    checkoutEnabled: false,
  },
};

/** Server-only rollout switch; unset and all values other than "true" fail open. */
export function isSubscriptionEnforcementEnabled(): boolean {
  return process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED === 'true';
}
