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

  private getStorageKey(key: string): string {
    return `encrix_ticket_${key}`;
  }

  public getStoredTicket(key: string): string | undefined {
    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        const item = sessionStorage.getItem(this.getStorageKey(key));
        if (item) return item;
      }
    } catch {
      // Storage unavailable fallback
    }
    return this.tickets.get(key);
  }

  public setStoredTicket(key: string, ticket: string): void {
    this.tickets.set(key, ticket);
    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        sessionStorage.setItem(this.getStorageKey(key), ticket);
      }
    } catch {
      // Storage unavailable fallback
    }
  }

  public clearStoredTicket(key: string): void {
    this.tickets.delete(key);
    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        sessionStorage.removeItem(this.getStorageKey(key));
      }
    } catch {
      // Storage unavailable fallback
    }
  }

  public clearAllStoredTickets(): void {
    this.tickets.clear();
    try {
      if (typeof window !== 'undefined' && 'sessionStorage' in window) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('encrix_ticket_')) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          sessionStorage.removeItem(k);
        }
      }
    } catch {
      // Storage unavailable fallback
    }
  }

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
          this.setStoredTicket(key, effectiveTicket);
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
        const effectiveTicket = params.verificationTicket || params.registrationTicket || this.getStoredTicket(ticketKey);

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
          if (data.error && (
            data.error.includes('expired') ||
            data.error.includes('Too many attempts') ||
            data.error.includes('No active verification code')
          )) {
            this.clearStoredTicket(ticketKey);
          }
          return { success: false, error: data.error || 'Verification failed.' };
        }

        // Verification succeeded: clean up ticket
        this.clearStoredTicket(ticketKey);

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

  public setSessionToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('leadvault_session_token', token);
    }
  }

  public clearSessionToken(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('leadvault_session_token');
      localStorage.removeItem('leadvault_session');
    }
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
    this.clearAllStoredTickets();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('leadvault_session_token');
      localStorage.removeItem('leadvault_session');
    }
  }
  /**
   * Validates and retrieves an invitation by its cryptographic token.
   */

  public async getInvitations(currentProfile?: Profile | null): Promise<{
    success: boolean;
    invitations?: OrganizationInvitation[];
    error?: string;
  }> {
    if (isLiveApiMode()) {
      const token = this.getSessionToken();

      if (!token) {
        return { success: false, error: 'Please sign in again.' };
      }

      try {
        const response = await fetch('/api/auth/invitations', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: data.error || 'Unable to load invitations.',
          };
        }

        return {
          success: true,
          invitations: data.invitations || [],
        };
      } catch {
        return {
          success: false,
          error: 'Network error while loading invitations.',
        };
      }
    }

    if (currentProfile) {
      return {
        success: true,
        invitations: db.getInvitations(currentProfile),
      };
    }

    return {
      success: true,
      invitations: [],
    };
  }

  public async revokeInvitation(id: string, currentProfile?: Profile | null): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (isLiveApiMode()) {
      const token = this.getSessionToken();

      if (!token) {
        return { success: false, error: 'Please sign in again.' };
      }

      try {
        const response = await fetch('/api/auth/invitations', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id }),
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: data.error || 'Unable to revoke invitation.',
          };
        }

        return { success: true };
      } catch {
        return {
          success: false,
          error: 'Network error while revoking invitation.',
        };
      }
    }

    if (currentProfile) {
      try {
        db.revokeInvitation(id, currentProfile);
        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err?.message || 'Unable to revoke invitation.',
        };
      }
    }

    return { success: false, error: 'Session profile missing.' };
  }

  public async getOrganizationTelecallers(currentProfile?: Profile | null): Promise<{
    success: boolean;
    telecallers?: Profile[];
    error?: string;
  }> {
    if (isLiveApiMode()) {
      const token = this.getSessionToken();
      if (!token) return { success: false, error: 'Please sign in again.' };

      try {
        const response = await fetch('/api/auth/team', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        const data = await response.json();
        if (!response.ok) {
          return {
            success: false,
            error: data.error || 'Unable to load team members.',
          };
        }

        return {
          success: true,
          telecallers: data.telecallers || [],
        };
      } catch {
        return {
          success: false,
          error: 'Network error while loading team members.',
        };
      }
    }

    if (currentProfile) {
      return {
        success: true,
        telecallers: db
          .getProfiles(currentProfile)
          .filter((p) => p.role === 'TELECALLER'),
      };
    }

    return { success: true, telecallers: [] };
  }

  public async updateTelecallerStatus(
    telecallerId: string,
    status: 'ACTIVE' | 'DISABLED',
    currentProfile?: Profile | null
  ): Promise<{
    success: boolean;
    telecaller?: Profile;
    error?: string;
  }> {
    if (isLiveApiMode()) {
      const token = this.getSessionToken();
      if (!token) return { success: false, error: 'Please sign in again.' };

      try {
        const response = await fetch('/api/auth/team', {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ telecallerId, status }),
        });

        const data = await response.json();
        if (!response.ok) {
          return {
            success: false,
            error: data.error || 'Unable to update telecaller status.',
          };
        }

        return { success: true, telecaller: data.telecaller };
      } catch {
        return {
          success: false,
          error: 'Network error while updating telecaller status.',
        };
      }
    }

    if (currentProfile) {
      try {
        db.updateProfileStatus(telecallerId, status, currentProfile);
        const updated = db.getProfiles(currentProfile).find((p) => p.id === telecallerId);
        return { success: true, telecaller: updated };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to update status.' };
      }
    }

    return { success: false, error: 'Profile required.' };
  }

  public async getInvitation(token: string): Promise<{
    success: boolean;
    invitation?: OrganizationInvitation;
    error?: string;
    code?: string;
  }> {
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { success: false, error: 'Invitation token is required.' };
    }

    const cleanToken = token.trim();

    if (isLiveApiMode()) {
      try {
        const res = await fetch(`/api/auth/invite?token=${encodeURIComponent(cleanToken)}`);
        const data = await res.json();
        if (!res.ok) {
          return {
            success: false,
            error: data.error || 'Invitation link is invalid or could not be found.',
            code: data.code,
          };
        }
        return {
          success: true,
          invitation: data.invitation,
        };
      } catch (err: any) {
        // Network fallback in offline dev/test modes
      }
    }

    // Client mock / offline fallback
    const inv = db.getInvitationByToken(cleanToken);
    if (!inv) {
      return { success: false, error: 'Invitation link is invalid or could not be found.' };
    }

    if (inv.status === 'EXPIRED') {
      return {
        success: false,
        error: 'This invitation has expired. Please contact your organization owner for a new invitation.',
        code: 'EXPIRED',
      };
    }

    if (inv.status === 'ACCEPTED') {
      return {
        success: false,
        error: 'This invitation has already been accepted. Please sign in directly.',
        code: 'ACCEPTED',
      };
    }

    if (inv.status === 'REVOKED') {
      return {
        success: false,
        error: 'This invitation has been revoked by the organization owner.',
        code: 'REVOKED',
      };
    }

    return { success: true, invitation: inv };
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

      const canonicalOrigin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:5173';
      inv.inviteUrl = `${canonicalOrigin}/accept-invitation?token=${inv.token}`;

      return { success: true, invitation: inv };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send invitation.' };
    }
  }
}

export const authService = new AuthService();
