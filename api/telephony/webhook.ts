import { getSupabaseServerClient, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import {
  getTwilioServerConfig,
  getTwilioWebhookSignatureUrl,
  verifyTwilioSignature,
} from '../_lib/twilioServer.js';
import { downloadAndStoreRecording, validateTwilioRecordingUrl } from '../_lib/recordingPipeline.js';
import { db } from '../../src/services/supabase/db.js';
import type { Profile } from '../../src/types/index.js';

// In-memory idempotency tracking for sandbox / offline execution
const processedWebhookEvents = new Set<string>();
const terminalStatuses = new Set(['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED']);
const transitionRank: Record<string, number> = {
  INITIATED: 0,
  RINGING: 1,
  CONNECTED: 2,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  MISSED: 3,
  NO_ANSWER: 3,
  BUSY: 3,
  CANCELED: 3,
  FAILED: 3,
};

function mapTwilioStatus(rawStatus: string): string | null {
  switch (rawStatus) {
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

function shouldApplyStatus(currentStatus: string, incomingStatus: string): boolean {
  if (terminalStatuses.has(currentStatus)) return currentStatus === incomingStatus;
  if (terminalStatuses.has(incomingStatus)) return true;
  return (transitionRank[incomingStatus] ?? -1) >= (transitionRank[currentStatus] ?? -1);
}

function allowedPriorStatuses(incomingStatus: string): string[] {
  if (terminalStatuses.has(incomingStatus)) return [...NON_TERMINAL, incomingStatus];
  if (incomingStatus === 'IN_PROGRESS' || incomingStatus === 'CONNECTED') {
    return ['INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS'];
  }
  if (incomingStatus === 'RINGING') return ['INITIATED', 'RINGING'];
  return ['INITIATED'];
}

const NON_TERMINAL = ['INITIATED', 'RINGING', 'CONNECTED', 'IN_PROGRESS'];

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const twilioConfig = getTwilioServerConfig();
  const signature = (req.headers['x-twilio-signature'] || '') as string;
  const fullUrl = getTwilioWebhookSignatureUrl(twilioConfig.statusCallbackUrl, req.url || '/');
  if (!fullUrl) return res.status(400).json({ error: 'Invalid webhook URL' });

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
      description: 'Rejected forged Twilio webhook callback. Signature mismatch.',
      metadata: {},
    });

    return res.status(401).json({ error: 'Unauthorized: Invalid Twilio HMAC signature' });
  }

  const callSid = bodyParams.CallSid;
  const rawStatus = (bodyParams.CallStatus || '').toLowerCase().trim();
  const mappedStatus = mapTwilioStatus(rawStatus);
  const sequenceNumber = bodyParams.SequenceNumber || '';
  if (!/^CA[0-9a-f]{32}$/i.test(callSid || '') || !mappedStatus ||
      (sequenceNumber && !/^[1-9]\d{0,8}$/.test(sequenceNumber))) {
    return res.status(400).json({ error: 'Invalid webhook event' });
  }

  const durationText = bodyParams.CallDuration || '';
  if (durationText && !/^\d{1,7}$/.test(durationText)) {
    return res.status(400).json({ error: 'Invalid webhook event' });
  }
  const duration = durationText ? Number.parseInt(durationText, 10) : 0;
  const recordingUrl = bodyParams.RecordingUrl;
  const providerEventId = `${callSid}:${sequenceNumber || `${rawStatus}:${duration}`}`;

  // A valid signature is not enough: the provider SID must resolve to a
  // persisted ENCRIX call before the callback can alter tenant data.
  let targetCall: any = null;
  if (isRealSupabaseServerConfigured()) {
    const { data, error } = await supabase
      .from('calls')
      .select('id, organization_id, lead_id, telecaller_id, provider, provider_call_id, status, duration_seconds, recording_url')
      .eq('provider_call_id', callSid)
      .maybeSingle();
    if (error) return res.status(503).json({ error: 'Call state is temporarily unavailable' });
    targetCall = data;
  } else {
    const allCalls = db.getCalls({ role: 'ADMIN', organization_id: '' } as Profile);
    targetCall = allCalls.find((c) => c.provider_call_id === callSid || c.id === callSid);
  }
  if (!targetCall || targetCall.provider !== 'TWILIO') {
    return res.status(404).json({ error: 'Call not found' });
  }

  // 2. Webhook Idempotency Check (Duplicate / Replay prevention)
  let isDuplicate = false;
  if (isRealSupabaseServerConfigured()) {
    const { error } = await supabase.from('webhook_events').insert({
      provider: 'TWILIO',
      provider_event_id: providerEventId,
      call_sid: callSid,
      event_type: rawStatus,
      payload: {
        CallStatus: bodyParams.CallStatus,
        CallDuration: bodyParams.CallDuration,
        SequenceNumber: bodyParams.SequenceNumber,
        RecordingDuration: bodyParams.RecordingDuration,
      },
      processed_at: new Date().toISOString(),
    });
    if (error?.code === '23505') isDuplicate = true;
    else if (error) return res.status(503).json({ error: 'Webhook event could not be recorded' });
  } else {
    if (processedWebhookEvents.has(providerEventId)) {
      isDuplicate = true;
    } else {
      processedWebhookEvents.add(providerEventId);
    }
  }

  // 3. Prepare a monotonic status transition. Delayed callbacks cannot regress
  // an in-progress call or replace an already-terminal state.
  const applyStatus = shouldApplyStatus(targetCall.status, mappedStatus);
  const updatePayload: Record<string, any> = {};
  if (applyStatus) updatePayload.status = mappedStatus;
  if (applyStatus && duration > 0) {
    updatePayload.duration_seconds = duration;
  }
  if (applyStatus && terminalStatuses.has(mappedStatus)) {
    updatePayload.ended_at = new Date().toISOString();
  }

  // Handle Recording URL securely (Server-Side Storage Pipeline)
  let canonicalRecordingPath: string | null = null;
  if (recordingUrl && applyStatus && terminalStatuses.has(mappedStatus) &&
      targetCall.recording_url !== `${targetCall.organization_id}/${targetCall.id}.mp3`) {
    // 4a. Validate URL against SSRF and trusted Twilio host
    const urlValidation = validateTwilioRecordingUrl(recordingUrl);
    if (!urlValidation.valid) {
      await supabase.from('security_events').insert({
        organization_id: 'SYSTEM',
        event_type: 'UNTRUSTED_RECORDING_URL_REJECTED',
        severity: 'HIGH',
        description: 'Rejected untrusted Twilio recording URL.',
        metadata: {},
      });
    } else if (isRealSupabaseServerConfigured()) {
      // Recording URLs are accepted only on terminal callbacks and remain
      // server-side inputs to the private-storage pipeline.
      const pipelineResult = await downloadAndStoreRecording({
        callId: targetCall.id,
        organizationId: targetCall.organization_id,
        recordingUrl,
      });

      if (pipelineResult.success && pipelineResult.storagePath) {
        canonicalRecordingPath = pipelineResult.storagePath;
        updatePayload.recording_url = canonicalRecordingPath;
      } else {
        await supabase.from('security_events').insert({
          organization_id: targetCall.organization_id,
          event_type: 'RECORDING_PIPELINE_ERROR',
          severity: 'MEDIUM',
          description: 'Recording could not be processed into private storage.',
          metadata: { callId: targetCall.id },
        });
        // The idempotency receipt is already persisted. Return a retryable
        // response; repeated receipts still retry this idempotent pipeline.
        return res.status(503).json({ error: 'Recording processing is temporarily unavailable' });
      }
    }
  }

  let updatedCall: any = null;
  if (isRealSupabaseServerConfigured()) {
    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await supabase
        .from('calls')
        .update(updatePayload)
        .eq('id', targetCall.id)
        .eq('organization_id', targetCall.organization_id)
        .eq('provider_call_id', callSid)
        .in('status', allowedPriorStatuses(mappedStatus))
        .select('id, organization_id, status, duration_seconds, recording_url')
        .maybeSingle();
      if (error) return res.status(503).json({ error: 'Call state could not be updated' });
      updatedCall = data;
    }
    if (!updatedCall) {
      const { data, error } = await supabase
        .from('calls')
        .select('id, organization_id, status, duration_seconds, recording_url')
        .eq('id', targetCall.id)
        .eq('organization_id', targetCall.organization_id)
        .maybeSingle();
      if (error) return res.status(503).json({ error: 'Call state could not be read' });
      updatedCall = data;
    }
  } else {
    const existingCall = targetCall;
    if (Object.keys(updatePayload).length > 0 && applyStatus) {
      db.updateCall(
        existingCall.id,
        updatePayload,
        { role: 'ADMIN', organization_id: existingCall.organization_id, status: 'ACTIVE' } as Profile
      );
    } else if (updatePayload.recording_url) {
      db.updateCall(
        existingCall.id,
        { recording_url: updatePayload.recording_url },
        { role: 'ADMIN', organization_id: existingCall.organization_id, status: 'ACTIVE' } as Profile
      );
    }
    updatedCall = { ...existingCall, ...updatePayload };
  }

  // No Broadcast channel is used here: this repository has no verified
  // private-channel membership policy. Clients receive only RLS-filtered
  // postgres_changes events through the existing organization-scoped channel.

  return res.status(200).json({
    ok: true,
    duplicate: isDuplicate,
    status: updatedCall?.status || targetCall.status,
  });
}
