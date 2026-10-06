import { getSupabaseServerClient } from '../_lib/supabaseServer';
import { getTwilioServerConfig, verifyTwilioSignature } from '../_lib/twilioServer';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const twilioConfig = getTwilioServerConfig();
  const signature = (req.headers['x-twilio-signature'] || '') as string;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['host'] || req.headers['x-forwarded-host'] || 'app.leadvault.io';
  const fullUrl = `${protocol}://${host}${req.url}`;

  // Twilio sends body as application/x-www-form-urlencoded
  const bodyParams: Record<string, string> = {};
  if (req.body) {
    for (const [k, v] of Object.entries(req.body)) {
      if (typeof v === 'string') {
        bodyParams[k] = v;
      }
    }
  }

  const supabase = getSupabaseServerClient();

  // 1. Cryptographic HMAC-SHA1 signature verification
  const isValid = verifyTwilioSignature(
    twilioConfig.authToken,
    signature,
    fullUrl,
    bodyParams
  );

  if (!isValid) {
    // Log security event for forged webhook
    await supabase.from('security_events').insert({
      organization_id: 'SYSTEM',
      event_type: 'TWILIO_WEBHOOK_FORGERY_ATTEMPT',
      severity: 'HIGH',
      description: `Rejected forged Twilio webhook callback for CallSid: ${bodyParams.CallSid || 'UNKNOWN'}. Signature mismatch.`,
      metadata: {
        signature,
        fullUrl,
        callSid: bodyParams.CallSid,
      },
    });

    return res.status(401).json({ error: 'Unauthorized: Invalid Twilio HMAC signature' });
  }

  const callSid = bodyParams.CallSid;
  const rawStatus = (bodyParams.CallStatus || 'completed').toLowerCase().trim();
  const duration = bodyParams.CallDuration ? parseInt(bodyParams.CallDuration, 10) : 0;
  const recordingUrl = bodyParams.RecordingUrl;
  const sequenceNumber = bodyParams.SequenceNumber || '';
  const providerEventId = `${callSid}:${sequenceNumber || rawStatus}:${duration}`;

  // 2. Webhook Idempotency Check (Duplicate / Replay prevention)
  const { data: existingEvent } = await supabase
    .from('webhook_events')
    .select('id')
    .eq('provider_event_id', providerEventId)
    .single();

  if (existingEvent) {
    // Duplicate event already processed
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // Record webhook event for audit and idempotency
  await supabase.from('webhook_events').insert({
    provider: 'TWILIO',
    provider_event_id: providerEventId,
    call_sid: callSid,
    event_type: rawStatus,
    payload: bodyParams,
    processed_at: new Date().toISOString(),
  });

  // 3. Map status to ENCRIX CallStatus
  let mappedStatus = 'COMPLETED';
  switch (rawStatus) {
    case 'queued':
    case 'initiated':
      mappedStatus = 'INITIATED';
      break;
    case 'ringing':
      mappedStatus = 'RINGING';
      break;
    case 'in-progress':
    case 'answered':
      mappedStatus = 'IN_PROGRESS';
      break;
    case 'completed':
      mappedStatus = 'COMPLETED';
      break;
    case 'busy':
      mappedStatus = 'BUSY';
      break;
    case 'no-answer':
      mappedStatus = 'NO_ANSWER';
      break;
    case 'canceled':
      mappedStatus = 'CANCELED';
      break;
    case 'failed':
      mappedStatus = 'FAILED';
      break;
  }

  // 4. Update call record in database
  const updatePayload: Record<string, any> = {
    status: mappedStatus,
  };
  if (duration > 0) {
    updatePayload.duration_seconds = duration;
  }
  if (recordingUrl) {
    updatePayload.recording_url = recordingUrl;
  }
  if (mappedStatus === 'COMPLETED') {
    updatePayload.ended_at = new Date().toISOString();
  }

  const { data: updatedCall } = await supabase
    .from('calls')
    .update(updatePayload)
    .eq('provider_call_id', callSid)
    .select('id, organization_id, lead_id, telecaller_id')
    .single();

  // 5. Broadcast real-time update to tenant
  if (updatedCall) {
    const channel = supabase.channel(`org:${updatedCall.organization_id}:calls`);
    await channel.send({
      type: 'broadcast',
      event: 'CALL_STATUS_UPDATED',
      payload: {
        callId: updatedCall.id,
        callSid,
        status: mappedStatus,
        durationSeconds: duration,
        recordingUrl,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    callSid,
    status: mappedStatus,
  });
}
