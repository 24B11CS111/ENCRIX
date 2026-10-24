import { Profile, Organization, UserRole, OtpPurpose, OrganizationInvitation } from '@/types';
import { db } from '@/services/supabase/db';
import { isRealSupabaseConfigured } from '@/services/supabase/client';
import { normalizePhoneNumber } from '@/lib/phoneNormalization';
import { normalizeEmailAddress } from '@/lib/emailNormalization';

export const isLiveApiMode = (): boolean => {
  if (typeof process !== 'undefined' && process.env.VITEST && process.env.TEST_LIVE_API !== 'true') {
    return false;
  }
  return (
    isRealSupabaseConfigured() ||
    import.meta.env.VITE_USE_LIVE_API === 'true' ||
    import.meta.env.VITE_APP_ENV === 'production'
  );
};

export interface SendOtpParams {
  phone?: string;
  email?: string;
  purpose: OtpPurpose;
  fullName?: string;
  companyName?: string;
  industry?: string;
  companySize?: string;
  inviteToken?: string;
}

export interface SendOtpResult {
  success: boolean;
  maskedPhone?: string;
  maskedEmail?: string;
  expiresAt?: string;
  resendAvailableAt?: string;
  cooldownSeconds?: number;
  expiresInSeconds?: number;
  verificationTicket?: string;
  registrationTicket?: string;
  error?: string;
}

export interface VerifyOtpParams {
  phone?: string;
  email?: string;
  otp: string;
  purpose: OtpPurpose;
  verificationTicket?: string;
  registrationTicket?: string;
  registrationData?: {
    companyName: string;
    ownerName: string;
    email?: string;
    industry?: string;
    companySize?: string;
  };
  inviteToken?: string;
}

export interface VerifyOtpResult {
  success: boolean;
  profile?: Profile;
  organization?: Organization;
  role?: UserRole;
  sessionToken?: string;
  error?: string;
}

export interface InviteTelecallerParams {
  fullName: string;
  email: string;
  phone?: string;
  currentProfile: Profile;
}

export class AuthService {
  private tickets: Map<string, string> = new Map();

  /**
   * Request OTP verification code for login, registration, or invitation.
   * OTP is delivered via SMS and NEVER returned to the client browser.
   */
  public async requestOtp(params: SendOtpParams): Promise<SendOtpResult> {
    const emailResult = params.email ? normalizeEmailAddress(params.email) : null;
    const phoneResult = params.phone ? normalizePhoneNumber(params.phone) : null;

    if (params.email && !emailResult?.isValid) {
      return { success: false, error: emailResult?.error || 'Invalid email address format.' };
    }

    if (!params.email && params.phone && !phoneResult?.isValid) {
      return { success: false, error: phoneResult?.error || 'Invalid phone number format.' };
    }

    if (!params.email && !params.phone) {
      return { success: false, error: 'Email or phone number is required.' };
    }

    if (isLiveApiMode()) {
      try {
        const response = await fetch('/api/auth/send-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phoneResult?.normalized,
            purpose: params.purpose,
            fullName: params.fullName,
            companyName: params.companyName,
            industry: params.industry,
            companySize: params.companySize,
            email: emailResult?.normalized,
            inviteToken: params.inviteToken,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to send verification code.' };
        }

        const effectiveTicket = data.verificationTicket || data.registrationTicket;
        if (effectiveTicket && (emailResult?.normalized || params.email)) {
          const key = `${emailResult?.normalized || params.email}:${params.purpose}`;
          this.tickets.set(key, effectiveTicket);
        }

        return {
          success: true,
          maskedPhone: data.maskedPhone,
          maskedEmail: data.maskedEmail,
          expiresAt: data.expiresAt,
          resendAvailableAt: data.resendAvailableAt,
          cooldownSeconds: data.cooldownSeconds,
          expiresInSeconds: data.expiresInSeconds,
          verificationTicket: effectiveTicket,
          registrationTicket: effectiveTicket,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error while requesting verification code.' };
      }
    }

    const res = db.requestOtp({
      phone: phoneResult?.normalized,
      email: emailResult?.normalized,
      purpose: params.purpose,
      registrationData: params.companyName && params.fullName
        ? {
            companyName: params.companyName,
            ownerName: params.fullName,
            email: emailResult?.normalized || params.email,
            industry: params.industry,
            companySize: params.companySize,
          }
        : undefined,
      inviteToken: params.inviteToken,
    });

    return {
      success: res.success,
      maskedPhone: res.maskedPhone,
      maskedEmail: res.maskedEmail,
      expiresAt: res.expiresAt,
      resendAvailableAt: res.resendAvailableAt,
      cooldownSeconds: res.cooldownSeconds,
      expiresInSeconds: res.expiresSeconds,
      error: res.error,
    };
  }

  /**
   * Verifies the 6-digit OTP code against server-side cryptographic hash.
   * On success, establishes authenticated account and workspace.
   */
  public async verifyOtp(params: VerifyOtpParams): Promise<VerifyOtpResult> {
    const emailResult = params.email ? normalizeEmailAddress(params.email) : null;
    const phoneResult = params.phone ? normalizePhoneNumber(params.phone) : null;

    if (params.email && !emailResult?.isValid) {
      return { success: false, error: emailResult?.error || 'Invalid email address format.' };
    }

    if (!params.email && params.phone && !phoneResult?.isValid) {
      return { success: false, error: phoneResult?.error || 'Invalid phone number format.' };
    }

    if (!params.email && !params.phone) {
      return { success: false, error: 'Email or phone number is required.' };
    }

    if (!params.otp || !/^\d{6}$/.test(params.otp.trim())) {
      return { success: false, error: 'Enter the 6-digit verification code.' };
    }

    if (isLiveApiMode()) {
      try {
        const ticketKey = `${emailResult?.normalized || params.email}:${params.purpose}`;
        const effectiveTicket = params.verificationTicket || params.registrationTicket || this.tickets.get(ticketKey);

        const response = await fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phoneResult?.normalized,
            email: emailResult?.normalized,
            otp: params.otp.trim(),
            purpose: params.purpose,
            inviteToken: params.inviteToken,
            registrationData: params.registrationData,
            verificationTicket: effectiveTicket,
            registrationTicket: effectiveTicket,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || 'Verification failed.' };
        }

        if (data.success && data.profile) {
          if (typeof window !== 'undefined' && 'localStorage' in window) {
            try {
              if (data.sessionToken) {
                localStorage.setItem('leadvault_session_token', data.sessionToken);
              }
              localStorage.setItem(
                'leadvault_session',
                JSON.stringify({
                  sessionToken: data.sessionToken,
                  profileId: data.profile.id,
                  profile: data.profile,
                  organization: data.organization,
                })
              );
            } catch {
              // Fallback
            }
          }
        }

        return {
          success: true,
          profile: data.profile,
          organization: data.organization,
          role: data.role,
          sessionToken: data.sessionToken,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error during verification.' };
      }
    }

    const res = db.verifyOtp({
      phone: phoneResult?.normalized,
      email: emailResult?.normalized,
      otp: params.otp.trim(),
      purpose: params.purpose,
      registrationData: params.registrationData,
      inviteToken: params.inviteToken,
    });

    if (res.success && res.profile) {
      if (typeof window !== 'undefined' && 'localStorage' in window) {
        try {
          localStorage.setItem(
            'leadvault_session',
            JSON.stringify({
              profileId: res.profile.id,
              profile: res.profile,
              organization: res.organization,
            })
          );
        } catch {
          // Fallback
        }
      }
    }

    return {
      success: res.success,
      profile: res.profile,
      organization: res.organization,
      role: res.role,
      error: res.error,
    };
  }

