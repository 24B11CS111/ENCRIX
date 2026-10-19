import { Profile, Call } from '@/types';
import { db } from '@/services/supabase/db';

export class RecordingService {
  /**
   * Evaluates whether a user profile is authorized to access a call's audio recording.
   * Enforces:
   * 1. Active account status
   * 2. Tenant isolation (Org ID match or ADMIN)
   * 3. Role authorization:
   *    - ADMIN: Global access
   *    - OWNER: Full access within own organization
   *    - TELECALLER: Restricted strictly to calls initiated by them or assigned to them
   */
  public canAccessRecording(call: Call, profile: Profile): boolean {
    if (profile.status !== 'ACTIVE') return false;
    if (profile.role === 'ADMIN') return true;
    if (call.organization_id !== profile.organization_id) return false;
    if (profile.role === 'OWNER') return true;

    if (profile.role === 'TELECALLER') {
      return call.telecaller_id === profile.id;
    }

    return false;
  }

  /**
   * Generates a protected access descriptor for an authorized recording.
   * Throws forbidden error and records a security audit event if unauthorized.
   */
  public getRecordingAccess(
    callId: string,
    profile: Profile
  ): { recordingUrl: string; expiresInSeconds: number } {
    const calls = db.getCalls(profile);
    const call = calls.find((c) => c.id === callId);

    if (!call) {
      throw new Error('Call recording not found or unauthorized');
    }

    if (!this.canAccessRecording(call, profile)) {
      db.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_RECORDING_ACCESS_ATTEMPT',
          severity: 'HIGH',
          description: `User ${profile.full_name} (${profile.id}) attempted to access recording for call ${call.id} without authorization`,
          metadata: { callId: call.id, userRole: profile.role, userOrg: profile.organization_id },
        },
        profile
      );
      throw new Error('Forbidden: You do not have permission to access this call recording');
    }

    if (!call.recording_url) {
      throw new Error('Call recording not found or unavailable');
    }

    // Fail closed: Never expose raw Twilio provider recording URLs
    if (call.recording_url.includes('api.twilio.com') || call.recording_url.includes('twilio.com')) {
      throw new Error('Provider recording URL must not be accessed directly; storage sync required');
    }

    const signedUrl = call.recording_url.startsWith('http')
      ? call.recording_url
      : `https://storage.encrix.internal/recordings/${call.recording_url}?token=signed_${Date.now()}`;

    return {
      recordingUrl: signedUrl,
      expiresInSeconds: 60,
    };
  }

  /**
   * Fetches a short-lived (60s) pre-signed recording URL from the server API gateway.
   */
  public async fetchRecordingSignedUrl(
    callId: string
  ): Promise<{ recordingUrl: string; expiresInSeconds: number }> {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('leadvault_session_token') ||
          (() => {
            try {
              return JSON.parse(localStorage.getItem('leadvault_session') || '{}').sessionToken || '';
            } catch {
              return '';
            }
          })()
        : '';

    const res = await fetch(`/api/telephony/recording?callId=${encodeURIComponent(callId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to access call recording');
    }

    return {
      recordingUrl: data.recordingUrl,
      expiresInSeconds: data.expiresIn || 60,
    };
  }
}

export const recordingService = new RecordingService();

