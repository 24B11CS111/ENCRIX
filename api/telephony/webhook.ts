import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer';
import { getTwilioServerConfig, verifyTwilioSignature } from '../_lib/twilioServer';
import { downloadAndStoreRecording, validateTwilioRecordingUrl } from '../_lib/recordingPipeline';
import { db } from '../../src/services/supabase/db';
import { Profile } from '../../src/types';

// In-memory idempotency tracking for sandbox / offline execution
const processedWebhookEvents = new Set<string>();

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
  let isDuplicate = false;
  if (isRealSupabaseServerConfigured()) {
    const { data: existingEvent } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('provider_event_id', providerEventId)
      .single();

    if (existingEvent) {
      isDuplicate = true;
    }
  } else {
    if (processedWebhookEvents.has(providerEventId)) {
      isDuplicate = true;
    } else {
      processedWebhookEvents.add(providerEventId);
    }
  }

  if (isDuplicate) {
    // Duplicate event already processed
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // Record webhook event for audit and idempotency
  if (isRealSupabaseServerConfigured()) {
    await supabase.from('webhook_events').insert({
      provider: 'TWILIO',
      provider_event_id: providerEventId,
      call_sid: callSid,
      event_type: rawStatus,
      payload: bodyParams,
      processed_at: new Date().toISOString(),
    });
  }

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
  if (mappedStatus === 'COMPLETED') {
    updatePayload.ended_at = new Date().toISOString();
  }

  // Handle Recording URL securely (Server-Side Storage Pipeline)
  let canonicalRecordingPath: string | null = null;
  if (recordingUrl) {
    // 4a. Validate URL against SSRF and trusted Twilio host
    const urlValidation = validateTwilioRecordingUrl(recordingUrl);
    if (!urlValidation.valid) {
      await supabase.from('security_events').insert({
        organization_id: 'SYSTEM',
        event_type: 'UNTRUSTED_RECORDING_URL_REJECTED',
        severity: 'HIGH',
        description: `Rejected untrusted recording URL for CallSid: ${callSid}. ${urlValidation.error}`,
        metadata: {
          callSid,
          error: urlValidation.error,
        },
      });
    } else {
      // 4b. Fetch call to obtain call.id and call.organization_id
      let targetCall: any = null;
      if (isRealSupabaseServerConfigured()) {
        const { data } = await supabase
          .from('calls')
          .select('id, organization_id, recording_url')
          .eq('provider_call_id', callSid)
          .single();
        targetCall = data;
      } else {
        const allCalls = db.getCalls({ role: 'ADMIN', organization_id: '' } as Profile);
        targetCall = allCalls.find((c) => c.provider_call_id === callSid || c.id === callSid);
      }

      if (targetCall) {
        // Execute server-side download and upload to private call-recordings bucket
        const pipelineResult = await downloadAndStoreRecording({
          callId: targetCall.id,
          organizationId: targetCall.organization_id,
          recordingUrl,
        });

        if (pipelineResult.success && pipelineResult.storagePath) {
          canonicalRecordingPath = pipelineResult.storagePath;
          updatePayload.recording_url = canonicalRecordingPath;
        } else {
          if (isRealSupabaseServerConfigured()) {
            await supabase.from('security_events').insert({
              organization_id: targetCall.organization_id,
              event_type: 'RECORDING_PIPELINE_ERROR',
              severity: 'MEDIUM',
              description: `Recording pipeline could not process audio for call ${targetCall.id}: ${pipelineResult.error || 'Unknown error'}`,
              metadata: {
                callId: targetCall.id,
                callSid,
              },
            });
          }
        }
      }
    }
  }

  let updatedCall: any = null;
  if (isRealSupabaseServerConfigured()) {
    const { data } = await supabase
      .from('calls')
      .update(updatePayload)
      .eq('provider_call_id', callSid)
      .select('id, organization_id, lead_id, telecaller_id, recording_url')
      .single();
    updatedCall = data;
  } else {
    const allCalls = db.getCalls({ role: 'ADMIN', organization_id: '' } as Profile);
    const existingCall = allCalls.find((c) => c.provider_call_id === callSid || c.id === callSid);
    if (existingCall) {
      db.updateCall(
        existingCall.id,
        updatePayload,
        { role: 'ADMIN', organization_id: existingCall.organization_id, status: 'ACTIVE' } as Profile
      );
      updatedCall = { ...existingCall, ...updatePayload };
    }
  }

  // 5. Broadcast real-time update to tenant (ZERO provider URL exposure)
  if (updatedCall && isRealSupabaseServerConfigured()) {
    const channel = supabase.channel(`org:${updatedCall.organization_id}:calls`);
    await channel.send({
      type: 'broadcast',
      event: 'CALL_STATUS_UPDATED',
      payload: {
        callId: updatedCall.id,
        callSid,
        status: mappedStatus,
        durationSeconds: duration,
        hasRecording: Boolean(canonicalRecordingPath || updatedCall.recording_url),
        recordingStatus: (canonicalRecordingPath || updatedCall.recording_url) ? 'AVAILABLE' : undefined,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    callSid,
    status: mappedStatus,
  });
}
