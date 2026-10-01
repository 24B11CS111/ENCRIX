import { CallStatus, TelephonyProvider, TelephonySession } from '@/types';
import { maskPhoneNumber } from '@/lib/dataMasking';

export class MockTelephonyProvider implements TelephonyProvider {
  public name = 'Mock Telephony Gateway (Development & QA)';
  // Provider internal state - stores real phone numbers server-side
  private activeCalls: Map<string, TelephonySession & { internalResolvedPhone?: string }> = new Map();
  private timers: Map<string, number> = new Map();

  public async initiateCall(params: {
    leadId: string;
    telecallerId: string;
    phoneNumber?: string;
  }): Promise<TelephonySession> {
    const callId = `mock-call-${Date.now().toString(36)}`;

    // Store secure session: telecaller client NEVER receives the raw internal phone
    const session: TelephonySession = {
      callId,
      leadId: params.leadId,
      telecallerId: params.telecallerId,
      maskedPhoneNumber: params.phoneNumber ? maskPhoneNumber(params.phoneNumber) : 'Masked (Carrier Direct)',
      status: 'INITIATED',
      startedAt: new Date(),
      durationSeconds: 0,
      isMuted: false,
    };

    // Keep internal resolved phone strictly in provider-side memory
    this.activeCalls.set(callId, {
      ...session,
      internalResolvedPhone: params.phoneNumber,
    });

    // Simulate network progression: INITIATED -> RINGING
    setTimeout(() => {
      const current = this.activeCalls.get(callId);
      if (current && current.status === 'INITIATED') {
        current.status = 'RINGING';
      }
    }, 1200);

    // Simulate customer pick up: RINGING -> CONNECTED
    setTimeout(() => {
      const current = this.activeCalls.get(callId);
      if (current && (current.status === 'RINGING' || current.status === 'INITIATED')) {
        current.status = 'CONNECTED';
      }
    }, 2800);

    return session;
  }

  public async toggleMute(callId: string, isMuted: boolean): Promise<boolean> {
    const session = this.activeCalls.get(callId);
    if (!session) return false;
    session.isMuted = isMuted;
    return true;
  }

  public async endCall(callId: string): Promise<{ durationSeconds: number; recordingUrl: string }> {
    const session = this.activeCalls.get(callId);
    const now = new Date();
    let duration = 12; // fallback minimum

    if (session) {
      session.status = 'COMPLETED';
      duration = Math.max(1, Math.floor((now.getTime() - session.startedAt.getTime()) / 1000));
      this.activeCalls.delete(callId);
    }

    if (this.timers.has(callId)) {
      clearInterval(this.timers.get(callId));
      this.timers.delete(callId);
    }

    const recordingUrl = `https://recordings.leadvault.internal/calls/rec_${callId}.mp3`;
    return {
      durationSeconds: duration,
      recordingUrl,
    };
  }

  public async getCallStatus(callId: string): Promise<CallStatus> {
    const session = this.activeCalls.get(callId);
    return session ? session.status : 'COMPLETED';
  }

  public getConsentNotice(): string {
    return 'Authorized call placed via LeadVault Telephony Gateway. Interaction is logged & recorded for compliance and customer satisfaction.';
  }
}

export const telephonyService: TelephonyProvider = new MockTelephonyProvider();
