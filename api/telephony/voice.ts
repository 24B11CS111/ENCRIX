import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import { getOrganizationForTwilioNumber, getOrganizationTwilioConfig } from '../_lib/twilioOrganizationConfig.js';
import { getTwilioWebhookSignatureUrl, verifyTwilioSignature } from '../_lib/twilioServer.js';
import { getPublicTelephonyWebhookBase, isTwilioCallingEnabled, telephonyWebhookUrl } from '../_lib/twilioRest.js';
import { checkPaidEntitlement } from '../_lib/paidEntitlement.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function requestParams(body: any): Record<string, string> {
  const params: Record<string, string> = {};
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string') params[key] = value;
    }
  }
  return params;
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&apos;');
}

function sendTwiml(res: any, body: string) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
}

function unavailableTwiml(res: any) {
  return sendTwiml(res, '<Say>The call could not be connected. Please try again later.</Say><Hangup/>');
}

function verifyRequestSignature(req: any, authToken: string): boolean {
  const configuredUrl = new URL('/api/telephony/voice', getPublicTelephonyWebhookBase()).toString();
  const signedUrl = getTwilioWebhookSignatureUrl(configuredUrl, req.url || '/');
  const signature = req.headers?.['x-twilio-signature'] || '';
  return Boolean(signedUrl && typeof signature === 'string'
    && verifyTwilioSignature(authToken, signature, signedUrl, requestParams(req.body)));
}

async function handleDialResult(req: any, res: any, supabase: any, bridgeId: string) {
  const { data: bridge, error: bridgeError } = await supabase
    .from('call_bridges')
    .select('call_id, organization_id, caller_provider_call_id, flow')
    .eq('call_id', bridgeId)
    .eq('flow', 'INBOUND')
    .maybeSingle();
  if (bridgeError || !bridge) return res.status(404).send('Not found');
  const config = await getOrganizationTwilioConfig(supabase, bridge.organization_id);
  if (!config || !verifyRequestSignature(req, config.credentials.authToken)) {
    return res.status(401).send('Unauthorized');
  }
  const params = requestParams(req.body);
  if (!CALL_SID_PATTERN.test(params.CallSid || '')
      || params.CallSid !== bridge.caller_provider_call_id
      || !CALL_SID_PATTERN.test(params.DialCallSid || '')) {
    return res.status(400).send('Invalid call event');
  }
  const statusMap: Record<string, string> = {
    completed: 'COMPLETED', busy: 'BUSY', 'no-answer': 'NO_ANSWER',
    failed: 'FAILED', canceled: 'CANCELED',
  };
  const callStatus = statusMap[String(params.DialCallStatus || '').toLowerCase()];
  if (!callStatus || (params.DialCallDuration && !/^\d{1,7}$/.test(params.DialCallDuration))) {
    return res.status(400).send('Invalid call event');
  }
  const { error: updateError } = await supabase.from('calls')
    .update({
      status: callStatus,
      duration_seconds: Number(params.DialCallDuration || 0),
      ended_at: new Date().toISOString(),
    })
    .eq('id', bridge.call_id)
    .eq('organization_id', bridge.organization_id)
    .in('status', ['INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS']);
  if (updateError) return res.status(503).send('Call state unavailable');
  await supabase.from('call_bridges').update({
    customer_provider_call_id: params.DialCallSid,
    customer_leg_state: callStatus,
    status: callStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
    updated_at: new Date().toISOString(),
  }).eq('call_id', bridge.call_id).eq('organization_id', bridge.organization_id);
  return sendTwiml(res, '<Say>Thank you. Goodbye.</Say><Hangup/>');
}

