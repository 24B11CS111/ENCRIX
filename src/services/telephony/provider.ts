import { CallStatus, TelephonySession } from '@/types';

export interface TelephonyCallParams {
  leadId: string;
  telecallerId: string;
  customerPhone?: string; // Resolved internally by gateway, NEVER from telecaller client!
  phoneNumber?: string; // Backward compatibility alias
  telecallerPhone?: string;
  organizationId: string;
  callerId?: string;
  statusCallbackUrl?: string;
}

export interface TwilioWebhookParams {
  CallSid: string;
  AccountSid?: string;
  From?: string;
  To?: string;
  CallStatus: string;
  CallDuration?: string;
  RecordingUrl?: string;
  RecordingDuration?: string;
  Timestamp?: string;
  SequenceNumber?: string;
  [key: string]: string | undefined;
}

export interface ITelephonyProvider {
  name: string;
  initiateCall(params: TelephonyCallParams): Promise<TelephonySession>;
  getCallStatus(callId: string): Promise<CallStatus>;
  endCall(callId: string): Promise<{ durationSeconds: number; recordingUrl: string }>;
  toggleMute(callId: string, isMuted: boolean): Promise<boolean>;
  verifyWebhookSignature(signature: string, url: string, params: Record<string, string>): boolean;
  getConsentNotice(): string;
}
