const BILLING_ACTIONS = new Set(['plans', 'checkout', 'verify', 'webhook', 'subscription']);

export function resolveBillingAction(value: unknown): string | null {
  return typeof value === 'string' && BILLING_ACTIONS.has(value) ? value : null;
}
