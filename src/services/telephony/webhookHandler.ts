import { CallStatus, Profile } from '@/types';
import { db } from '@/services/supabase/db';
import { ITelephonyProvider, TwilioWebhookParams } from './provider';
import { TwilioTelephonyProvider } from './twilioProvider';

export interface WebhookResult {
  success: boolean;
  statusCode: number;
  status?: CallStatus;
  callId?: string;
  error?: string;
}

export class TelephonyWebhookHandler {
  private provider: ITelephonyProvider;

  constructor(provider?: ITelephonyProvider) {
    this.provider = provider || new TwilioTelephonyProvider();
  }

  /**
   * Maps Twilio call status strings to LEADVAULT CallStatus
   */
  public mapTwilioStatus(twilioStatus: string): CallStatus {
    const s = twilioStatus.toLowerCase().trim();
    switch (s) {
      case 'queued':
      case 'initiated':
        return 'INITIATED';
      case 'ringing':
        return 'RINGING';
      case 'in-progress':
      case 'answered':
        return 'CONNECTED';
      case 'completed':
        return 'COMPLETED';
      case 'busy':
        return 'BUSY';
      case 'no-answer':
        return 'MISSED';
      case 'failed':
      case 'canceled':
        return 'FAILED';
      default:
        return 'COMPLETED';
    }
  }

  /**
   * Handles incoming Twilio StatusCallback webhooks with signature verification
   */
  public async handleStatusCallback(
    signature: string,
    webhookUrl: string,
    params: TwilioWebhookParams
  ): Promise<WebhookResult> {
    // 1. Convert params to Record<string, string> for signature verification
    const stringParams: Record<string, string> = {};
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) {
        stringParams[key] = val;
      }
    }

    // 2. Cryptographic signature check
    const isValid = this.provider.verifyWebhookSignature(signature, webhookUrl, stringParams);
    if (!isValid) {
      // Record security event for potential webhook spoofing / attack
      db.recordSecurityEvent(
        {
          event_type: 'TWILIO_WEBHOOK_FORGERY_ATTEMPT',
          severity: 'HIGH',
          description: `Rejecting forged Twilio status webhook for CallSid: ${params.CallSid || 'UNKNOWN'}. Signature mismatch.`,
          metadata: {
            signatureHeader: signature,
            webhookUrl,
            callSid: params.CallSid,
          },
        },
        { role: 'ADMIN', organization_id: 'SYSTEM' } as Profile
      );

      return {
        success: false,
        statusCode: 401,
        error: 'Unauthorized: Invalid Twilio HMAC signature',
      };
    }

    // 3. Extract and map status
    const callSid = params.CallSid;
    const mappedStatus = this.mapTwilioStatus(params.CallStatus || 'completed');
    const duration = params.CallDuration ? parseInt(params.CallDuration, 10) : undefined;
    const recordingUrl = params.RecordingUrl;

    // 4. Update status in provider if applicable
    if (this.provider instanceof TwilioTelephonyProvider) {
      this.provider.updateCallStatus(callSid, mappedStatus, duration);
    }

    // 5. Update call record in database if present
    const existingCalls = db.getCalls({ role: 'ADMIN', organization_id: '' } as Profile);
    const targetCall = existingCalls.find((c) => c.id === callSid || c.lead_id === params.leadId);

    if (targetCall) {
      db.updateCall(
        targetCall.id,
        {
          status: mappedStatus,
          duration_seconds: duration !== undefined ? duration : targetCall.duration_seconds,
          recording_url: recordingUrl || targetCall.recording_url,
          ended_at: mappedStatus === 'COMPLETED' ? new Date().toISOString() : undefined,
        },
        { role: 'ADMIN', organization_id: targetCall.organization_id } as Profile
      );
    }

    return {
      success: true,
      statusCode: 200,
      status: mappedStatus,
      callId: callSid,
    };
  }
}

export const webhookHandler = new TelephonyWebhookHandler();
