import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import { getOrganizationTwilioConfig } from '../_lib/twilioOrganizationConfig.js';
import { createOrganizationTwilioCall, endOrganizationTwilioCall, isTwilioCallingEnabled, telephonyWebhookUrl } from '../_lib/twilioRest.js';
import { db } from '../../src/services/supabase/db.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';
import { requirePaidEntitlement } from '../_lib/paidEntitlement.js';

const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TWILIO_CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const TERMINAL_CALL_STATUSES = new Set(['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED']);

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
  // The call record binds control to its original telecaller. A later lead
  // reassignment must not prevent that caller from seeing or ending an active
  // call they initiated; new calls are rechecked against current assignment.
  return { call, supabase };
}

async function handleCallStatus(callId: string, profile: any, res: any) {
  if (!CALL_ID_PATTERN.test(callId)) return res.status(404).json({ error: 'Call not found' });
  const { call } = await getAuthorizedCall(callId, profile);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!await requirePaidEntitlement(res, profile)) return;

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
  if (call.provider !== 'TWILIO') {
    return res.status(409).json({ error: 'Call provider reference is unavailable' });
  }
  if (!supabase) return res.status(503).json({ error: 'Live call control is unavailable' });
  const { data: bridge, error: bridgeError } = await supabase
    .from('call_bridges')
    .select('caller_provider_call_id, customer_provider_call_id, organization_id')
    .eq('call_id', call.id)
    .eq('organization_id', call.organization_id)
    .maybeSingle();
  if (bridgeError) return res.status(503).json({ error: 'Call control is temporarily unavailable' });
  const callSids = [bridge?.caller_provider_call_id, bridge?.customer_provider_call_id]
    .filter((value): value is string => typeof value === 'string' && TWILIO_CALL_SID_PATTERN.test(value));
  if (callSids.length === 0) return res.status(409).json({ error: 'Call provider reference is unavailable' });
  const config = await getOrganizationTwilioConfig(supabase, call.organization_id);
  if (!config) return res.status(503).json({ error: 'Organization Twilio configuration is unavailable' });
  const results = await Promise.all(callSids.map((sid) => endOrganizationTwilioCall(config.credentials, sid)));
  if (results.some((result) => result === 'UNAVAILABLE')) {
    return res.status(502).json({ error: 'Unable to request call termination' });
  }
  // Twilio acceptance is only an acknowledgement; signed callbacks persist status.
  return res.status(202).json({ callId: call.id, accepted: results.includes('ENDED'), status: call.status });
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
    if (profile.role !== 'TELECALLER') {
      return res.status(403).json({ error: 'Only an assigned telecaller can initiate a call' });
    }
    if (typeof req.body?.leadId !== 'string' || !CALL_ID_PATTERN.test(req.body.leadId)) {
      return res.status(400).json({ error: 'leadId is required' });
    }
    const idempotencyKey = req.body?.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !CALL_ID_PATTERN.test(idempotencyKey)) {
      return res.status(400).json({ error: 'A valid call request id is required' });
    }
    if (!isTwilioCallingEnabled()) {
      return res.status(503).json({ error: 'Live calling is disabled until the deployment has passed its telephony verification gate' });
    }
    if (!isRealSupabaseServerConfigured()) {
      return res.status(503).json({ error: 'Secure calling is unavailable until the server database is configured' });
    }

    const supabase = getSupabaseServerClient();
    const { data: caller, error: callerError } = await supabase
      .from('profiles')
      .select('id, organization_id, role, status, phone, phone_verified')
      .eq('id', profile.id)
      .maybeSingle();
    if (callerError) return res.status(503).json({ error: 'Caller authorization is temporarily unavailable' });
    if (!caller || caller.organization_id !== profile.organization_id || caller.role !== 'TELECALLER'
        || caller.status !== 'ACTIVE' || caller.phone_verified !== true) {
      return res.status(403).json({ error: 'Verify an active caller phone before placing calls' });
    }
    const callerPhone = normalizePhoneNumber(caller.phone || '');
    if (!callerPhone.isValid) return res.status(409).json({ error: 'Verified caller phone is unavailable' });

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, organization_id, assigned_to, phone, status')
      .eq('id', req.body.leadId)
      .eq('organization_id', caller.organization_id)
      .eq('assigned_to', caller.id)
      .maybeSingle();
    if (leadError) return res.status(503).json({ error: 'Lead authorization is temporarily unavailable' });
    if (!lead) return res.status(404).json({ error: 'Assigned lead not found' });
    if (lead.status === 'DO_NOT_CONTACT') return res.status(409).json({ error: 'This lead is marked do not contact' });
    if (!await requirePaidEntitlement(res, profile, supabase)) return;
    const customerPhone = normalizePhoneNumber(lead.phone || '');
    if (!customerPhone.isValid) return res.status(409).json({ error: 'Lead phone number is invalid for calling' });

    const twilioConfig = await getOrganizationTwilioConfig(supabase, caller.organization_id);
    if (!twilioConfig) return res.status(503).json({ error: 'Your organization has not configured Twilio calling' });

    let callUrl: string;
    let statusUrl: string;
    try {
      callUrl = telephonyWebhookUrl('voice', { bridge_id: 'pending', leg: 'caller' });
      statusUrl = telephonyWebhookUrl('webhook', { bridge_id: 'pending', leg: 'caller' });
    } catch {
      return res.status(503).json({ error: 'Secure calling callback URL is not configured' });
    }

    const { data: prepared, error: prepareError } = await supabase.rpc('prepare_twilio_outbound_call', {
      p_organization_id: caller.organization_id,
      p_telecaller_id: caller.id,
      p_lead_id: lead.id,
      p_idempotency_key: idempotencyKey,
      p_twilio_config_updated_at: twilioConfig.record.updated_at,
    });
    if (prepareError) {
      if (prepareError.code === '42501') return res.status(403).json({ error: 'This lead is not currently assigned to you' });
      if (prepareError.code === '23505') return res.status(409).json({ error: 'Call request id was already used for another lead' });
      if (prepareError.code === '40001') return res.status(409).json({ error: 'Twilio configuration changed. Refresh and try again.' });
      return res.status(503).json({ error: 'Call request could not be prepared' });
    }
    const preparedCall = Array.isArray(prepared) ? prepared[0] : prepared;
    if (!preparedCall?.call_id) return res.status(503).json({ error: 'Call request could not be prepared' });
    if (preparedCall.reused) {
      return res.status(202).json({ callId: preparedCall.call_id, status: preparedCall.call_status, accepted: false });
    }

    const callUrlWithId = new URL(callUrl);
    callUrlWithId.searchParams.set('bridge_id', preparedCall.call_id);
    const statusUrlWithId = new URL(statusUrl);
    statusUrlWithId.searchParams.set('bridge_id', preparedCall.call_id);

    const providerCall = await createOrganizationTwilioCall(twilioConfig.credentials, {
      to: callerPhone.normalized,
      from: twilioConfig.credentials.phoneNumber,
      url: callUrlWithId.toString(),
      statusCallback: statusUrlWithId.toString(),
    });
    if (!providerCall.ok || !providerCall.callSid) {
      await supabase.from('call_bridges').update({
        status: providerCall.retryable ? 'RECOVERY_REQUIRED' : 'FAILED',
        recovery_required: providerCall.retryable === true,
        failure_code: 'CALLER_LEG_CREATE_FAILED',
      }).eq('call_id', preparedCall.call_id);
      if (!providerCall.retryable) {
        await supabase.from('calls').update({ status: 'FAILED', ended_at: new Date().toISOString() }).eq('id', preparedCall.call_id);
      }
      return res.status(providerCall.retryable ? 503 : 502).json({
        error: providerCall.retryable
          ? 'Twilio call result is uncertain. Do not retry; support must reconcile this call.'
          : 'Twilio could not start the caller leg. Check your organization account configuration.',
      });
    }

    const { data: attached, error: attachError } = await supabase.rpc('attach_twilio_leg_sid', {
      p_call_id: preparedCall.call_id,
      p_leg: 'caller',
      p_call_sid: providerCall.callSid,
    });
    if (attachError || attached !== true) {
      await supabase.from('call_bridges').update({
        status: 'RECOVERY_REQUIRED', recovery_required: true, failure_code: 'CALL_STATE_PERSISTENCE_FAILED',
      }).eq('call_id', preparedCall.call_id);
      return res.status(503).json({ error: 'Twilio accepted the call but its state requires operator reconciliation' });
    }

    return res.status(202).json({ callId: preparedCall.call_id, status: 'INITIATED', accepted: true });
  } catch {
    console.error('Telephony call operation failed');
    return res.status(502).json({ error: 'Call operation failed. Please try again or contact support.' });
  }
}
