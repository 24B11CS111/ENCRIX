import { Profile, Call } from '@/types';

export class RecordingService {
  /**
   * Evaluates whether a user profile is authorized to access a call's audio recording.
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
   * Fetches a short-lived signed URL from the server endpoint that enforces recording permissions.
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

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to access call recording');
    }

    if (typeof data?.recordingUrl !== 'string') {
      throw new Error('Authorized recording URL is unavailable');
    }

    let signedUrl: URL;
    try {
      signedUrl = new URL(data.recordingUrl);
    } catch {
      throw new Error('Authorized recording URL is invalid');
    }
    if (
      signedUrl.protocol !== 'https:' ||
      signedUrl.username !== '' ||
      signedUrl.password !== '' ||
      signedUrl.hostname === 'twilio.com' ||
      signedUrl.hostname.endsWith('.twilio.com') ||
      !(
        (signedUrl.pathname.startsWith('/storage/v1/object/sign/call-recordings/') &&
          Boolean(signedUrl.searchParams.get('token'))) ||
        (signedUrl.hostname === 'storage.encrix.internal' &&
          signedUrl.pathname.startsWith('/recordings/') &&
          signedUrl.searchParams.get('token')?.startsWith('signed_mock_'))
      )
    ) {
      throw new Error('Recording URL is not an authorized private-storage URL');
    }

    return {
      recordingUrl: signedUrl.href,
      expiresInSeconds: typeof data.expiresIn === 'number' ? data.expiresIn : 60,
    };
  }

  public async createAuthorizedAudio(
    callId: string,
    createAudio: (url: string) => HTMLAudioElement = (url) => new Audio(url)
  ): Promise<HTMLAudioElement> {
    const { recordingUrl } = await this.fetchRecordingSignedUrl(callId);
    return createAudio(recordingUrl);
  }
}

export const recordingService = new RecordingService();
