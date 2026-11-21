import { authenticateServerRequest, getSupabaseServerClient } from './supabaseServer.js';
import { parseBillingJsonObject } from './billingRequest.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, profile, error } = await authenticateServerRequest(req);
  if (error || !user || !profile) return res.status(401).json({ error: 'Authentication required' });
  if (profile.status !== 'ACTIVE' || profile.role !== 'ADMIN' || !UUID_PATTERN.test(profile.id || '')) {
    return res.status(403).json({ error: 'Only an active platform administrator can manage pilot access' });
  }
  if (process.env.FOUNDING_PILOT_GRANTS_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Founding pilot access administration is not enabled' });
  }

  const body = await parseBillingJsonObject(req);
  if (!body) return res.status(400).json({ error: 'A valid JSON object is required' });
  const organizationId = body.organizationId;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (typeof organizationId !== 'string' || !UUID_PATTERN.test(organizationId) || reason.length < 6 || reason.length > 500) {
    return res.status(400).json({ error: 'Provide a valid organization and an audit reason of 6 to 500 characters' });
  }

  try {
    const supabase = getSupabaseServerClient();
    if (body.action === 'grant') {
      const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : '';
      const expiresAtMs = Date.parse(expiresAt);
      const now = Date.now();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now || expiresAtMs > now + 365 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Pilot access expiry must be in the future and no more than 365 days away' });
      }
      const { data, error: rpcError } = await supabase.rpc('grant_founding_pilot_entitlement', {
        p_organization_id: organizationId,
        p_granted_by: profile.id,
        p_expires_at: new Date(expiresAtMs).toISOString(),
        p_reason: reason,
      });
      if (rpcError) {
        if (rpcError.code === '42501') return res.status(403).json({ error: 'Administrator authorization was rejected' });
        if (rpcError.code === '23505') return res.status(409).json({ error: 'This organization already has active pilot access' });
        if (rpcError.code === '23514') return res.status(409).json({ error: 'The three-organization founding pilot capacity is full' });
        if (rpcError.code === '22023') return res.status(400).json({ error: 'Pilot access details are invalid' });
        return res.status(503).json({ error: 'Pilot access could not be granted' });
      }
      if (typeof data !== 'string' || !UUID_PATTERN.test(data)) {
        return res.status(503).json({ error: 'Pilot access could not be confirmed' });
      }
      return res.status(201).json({ entitlementId: data, organizationId, expiresAt: new Date(expiresAtMs).toISOString() });
    }

    if (body.action === 'revoke') {
      const entitlementId = body.entitlementId;
      if (typeof entitlementId !== 'string' || !UUID_PATTERN.test(entitlementId)) return res.status(400).json({ error: 'Provide a valid pilot entitlement ID' });
      const { data, error: rpcError } = await supabase.rpc('revoke_founding_pilot_entitlement', {
        p_organization_id: organizationId,
        p_entitlement_id: entitlementId,
        p_revoked_by: profile.id,
        p_reason: reason,
      });
      if (rpcError) {
        if (rpcError.code === '42501') return res.status(403).json({ error: 'Administrator authorization was rejected' });
        if (rpcError.code === '22023') return res.status(400).json({ error: 'Pilot access details are invalid' });
        return res.status(503).json({ error: 'Pilot access could not be revoked' });
      }
      if (data !== true) return res.status(404).json({ error: 'Active pilot entitlement was not found for this organization' });
      return res.status(200).json({ revoked: true, organizationId, entitlementId });
    }

    return res.status(400).json({ error: 'Action must be grant or revoke' });
  } catch {
    return res.status(503).json({ error: 'Pilot access service is temporarily unavailable' });
  }
}
