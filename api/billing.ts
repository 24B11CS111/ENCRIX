import { handleBillingAction } from './_lib/billingApi.js';
import { resolveBillingAction } from './_lib/billingRouting.js';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: any, res: any) {
  const action = resolveBillingAction(req.query?._route);
  if (!action) return res.status(404).json({ error: 'Not Found' });
  try {
    return await handleBillingAction(action, req, res);
  } catch {
    return res.status(500).json({ error: 'BILLING_REQUEST_FAILED' });
  }
}
