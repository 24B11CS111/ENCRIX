import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import { getTwilioServerConfig } from '../_lib/twilioServer.js';
import { db } from '../../src/services/supabase/db.js';

const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TWILIO_CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const TERMINAL_CALL_STATUSES = new Set(['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED']);
const NON_TERMINAL_CALL_STATUSES = ['INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS'];

type PersistedCall = {
  id: string;
  organization_id: string;
  lead_id: string;
  telecaller_id: string;
  provider: string | null;
  provider_call_id: string | null;
  status: string;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
};

function mapTwilioCallStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'queued':
    case 'initiated': return 'INITIATED';
    case 'ringing': return 'RINGING';
    case 'in-progress': return 'IN_PROGRESS';
    case 'completed': return 'COMPLETED';
    case 'busy': return 'BUSY';
    case 'no-answer': return 'NO_ANSWER';
    case 'canceled': return 'CANCELED';
    case 'failed': return 'FAILED';
    default: return null;
  }
}

function isLiveTwilioConfig(config: ReturnType<typeof getTwilioServerConfig>): boolean {
  const values = [config.accountSid, config.authToken];
  return values.every((value) => Boolean(value) && !['test', 'mock', 'placeholder', 'your-'].some(
    (marker) => value.toLowerCase().includes(marker),
  ));
}

async function getAuthorizedCall(callId: string, profile: any): Promise<{
  call: PersistedCall | null;
  supabase: ReturnType<typeof getSupabaseServerClient> | null;
}> {
  let call: PersistedCall | null = null;
  let supabase: ReturnType<typeof getSupabaseServerClient> | null = null;

  if (isRealSupabaseServerConfigured()) {
    supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from('calls')
      .select('id, organization_id, lead_id, telecaller_id, provider, provider_call_id, status, duration_seconds, started_at, ended_at')
      .eq('id', callId)
      .maybeSingle();
    if (error) throw new Error('call_lookup_failed');
    call = data as PersistedCall | null;
  } else {
    call = (db.getCalls(profile) as PersistedCall[]).find((item) => item.id === callId) || null;
  }

  if (!call) return { call: null, supabase };
  if (profile.role !== 'ADMIN' && call.organization_id !== profile.organization_id) {
    return { call: null, supabase };
  }
  if (profile.role === 'TELECALLER' && call.telecaller_id !== profile.id) {
    return { call: null, supabase };
  }

  let lead: { organization_id: string; assigned_to: string | null } | null = null;
  if (supabase) {
    const { data, error } = await supabase
      .from('leads')
      .select('organization_id, assigned_to')
      .eq('id', call.lead_id)
      .maybeSingle();
    if (error) throw new Error('call_lead_lookup_failed');
    lead = data;
  } else {
    const localLead = db.getLeadById(call.lead_id, profile);
    lead = localLead
      ? { organization_id: localLead.organization_id, assigned_to: localLead.assigned_to || null }
      : null;
  }

  if (!lead || lead.organization_id !== call.organization_id) return { call: null, supabase };
  if (profile.role === 'TELECALLER' && lead.assigned_to !== profile.id) {
    return { call: null, supabase };
  }
  return { call, supabase };
}

async function handleCallStatus(callId: string, profile: any, res: any) {
  if (!CALL_ID_PATTERN.test(callId)) return res.status(404).json({ error: 'Call not found' });
  const { call } = await getAuthorizedCall(callId, profile);
  if (!call) return res.status(404).json({ error: 'Call not found' });

  return res.status(200).json({
    callId: call.id,
    status: call.status,
    durationSeconds: call.duration_seconds || 0,
    startedAt: call.started_at,
    endedAt: call.ended_at,
  });
}

