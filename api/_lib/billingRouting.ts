const BILLING_ACTIONS = new Set(['plans', 'checkout', 'reconcile', 'verify', 'webhook', 'subscription', 'business-details', 'pilot-entitlements', 'cancel-subscription', 'refund-request', 'refund-requests', 'refund-detail', 'refund-review']);

export function resolveBillingAction(value: unknown): string | null {
  return typeof value === 'string' && BILLING_ACTIONS.has(value) ? value : null;
}