async function handleBridgeVoice(req: any, res: any, supabase: any, bridgeId: string, leg: string) {
  if (!UUID_PATTERN.test(bridgeId) || !['caller', 'customer'].includes(leg)) return res.status(400).send('Invalid call reference');
  const { data: bridge, error: bridgeError } = await supabase
    .from('call_bridges')
    .select('call_id, organization_id, conference_id, caller_provider_call_id, customer_provider_call_id, flow, status')
    .eq('call_id', bridgeId)
    .eq('flow', 'OUTBOUND')
    .maybeSingle();
  if (bridgeError || !bridge) return res.status(404).send('Not found');
  const config = await getOrganizationTwilioConfig(supabase, bridge.organization_id);
  if (!config || !verifyRequestSignature(req, config.credentials.authToken)) {
    return res.status(401).send('Unauthorized');
  }
  const params = requestParams(req.body);
  if (!CALL_SID_PATTERN.test(params.CallSid || '')) return res.status(400).send('Invalid call event');
  const expectedSid = leg === 'caller' ? bridge.caller_provider_call_id : bridge.customer_provider_call_id;
  if (expectedSid && expectedSid !== params.CallSid) return res.status(403).send('Call reference mismatch');
  if (!expectedSid) {
    const { data: attached, error: attachError } = await supabase.rpc('attach_twilio_leg_sid', {
      p_call_id: bridge.call_id,
      p_leg: leg,
      p_call_sid: params.CallSid,
    });
    if (attachError || attached !== true) return res.status(409).send('Call reference unavailable');
  }

  const conferenceName = `encrix-${bridge.conference_id}`;
  const xml = `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true">${conferenceName}</Conference></Dial>`;
  return sendTwiml(res, xml);
}

async function handleInbound(req: any, res: any, supabase: any) {
  const params = requestParams(req.body);
  if (!CALL_SID_PATTERN.test(params.CallSid || '') || !E164_PATTERN.test(params.From || '') || !E164_PATTERN.test(params.To || '')) {
    return res.status(400).send('Invalid incoming call');
  }

  const organizationConfig = await getOrganizationForTwilioNumber(supabase, params.To);
  // Without a matching account we have no tenant token with which to verify
  // Twilio's signature. Fail closed and never guess which organization owns it.
  if (!organizationConfig) return res.status(401).send('Unauthorized');
  if (!verifyRequestSignature(req, organizationConfig.credentials.authToken)) {
    return res.status(401).send('Unauthorized');
  }
  const entitlement = await checkPaidEntitlement({
    organization_id: organizationConfig.record.organization_id,
    status: 'ACTIVE',
  }, supabase);
  if (!entitlement.allowed) return unavailableTwiml(res);
  if (!isTwilioCallingEnabled()) {
    await supabase.rpc('record_twilio_inbound_attempt', {
      p_organization_id: organizationConfig.record.organization_id,
      p_call_sid: params.CallSid,
      p_outcome: 'PROVIDER_ERROR',
    });
    return unavailableTwiml(res);
  }

  const { data, error } = await supabase.rpc('prepare_twilio_inbound_call', {
    p_organization_id: organizationConfig.record.organization_id,
    p_call_sid: params.CallSid,
    p_from_phone: params.From,
    p_twilio_phone_number: organizationConfig.record.twilio_phone_number,
    p_twilio_config_updated_at: organizationConfig.record.updated_at,
  });
  if (error) return res.status(503).send('Call routing unavailable');
  const routed = Array.isArray(data) ? data[0] : data;
  if (!routed || !['ROUTED', 'REUSED'].includes(routed.outcome)
      || !routed.call_id || !E164_PATTERN.test(routed.telecaller_phone || '')) {
    return unavailableTwiml(res);
  }

  const actionUrl = telephonyWebhookUrl('voice', { bridge_id: routed.call_id, leg: 'inbound-result' });
  const childStatusUrl = telephonyWebhookUrl('webhook', { bridge_id: routed.call_id, leg: 'inbound-telecaller' });
  const twiml = `<Dial action="${xmlEscape(actionUrl)}" method="POST" timeout="20"><Number statusCallback="${xmlEscape(childStatusUrl)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${xmlEscape(routed.telecaller_phone)}</Number></Dial>`;
  return sendTwiml(res, twiml);
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }
  if (!isRealSupabaseServerConfigured()) return res.status(503).send('Call routing unavailable');

  try {
    const supabase = getSupabaseServerClient();
    const bridgeId = typeof req.query?.bridge_id === 'string' ? req.query.bridge_id : '';
    const leg = typeof req.query?.leg === 'string' ? req.query.leg : '';
    if (bridgeId && leg === 'inbound-result') return await handleDialResult(req, res, supabase, bridgeId);
    if (bridgeId && ['caller', 'customer'].includes(leg)) return await handleBridgeVoice(req, res, supabase, bridgeId, leg);
    if (!bridgeId && !leg) return await handleInbound(req, res, supabase);
    return res.status(400).send('Invalid call route');
  } catch {
    console.error('Twilio voice routing failed');
    return res.status(503).send('Call routing unavailable');
  }
}
