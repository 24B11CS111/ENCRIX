export interface SubscriptionQuery {
  from(table: string): any;
}

export async function getSubscriptionForOrganization(db: SubscriptionQuery, organizationId: string) {
  return db.from('organization_subscriptions')
    .select('id, plan_code, status, entitlement_source, current_period_start, current_period_end, cancel_at_period_end, cancelled_at, ended_at, last_payment_at')
    .eq('organization_id', organizationId)
    .eq('is_current', true)
    .maybeSingle();
}
