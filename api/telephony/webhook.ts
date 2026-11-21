import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import { getOrganizationTwilioConfig } from '../_lib/twilioOrganizationConfig.js';
import { getTwilioWebhookSignatureUrl, verifyTwilioSignature } from '../_lib/twilioServer.js';
import { createOrganizationTwilioCall, getPublicTelephonyWebhookBase, telephonyWebhookUrl } from '../_lib/twilioRest.js';
import { normalizePhoneNumber } from '../../src/lib/phoneNormalization.js';
import { downloadAndStoreRecording, validateTwilioRecordingUrl } from '../_lib/recordingPipeline.js';

const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const TERMINAL = new Set(['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED']);
const NON_TERMINAL = ['INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS'];
const LEG_TERMINAL = new Set(['COMPLETED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'FAILED']);

function mapTwilioStatus(raw: string): string | null {
  switch (raw.toLowerCase()) {
    case 'queued':
    case 'initiated': return 'INITIATED';
    case 'ringing': return 'RINGING';
    case 'in-progress':
    case 'answered': return 'IN_PROGRESS';
    case 'completed': return 'COMPLETED';
    case 'busy': return 'BUSY';
    case 'no-answer': return 'NO_ANSWER';
    case 'canceled': return 'CANCELED';
    case 'failed': return 'FAILED';
    default: return null;
  }
}

function statusCanAdvance(current: string, next: string): boolean {
  if (TERMINAL.has(current)) return false;
  if (TERMINAL.has(next)) return true;
  const rank: Record<string, number> = { INITIATED: 0, RINGING: 1, CONNECTED: 2, IN_PROGRESS: 2 };
  return (rank[next] ?? -1) >= (rank[current] ?? -1);
}

function allowedPriorLegStates(next: string): string[] {
  const states = ['PENDING', 'CREATING', 'QUEUED', 'RINGING', 'IN_PROGRESS', 'RECOVERY_REQUIRED'];
  if (LEG_TERMINAL.has(next)) return states;
  const rank: Record<string, number> = { PENDING: 0, CREATING: 0, QUEUED: 0, RINGING: 1, IN_PROGRESS: 2, RECOVERY_REQUIRED: 0 };
  const nextRank = rank[next];
  return states.filter((state) => rank[state] <= nextRank);
}

function stringParams(body: any): Record<string, string> {
  const params: Record<string, string> = {};
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) if (typeof value === 'string') params[key] = value;
  }
  return params;
}

function verifySignature(req: any, authToken: string): boolean {
  const callbackUrl = new URL('/api/telephony/webhook', getPublicTelephonyWebhookBase()).toString();
  const signedUrl = getTwilioWebhookSignatureUrl(callbackUrl, req.url || '/');
  const signature = req.headers?.['x-twilio-signature'];
  return Boolean(signedUrl && typeof signature === 'string'
    && verifyTwilioSignature(authToken, signature, signedUrl, stringParams(req.body)));
}

async function setLegStatus(supabase: any, bridge: any, leg: string, status: string, callSid: string): Promise<boolean> {
  const state = status === 'INITIATED' ? 'QUEUED' : status;
  const column = leg === 'caller' ? 'caller_leg_state' : 'customer_leg_state';
  const currentState = bridge[column] || 'PENDING';
  const currentRank: Record<string, number> = { PENDING: 0, CREATING: 0, QUEUED: 0, RINGING: 1, IN_PROGRESS: 2, RECOVERY_REQUIRED: 0 };
  const nextRank = currentRank[state];
  if (LEG_TERMINAL.has(currentState) || (!LEG_TERMINAL.has(state)
      && (nextRank === undefined || currentRank[currentState] > nextRank))) {
    return false;
  }
  const timestampColumn = leg === 'caller'
    ? (status === 'IN_PROGRESS' ? 'caller_leg_answered_at' : TERMINAL.has(status) ? 'caller_leg_ended_at' : null)
    : (status === 'IN_PROGRESS' ? 'customer_leg_answered_at' : TERMINAL.has(status) ? 'customer_leg_ended_at' : null);
  const patch: Record<string, any> = { [column]: state, updated_at: new Date().toISOString() };
  if (leg === 'inbound-telecaller') patch.customer_provider_call_id = callSid;
  if (timestampColumn) patch[timestampColumn] = new Date().toISOString();
  if (status === 'IN_PROGRESS' && leg === 'customer') patch.status = 'BRIDGED';
  else if (status === 'IN_PROGRESS' && leg === 'caller') patch.status = 'CALLER_CONNECTED';
  else if (TERMINAL.has(status)) patch.status = status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';

  const { data, error } = await supabase.from('call_bridges').update(patch)
    .eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id)
    .in(column, allowedPriorLegStates(state))
    .select('call_id').maybeSingle();
  if (error) throw new Error('call_bridge_update_failed');
  return Boolean(data?.call_id);
}

