import detailHandler from './_lib/leads/detail.js';
import distributeHandler from './_lib/leads/distribute.js';
import distributionConfigHandler from './_lib/leads/distribution-config.js';
import telecallerLeadsHandler from './_lib/leads/telecaller.js';
import ownerHandler from './_lib/leads/owner.js';
import { resolveLeadAction } from './_lib/leadRouting.js';

const LEAD_ACTIONS = {
  detail: detailHandler,
  distribute: distributeHandler,
  'distribution-config': distributionConfigHandler,
  'telecaller-list': telecallerLeadsHandler,
  'telecaller-update': telecallerLeadsHandler,
  'owner-list': ownerHandler,
  'owner-create': ownerHandler,
  'owner-assign': ownerHandler,
  'owner-update': ownerHandler,
} as const;

export default async function handler(req: any, res: any) {
  const action = resolveLeadAction(req.query?._route);
  if (!action) return res.status(404).json({ error: 'Not Found' });
  return LEAD_ACTIONS[action](req, res);
}
