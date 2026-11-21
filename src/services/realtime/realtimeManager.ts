import { supabase, isRealSupabaseConfigured } from '@/services/supabase/client';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

export type RealtimeConnectionStatus = 'LIVE' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';
type StatusListener = (status: RealtimeConnectionStatus) => void;
type Transport = 'CUSTOM_SESSION' | 'SUPABASE_AUTH' | 'LOCAL';

const CUSTOM_SESSION_POLL_MS = 5_000;

export class RealtimeConnectionManager {
  private status: RealtimeConnectionStatus = 'LIVE';
  private listeners = new Set<StatusListener>();
  private reconnectListeners = new Set<() => void>();
  private profile: Profile | null = null;
  private transport: Transport | null = null;
  private identityKey: string | null = null;
  private sessionToken = '';
  private channel: any = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private revision: number | null = null;
  private online = true;
  private supabaseAuthSubscription: { unsubscribe: () => void } | null = null;

  constructor() {
    this.init();
  }

  private init(): void {
    if (typeof window === 'undefined') return;
    this.online = navigator.onLine;
    this.status = this.online ? 'LIVE' : 'OFFLINE';
    window.addEventListener('online', () => {
      this.online = true;
      this.reconnect();
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.stopTransport(true);
      this.setStatus('OFFLINE');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.online && this.profile) this.reconnect();
    });
  }

  private syncSupabaseAuthListener(enabled: boolean): void {
    if (!enabled) {
      this.supabaseAuthSubscription?.unsubscribe();
      this.supabaseAuthSubscription = null;
      return;
    }
    if (this.supabaseAuthSubscription) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // A custom OTP session is verified by the server and deliberately does not
      // depend on a possibly stale Supabase Auth identity.
      if (this.transport !== 'SUPABASE_AUTH' || !this.profile) return;
      if (!session?.user?.id || session.user.id !== this.profile.user_id) {
        this.stopTransport(true);
        this.setStatus('OFFLINE');
        return;
      }
      // Refresh the channel's authenticated identity when Supabase rotates tokens.
      queueMicrotask(() => {
        if (this.transport === 'SUPABASE_AUTH' && this.profile?.user_id === session.user.id) this.reconnect();
      });
    });
    this.supabaseAuthSubscription = data.subscription;
  }

  public getStatus(): RealtimeConnectionStatus { return this.status; }

  public onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  public onReconnected(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  public setStatus(status: RealtimeConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.listeners.forEach((listener) => {
      try { listener(status); } catch (error) { console.error('Status listener error:', error); }
    });
  }

  /**
   * Start exactly one identity-bound transport. A custom signed ENCRIX session
   * always uses authenticated server polling, even if Supabase has a stale session.
   */
  public setIdentity(profile: Profile | null): void {
    const token = authService.getSessionToken();
    const transport: Transport = token
      ? 'CUSTOM_SESSION'
      : isRealSupabaseConfigured() ? 'SUPABASE_AUTH' : 'LOCAL';
    const key = profile
      ? [profile.id, profile.user_id, profile.organization_id, profile.role, profile.status, transport].join('|')
      : null;

    if (key === this.identityKey && token === this.sessionToken) return;
    this.stopTransport(true);
    this.profile = profile;
    this.transport = profile ? transport : null;
    this.identityKey = key;
    this.sessionToken = token;
    this.revision = null;
    this.syncSupabaseAuthListener(!!profile && transport === 'SUPABASE_AUTH');

    if (!profile || profile.status !== 'ACTIVE' || !profile.organization_id || !profile.user_id ||
      !['OWNER', 'ADMIN', 'TELECALLER'].includes(profile.role)) {
      this.syncSupabaseAuthListener(false);
      this.profile = null;
      this.transport = null;
      this.identityKey = null;
      db.unsubscribeAll();
      this.setStatus(this.online ? 'LIVE' : 'OFFLINE');
      return;
    }
    if (!this.online) {
      this.setStatus('OFFLINE');
      return;
    }
    if (transport === 'LOCAL') {
      this.setStatus('CONNECTED');
      this.notifyReconnected();
      return;
    }
    this.reconnect();
  }

  public reconnect(): void {
    if (!this.online) {
      this.setStatus('OFFLINE');
      return;
    }
    if (!this.profile || !this.transport) {
      this.setStatus('OFFLINE');
      return;
    }
    this.stopTransport();
    if (this.transport === 'CUSTOM_SESSION') {
      void this.beginCustomPolling(this.profile, this.sessionToken, this.generation);
    } else if (this.transport === 'SUPABASE_AUTH') {
      void this.beginSupabaseSubscription(this.profile, this.generation);
    }
  }

  private stopTransport(preserveRevision = false): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!preserveRevision) this.revision = null;
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      try { void supabase.removeChannel(channel); } catch { /* channel already closed */ }
    }
  }

  private async readRevision(token: string): Promise<number> {
    const response = await fetch('/api/realtime/refresh', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const error = new Error(`Refresh endpoint returned ${response.status}`) as Error & { unauthorized?: boolean };
      error.unauthorized = response.status === 401 || response.status === 403;
      throw error;
    }
    const body = await response.json();
    if (!Number.isSafeInteger(body?.revision) || body.revision < 0) {
      throw new Error('Refresh endpoint returned an invalid revision.');
    }
    return body.revision;
  }

  private acceptRevision(profile: Profile, revision: number, generation: number): void {
    if (generation !== this.generation || this.profile?.id !== profile.id) return;
    const previous = this.revision;
    this.revision = revision;
    if (previous !== null && previous !== revision) db.dispatchLeadRefreshRequired(profile, revision);
  }

  private async beginCustomPolling(profile: Profile, token: string, generation: number): Promise<void> {
    if (!token || generation !== this.generation) return;
    this.setStatus('RECONNECTING');
    try {
      if (authService.getSessionToken() !== token) return this.setIdentity(profile);
      const revision = await this.readRevision(token);
      if (generation !== this.generation) return;
      this.acceptRevision(profile, revision, generation);
      this.setStatus('CONNECTED');
      this.notifyReconnected();
      this.timer = setTimeout(() => void this.pollCustom(profile, token, generation), CUSTOM_SESSION_POLL_MS);
    } catch (error) {
      if (generation !== this.generation) return;
      if ((error as { unauthorized?: boolean }).unauthorized) {
        this.setStatus('OFFLINE');
        return;
      }
      this.setStatus('RECONNECTING');
      this.timer = setTimeout(() => void this.beginCustomPolling(profile, token, generation), CUSTOM_SESSION_POLL_MS);
    }
  }

  private async pollCustom(profile: Profile, token: string, generation: number): Promise<void> {
    if (generation !== this.generation || !this.online) return;
    if (authService.getSessionToken() !== token) return this.setIdentity(profile);
    try {
      this.acceptRevision(profile, await this.readRevision(token), generation);
      this.setStatus('CONNECTED');
    } catch (error) {
      if ((error as { unauthorized?: boolean }).unauthorized) {
        this.setStatus('OFFLINE');
        return;
      }
      this.setStatus('RECONNECTING');
    }
    if (generation === this.generation && this.profile?.id === profile.id) {
      this.timer = setTimeout(() => void this.pollCustom(profile, token, generation), CUSTOM_SESSION_POLL_MS);
    }
  }

  private async beginSupabaseSubscription(profile: Profile, generation: number): Promise<void> {
    this.setStatus('RECONNECTING');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (generation !== this.generation) return;
      if (!session?.access_token || session.user.id !== profile.user_id) {
        this.setStatus('OFFLINE');
        return;
      }
      const revision = await this.readRevision(session.access_token);
      if (generation !== this.generation) return;
      this.acceptRevision(profile, revision, generation);

      const filter = profile.role === 'TELECALLER'
        ? `recipient_profile_id=eq.${profile.id}`
        : `organization_id=eq.${profile.organization_id}`;
      const channel = supabase
        .channel(`encrix_lead_refresh_${profile.id}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'lead_refresh_signals',
          filter,
        }, (payload: any) => {
          // Read only the allowlisted cursor fields. Realtime rows are never cached or dispatched.
          const row = payload?.new;
          if (!row || row.organization_id !== profile.organization_id) return;
          if (profile.role === 'TELECALLER' && row.recipient_profile_id !== profile.id) return;
          if (profile.role !== 'TELECALLER' && row.recipient_profile_id !== null) return;
          if (Number.isSafeInteger(row.revision) && row.revision >= 0) {
            this.acceptRevision(profile, row.revision, generation);
          }
        })
        .subscribe((state: string) => {
          if (generation !== this.generation) return;
          if (state === 'SUBSCRIBED') {
            this.setStatus('CONNECTED');
            this.notifyReconnected();
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            this.setStatus('OFFLINE');
          }
        });
      if (generation !== this.generation) {
        void supabase.removeChannel(channel);
        return;
      }
      this.channel = channel;
    } catch {
      if (generation === this.generation) this.setStatus('OFFLINE');
    }
  }

  private notifyReconnected(): void {
    this.reconnectListeners.forEach((listener) => {
      try { listener(); } catch (error) { console.error('Reconnect listener error:', error); }
    });
  }

  /** Explicitly invalidate identity-bound subscriptions and polling on logout. */
  public cleanup(): void {
    this.stopTransport();
    this.profile = null;
    this.transport = null;
    this.identityKey = null;
    this.sessionToken = '';
    this.syncSupabaseAuthListener(false);
    db.unsubscribeAll();
    this.setStatus(this.online ? 'LIVE' : 'OFFLINE');
  }
}

export const realtimeManager = new RealtimeConnectionManager();