async function launchCustomerLeg(supabase: any, bridge: any, credentials: any) {
  const { data: call, error: callError } = await supabase.from('calls')
    .select('id, organization_id, lead_id, telecaller_id, status')
    .eq('id', bridge.call_id).eq('organization_id', bridge.organization_id).maybeSingle();
  if (callError || !call) throw new Error('call_record_unavailable');

  const [leadResult, profileResult] = await Promise.all([
    supabase.from('leads').select('id, organization_id, assigned_to, phone, status')
      .eq('id', call.lead_id).eq('organization_id', call.organization_id)
      .eq('assigned_to', call.telecaller_id).maybeSingle(),
    supabase.from('profiles').select('id, organization_id, role, status, phone, phone_verified')
      .eq('id', call.telecaller_id).eq('organization_id', call.organization_id).maybeSingle(),
  ]);
  if (leadResult.error || profileResult.error) throw new Error('call_authorization_recheck_failed');
  const lead = leadResult.data;
  const telecaller = profileResult.data;
  const customerPhone = normalizePhoneNumber(lead?.phone || '');
  if (!lead || lead.status === 'DO_NOT_CONTACT' || !customerPhone.isValid
      || !telecaller || telecaller.role !== 'TELECALLER' || telecaller.status !== 'ACTIVE'
      || telecaller.phone_verified !== true) {
    await supabase.from('call_bridges').update({
      status: 'FAILED', customer_leg_state: 'FAILED', failure_code: 'CUSTOMER_LEG_NOT_ANSWERED', updated_at: new Date().toISOString(),
    }).eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id);
    await supabase.from('calls').update({ status: 'FAILED', ended_at: new Date().toISOString() })
      .eq('id', bridge.call_id).eq('organization_id', bridge.organization_id).in('status', NON_TERMINAL);
    return;
  }

  const url = telephonyWebhookUrl('voice', { bridge_id: bridge.call_id, leg: 'customer' });
  const statusCallback = telephonyWebhookUrl('webhook', { bridge_id: bridge.call_id, leg: 'customer' });
  const providerCall = await createOrganizationTwilioCall(credentials, {
    to: customerPhone.normalized,
    from: credentials.phoneNumber,
    url,
    statusCallback,
  });
  if (!providerCall.ok || !providerCall.callSid) {
    if (providerCall.retryable) {
      await supabase.from('call_bridges').update({
        status: 'RECOVERY_REQUIRED', recovery_required: true,
        failure_code: 'CUSTOMER_LEG_CREATE_FAILED', updated_at: new Date().toISOString(),
      }).eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id);
    } else {
      await supabase.from('call_bridges').update({
        status: 'FAILED', customer_leg_state: 'FAILED', failure_code: 'CUSTOMER_LEG_CREATE_FAILED', updated_at: new Date().toISOString(),
      }).eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id);
      await supabase.from('calls').update({ status: 'FAILED', ended_at: new Date().toISOString() })
        .eq('id', bridge.call_id).eq('organization_id', bridge.organization_id).in('status', NON_TERMINAL);
    }
    return;
  }

  const { error: attachError } = await supabase.rpc('attach_twilio_leg_sid', {
    p_call_id: bridge.call_id, p_leg: 'customer', p_call_sid: providerCall.callSid,
  });
  if (attachError) {
    await supabase.from('call_bridges').update({
      status: 'RECOVERY_REQUIRED', recovery_required: true,
      failure_code: 'CALL_STATE_PERSISTENCE_FAILED', updated_at: new Date().toISOString(),
    }).eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isRealSupabaseServerConfigured()) return res.status(503).json({ error: 'Webhook processing unavailable' });

  try {
    const supabase = getSupabaseServerClient();
    const bridgeId = typeof req.query?.bridge_id === 'string' ? req.query.bridge_id : '';
    const leg = typeof req.query?.leg === 'string' ? req.query.leg : '';
    if (!/^[0-9a-f-]{36}$/i.test(bridgeId)
        || !['caller', 'customer', 'inbound-telecaller'].includes(leg)) {
      return res.status(400).json({ error: 'Invalid webhook route' });
    }
    const { data: bridge, error: bridgeError } = await supabase.from('call_bridges')
      .select('call_id, organization_id, flow, caller_provider_call_id, customer_provider_call_id, customer_leg_state, caller_leg_state, status')
      .eq('call_id', bridgeId).maybeSingle();
    if (bridgeError) return res.status(503).json({ error: 'Call routing is temporarily unavailable' });
    if (!bridge || (leg === 'inbound-telecaller' ? bridge.flow !== 'INBOUND' : bridge.flow !== 'OUTBOUND')) {
      return res.status(404).json({ error: 'Call not found' });
    }
    const config = await getOrganizationTwilioConfig(supabase, bridge.organization_id);
    if (!config || !verifySignature(req, config.credentials.authToken)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const params = stringParams(req.body);
    const callSid = params.CallSid || '';
    const status = mapTwilioStatus(params.CallStatus || '');
    const sequence = params.SequenceNumber || '';
    const durationText = params.CallDuration || '';
    if (!CALL_SID_PATTERN.test(callSid) || !status
        || (sequence && !/^[1-9]\d{0,8}$/.test(sequence))
        || (durationText && !/^\d{1,7}$/.test(durationText))) {
      return res.status(400).json({ error: 'Invalid webhook event' });
    }

    const expectedSid = leg === 'caller'
      ? bridge.caller_provider_call_id
      : bridge.customer_provider_call_id;
    if (expectedSid && expectedSid !== callSid) return res.status(403).json({ error: 'Call reference mismatch' });
    if (!expectedSid) {
      const { data: attached, error: attachError } = await supabase.rpc('attach_twilio_leg_sid', {
        p_call_id: bridge.call_id,
        p_leg: leg === 'caller' ? 'caller' : 'customer',
        p_call_sid: callSid,
      });
      if (attachError || attached !== true) return res.status(409).json({ error: 'Call reference unavailable' });
    }

    const { data: call, error: callError } = await supabase.from('calls')
      .select('id, organization_id, lead_id, telecaller_id, provider, provider_call_id, status, duration_seconds, recording_url')
      .eq('id', bridge.call_id).eq('organization_id', bridge.organization_id).maybeSingle();
    if (callError) return res.status(503).json({ error: 'Call state is temporarily unavailable' });
    if (!call || call.provider !== 'TWILIO') return res.status(404).json({ error: 'Call not found' });

    const effectiveLeg = leg === 'inbound-telecaller' ? 'inbound-telecaller' : leg;
    const legUpdated = await setLegStatus(supabase, bridge, effectiveLeg, status, callSid);

    // The telecaller leg answers before Twilio starts dialing the customer.
    // Keep the application call in RINGING until the customer leg answers.
    const nextStatus = status === 'IN_PROGRESS' && leg === 'caller' ? 'RINGING' : status;
    const updatePayload: Record<string, any> = {};
    if (statusCanAdvance(call.status, nextStatus)) updatePayload.status = nextStatus;
    const duration = Number.parseInt(durationText || '0', 10);
    if (duration > 0) updatePayload.duration_seconds = duration;
    if (TERMINAL.has(status)) updatePayload.ended_at = new Date().toISOString();

    const recordingUrl = params.RecordingUrl;
    if (recordingUrl && TERMINAL.has(status) && call.recording_url !== `${call.organization_id}/${call.id}.mp3`) {
      const validation = validateTwilioRecordingUrl(recordingUrl);
      if (!validation.valid) {
        await supabase.from('security_events').insert({
          organization_id: call.organization_id,
          event_type: 'UNTRUSTED_RECORDING_URL_REJECTED',
          severity: 'HIGH',
          description: 'Rejected untrusted Twilio recording URL.',
          metadata: { callId: call.id },
        });
      } else {
        const stored = await downloadAndStoreRecording({
          callId: call.id,
          organizationId: call.organization_id,
          recordingUrl,
          twilioCredentials: config.credentials,
        });
        if (!stored.success || !stored.storagePath) return res.status(503).json({ error: 'Recording processing is temporarily unavailable' });
        updatePayload.recording_url = stored.storagePath;
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase.from('calls').update(updatePayload)
        .eq('id', call.id).eq('organization_id', call.organization_id).in('status', NON_TERMINAL);
      if (updateError) return res.status(503).json({ error: 'Call state could not be updated' });
    }

    if (leg === 'caller' && status === 'IN_PROGRESS' && legUpdated) {
      const { data: claimed, error: claimError } = await supabase.rpc('claim_twilio_customer_leg', { p_call_id: bridge.call_id });
      if (claimError) return res.status(503).json({ error: 'Customer call could not be safely started' });
      if (claimed === true) await launchCustomerLeg(supabase, bridge, config.credentials);
    }

    const providerEventId = `${callSid}:${sequence || `${String(params.CallStatus).toLowerCase()}:${duration}`}`;
    const safePayload = {
      CallStatus: params.CallStatus,
      CallDuration: params.CallDuration,
      SequenceNumber: params.SequenceNumber,
      RecordingDuration: params.RecordingDuration,
    };
    const { error: receiptError } = await supabase.from('webhook_events').insert({
      provider: 'TWILIO',
      provider_event_id: providerEventId,
      call_sid: callSid,
      event_type: String(params.CallStatus).toLowerCase(),
      payload: safePayload,
      processed_at: new Date().toISOString(),
    });
    if (receiptError && receiptError.code !== '23505') {
      return res.status(503).json({ error: 'Webhook event receipt could not be stored' });
    }

    // No Broadcast channel is used here. The browser refreshes through its authorized API path.
    return res.status(200).json({ ok: true, duplicate: receiptError?.code === '23505', status: nextStatus });
  } catch {
    console.error('Twilio status callback processing failed');
    return res.status(503).json({ error: 'Webhook processing is temporarily unavailable' });
  }
}
