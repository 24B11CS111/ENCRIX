import { supabase, isRealSupabaseConfigured } from '@/services/supabase/client';
import { db } from '@/services/supabase/db';

export type RealtimeConnectionStatus = 'LIVE' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';

type StatusListener = (status: RealtimeConnectionStatus) => void;

class RealtimeConnectionManager {
  private status: RealtimeConnectionStatus = 'LIVE';
  private listeners: Set<StatusListener> = new Set();
  private reconnectListeners: Set<() => void> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: any = null;
  private isWindowOnline = true;
  private activeOrgId: string | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (typeof window !== 'undefined') {
      this.isWindowOnline = navigator.onLine;
      this.status = this.isWindowOnline ? 'LIVE' : 'OFFLINE';

      window.addEventListener('online', () => {
        this.isWindowOnline = true;
        this.reconnect();
      });

      window.addEventListener('offline', () => {
        this.isWindowOnline = false;
        this.setStatus('OFFLINE');
      });

      // Synchronize with tab visibility
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isWindowOnline) {
          if (this.status === 'OFFLINE' || this.status === 'RECONNECTING') {
            this.reconnect();
          }
        }
      });
    }
  }

  public getStatus(): RealtimeConnectionStatus {
    return this.status;
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setStatus(newStatus: RealtimeConnectionStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.status);
      } catch (e) {
        console.error('Status listener error:', e);
      }
    });
  }

  public onReconnected(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  private notifyReconnected() {
    this.reconnectListeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.error('Reconnected listener error:', e);
      }
    });
  }

  /**
   * Set tenant context and ensure tenant-scoped channel attachment
   */
  public setOrganization(orgId: string | null) {
    if (this.activeOrgId !== orgId) {
      this.activeOrgId = orgId;
      if (orgId) {
        this.reconnect();
      }
    }
  }

  /**
   * Exponential backoff reconnect
   */
  public reconnect() {
    if (!this.isWindowOnline) {
      this.setStatus('OFFLINE');
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus('RECONNECTING');

    if (isRealSupabaseConfigured() && this.activeOrgId) {
      const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
      this.reconnectAttempts++;

      this.reconnectTimer = setTimeout(async () => {
        try {
          // Attempt channel refresh
          const channel = supabase.channel(`encrix_org_${this.activeOrgId}`);
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              this.reconnectAttempts = 0;
              this.setStatus('LIVE');
              this.notifyReconnected();
            } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
              if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnect();
              } else {
                this.setStatus('OFFLINE');
              }
            } else if (status === 'CLOSED') {
              this.setStatus('OFFLINE');
            }
          });
        } catch {
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnect();
          } else {
            this.setStatus('OFFLINE');
          }
        }
      }, backoffMs);
    } else {
      // In-memory / Staging / Test
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.setStatus('LIVE');
        this.notifyReconnected();
      }, 300);
    }
  }

  /**
   * Explicit cleanup on user logout or org switch
   */
  public cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.activeOrgId = null;
    this.reconnectListeners.clear();
    db.unsubscribeAll();
    this.setStatus(this.isWindowOnline ? 'LIVE' : 'OFFLINE');
  }
}

export const realtimeManager = new RealtimeConnectionManager();
