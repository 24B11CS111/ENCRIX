import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../supabaseServer.js';
import { getRequiredServerSecret } from '../serverSecret.js';
import { isLiveEmailConfigured } from '../otpServer.js';

const DEPENDENCY_TIMEOUT_MS = 1500;

/** Safe liveness/readiness probe. It returns configuration state, never values. */
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const probe = req.query?.probe === 'ready' ? 'ready' : 'live';
  if (probe === 'live') {
    return res.status(200).json({ live: true, ready: null, status: 'alive' });
  }

  const missing: string[] = [];
  if (!isRealSupabaseServerConfigured()) missing.push('database_configuration');
  try { getRequiredServerSecret('OTP_SERVER_SECRET'); } catch { missing.push('authentication_configuration'); }
  try { getRequiredServerSecret('SESSION_SERVER_SECRET'); } catch { missing.push('session_configuration'); }
  if (!isLiveEmailConfigured()) missing.push('email_configuration');

  if (missing.length) {
    return res.status(503).json({ live: true, ready: false, status: 'degraded', checks: { application: 'ok', configuration: 'incomplete' } });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = getSupabaseServerClient();
    const query = client.from('profiles').select('id', { head: true, count: 'exact' }).limit(1);
    const result = await Promise.race([
      query,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), DEPENDENCY_TIMEOUT_MS); }),
    ]) as { error?: unknown };
    if (timeout) clearTimeout(timeout);
    if (result.error) throw new Error('dependency_unavailable');
    return res.status(200).json({ live: true, ready: true, status: 'healthy', checks: { application: 'ok', configuration: 'ready', database: 'available' } });
  } catch {
    if (timeout) clearTimeout(timeout);
    return res.status(503).json({ live: true, ready: false, status: 'unavailable', checks: { application: 'ok', configuration: 'ready', database: 'unavailable' } });
  }
}
