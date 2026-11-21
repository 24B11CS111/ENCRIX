import { getSupabaseServerClient, isRealSupabaseServerConfigured } from './supabaseServer.js';

export const PAID_ENTITLEMENT_REQUIRED = 'ACTIVE_SUBSCRIPTION_REQUIRED';
export const PAID_ENTITLEMENT_UNAVAILABLE = 'PAID_ENTITLEMENT_UNAVAILABLE';

export interface PaidEntitlementProfile {
  id?: string;
  organization_id?: string | null;
  role?: string;
  status?: string;
}

export type PaidEntitlementResult =
  | { allowed: true }
  | { allowed: false; reason: 'inactive_profile' | 'missing_organization' | 'not_entitled' | 'unavailable' };

/**
 * Checks a server-resolved profile against the database's authoritative paid
 * entitlement RPC. The organization ID must come from authenticateServerRequest,
 * never from request parameters. Call only after route role/tenant checks.
 */
export async function checkPaidEntitlement(
  profile: PaidEntitlementProfile,
  client?: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<PaidEntitlementResult> {
  if (profile.status !== 'ACTIVE') return { allowed: false, reason: 'inactive_profile' };
  if (typeof profile.organization_id !== 'string' || !profile.organization_id) {
    return { allowed: false, reason: 'missing_organization' };
  }
  if (!client && !isRealSupabaseServerConfigured()) return { allowed: false, reason: 'unavailable' };

  try {
    const db = client || getSupabaseServerClient();
    const { data, error } = await db.rpc('organization_has_active_paid_entitlement', {
      p_organization_id: profile.organization_id,
    });
    if (error || typeof data !== 'boolean') return { allowed: false, reason: 'unavailable' };
    return data ? { allowed: true } : { allowed: false, reason: 'not_entitled' };
  } catch {
    return { allowed: false, reason: 'unavailable' };
  }
}

/** Responds consistently and fails closed when the entitlement authority is unavailable. */
export async function requirePaidEntitlement(
  res: any,
  profile: PaidEntitlementProfile,
  client?: Parameters<typeof checkPaidEntitlement>[1],
): Promise<boolean> {
  const result = await checkPaidEntitlement(profile, client);
  if (result.allowed === true) return true;

  switch (result.reason) {
    case 'unavailable':
      res.status(503).json({ error: PAID_ENTITLEMENT_UNAVAILABLE });
      break;
    case 'inactive_profile':
      res.status(403).json({ error: 'ACCOUNT_NOT_ACTIVE' });
      break;
    case 'missing_organization':
      res.status(403).json({ error: 'ORGANIZATION_REQUIRED' });
      break;
    case 'not_entitled':
      res.status(402).json({ error: PAID_ENTITLEMENT_REQUIRED });
      break;
  }
  return false;
}