async function handleEndCall(callId: string, profile: any, res: any) {
  if (!CALL_ID_PATTERN.test(callId)) return res.status(404).json({ error: 'Call not found' });
  const { call, supabase } = await getAuthorizedCall(callId, profile);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (TERMINAL_CALL_STATUSES.has(call.status)) {
    return res.status(200).json({ callId: call.id, accepted: false, status: call.status });
  }
  if (call.provider !== 'TWILIO' || !call.provider_call_id || !TWILIO_CALL_SID_PATTERN.test(call.provider_call_id)) {
    return res.status(409).json({ error: 'Call provider reference is unavailable' });
  }

  const config = getTwilioServerConfig();
  const isProduction = process.env.NODE_ENV === 'production' ||
    process.env.VITE_APP_ENV === 'production' ||
    process.env.VITE_ENABLE_DEMO_SANDBOX === 'false';
  if (!isLiveTwilioConfig(config) || (!supabase && isProduction)) {
    return res.status(503).json({ error: 'Live call control is unavailable' });
  }

  const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${call.provider_call_id}.json`;
  const authorization = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;
  const providerResponse = await fetch(callUrl, { headers: { Authorization: authorization } });
  if (!providerResponse.ok) return res.status(502).json({ error: 'Unable to confirm call status with provider' });
  const providerCall = await providerResponse.json().catch(() => null);
  const currentProviderStatus = mapTwilioCallStatus(providerCall?.status);
  if (!currentProviderStatus) return res.status(502).json({ error: 'Unable to confirm call status with provider' });

  if (TERMINAL_CALL_STATUSES.has(currentProviderStatus)) {
    // The provider read prevents a redundant termination request, but status
    // persistence remains owned by the signature-verified webhook pipeline.
    return res.status(202).json({ callId: call.id, accepted: false, status: call.status });
  }

  const endResponse = await fetch(callUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ Status: 'completed' }).toString(),
  });
  if (!endResponse.ok) return res.status(502).json({ error: 'Unable to request call termination' });

  // Twilio accepting the update is only an acknowledgement. The status API
  // continues to report persisted state until a verified callback confirms it.
  return res.status(202).json({ callId: call.id, accepted: true, status: call.status });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  try {
    // 1. Authenticate Request
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile || !user) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    // 2. Verify account is ACTIVE
    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    if (req.method === 'GET') {
      const callId = typeof req.query?.callId === 'string' ? req.query.callId : '';
      return await handleCallStatus(callId, profile, res);
    }

    const action = req.body?.action;
    if (action === 'end') {
      const callId = typeof req.body?.callId === 'string' ? req.body.callId : '';
      return await handleEndCall(callId, profile, res);
    }
    if (action && action !== 'start') {
      return res.status(400).json({ error: 'Unsupported call action' });
    }
    if (typeof req.body?.leadId !== 'string' || !req.body.leadId) {
      return res.status(400).json({ error: 'leadId is required' });
    }

    // Resolve authorization before reporting that live dispatch is disabled.
    // This read selects no customer contact data and never creates a call.
    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();
      let leadQuery = supabase
        .from('leads')
        .select('id, organization_id, assigned_to')
        .eq('id', req.body.leadId);
      if (profile.role !== 'ADMIN') {
        leadQuery = leadQuery.eq('organization_id', profile.organization_id);
      }
      const { data: lead, error } = await leadQuery.maybeSingle();
      if (error) throw new Error('call_lead_lookup_failed');
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      if (profile.role === 'TELECALLER' && lead.assigned_to !== profile.id) {
        return res.status(403).json({ error: 'You can only call leads assigned to you' });
      }
    } else {
      // The local data adapter already scopes leads by tenant and, for
      // telecallers, returns only leads assigned to the authenticated profile.
      const authorizedLeads = db.getLeads(profile as Parameters<typeof db.getLeads>[0]);
      if (!authorizedLeads.some((lead) => lead.id === req.body.leadId)) {
        if (profile.role === 'TELECALLER') {
          return res.status(403).json({ error: 'You can only call leads assigned to you' });
        }
        return res.status(404).json({ error: 'Lead not found' });
      }
    }

    // This route cannot safely dispatch until the two-leg bridge, verified
    // caller identity, and service-only leg persistence are deployed together.
    // Local/demo calls are handled by the browser's mock provider instead.
    return res.status(503).json({
      error: 'Secure call bridge is not configured. Please contact support.',
    });
  } catch {
    console.error('Telephony call operation failed');
    return res.status(502).json({ error: 'Call operation failed. Please try again or contact support.' });
  }
}
