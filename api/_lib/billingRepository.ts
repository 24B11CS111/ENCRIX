export interface SubscriptionQuery {
  from(table: string): any;
}

export async function getSubscriptionForOrganization(db: SubscriptionQuery, organizationId: string) {
  return db.from('organization_subscriptions')
    .select('id, plan_code, status, entitlement_source, checkout_creation_status, current_period_start, current_period_end, cancel_at_period_end, cancellation_request_status, cancellation_requested_at, cancellation_effective_at, cancellation_provider_status, cancelled_at, ended_at, last_payment_at')
    .eq('organization_id', organizationId)
    .eq('is_current', true)
    .maybeSingle();
}