  /**
   * Retrieves active session token from secure storage.
   */
  public getSessionToken(): string {
    if (typeof window === 'undefined') return '';
    try {
      const direct = localStorage.getItem('leadvault_session_token');
      if (direct) return direct;
      const raw = localStorage.getItem('leadvault_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed.sessionToken || '';
      }
    } catch {
      return '';
    }
    return '';
  }

  /**
   * Validates and restores session on the server.
   */
  public async restoreServerSession(): Promise<{
    authenticated: boolean;
    profile?: Profile;
    organization?: Organization;
    role?: UserRole;
    error?: string;
  }> {
    const token = this.getSessionToken();
    if (!token) {
      return { authenticated: false, error: 'No active session token' };
    }
    try {
      const res = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.authenticated) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('leadvault_session_token');
          localStorage.removeItem('leadvault_session');
        }
        return { authenticated: false, error: data.error || 'Session expired' };
      }
      return {
        authenticated: true,
        profile: data.profile,
        organization: data.organization,
        role: data.role,
      };
    } catch (err: any) {
      return { authenticated: false, error: err.message || 'Session verification error' };
    }
  }

  /**
   * Revokes the active server session and clears local session tokens.
   */
  public async logout(): Promise<void> {
    const token = this.getSessionToken();
    if (token) {
      try {
        await fetch('/api/auth/session', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Network error handled
      }
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('leadvault_session_token');
      localStorage.removeItem('leadvault_session');
    }
  }
  public async inviteTelecaller(params: InviteTelecallerParams): Promise<{
    success: boolean;
    invitation?: OrganizationInvitation;
    error?: string;
  }> {
    try {
      if (isLiveApiMode()) {
        const token = this.getSessionToken();
        const response = await fetch('/api/auth/invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            fullName: params.fullName,
            phone: params.phone,
            email: params.email,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to create invitation.' };
        }
        return { success: true, invitation: data.invitation };
      }

      const inv = db.createInvitation(
        {
          full_name: params.fullName,
          email: params.email,
          phone: params.phone,
        },
        params.currentProfile
      );

      return { success: true, invitation: inv };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send invitation.' };
    }
  }
}

export const authService = new AuthService();
