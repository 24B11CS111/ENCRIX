import { FollowUp, Profile } from '@/types';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';

class FollowUpService {
  private getHeaders(): Record<string, string> {
    const token = authService.getSessionToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async getFollowUps(profile?: Profile | null, params?: { status?: string }): Promise<FollowUp[]> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.getFollowUps(profile);
    }

    try {
      let url = '/api/follow-ups';
      if (params?.status && params.status !== 'ALL') {
        url += `?status=${encodeURIComponent(params.status)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch follow-ups: ${response.status}`);
      }

      const data = await response.json();
      return data.followUps || [];
    } catch (error) {
      if (profile) {
        return db.getFollowUps(profile);
      }
      throw error;
    }
  }

  public async createFollowUp(
    payload: {
      leadId: string;
      scheduledAt: string;
      priority?: string;
      notes?: string;
      assignedTo?: string;
    },
    profile?: Profile | null
  ): Promise<FollowUp> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.createFollowUp(
        {
          lead_id: payload.leadId,
          assigned_to: payload.assignedTo || profile.id,
          scheduled_at: payload.scheduledAt,
          priority: payload.priority as any || 'MEDIUM',
          notes: payload.notes || '',
        },
        profile
      );
    }

    const response = await fetch('/api/follow-ups', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create follow-up');
    }

    return data.followUp;
  }

  public async rescheduleFollowUp(
    id: string,
    scheduledAt: string,
    reason?: string,
    profile?: Profile | null
  ): Promise<FollowUp> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.rescheduleFollowUp(id, scheduledAt, reason || 'Rescheduled', profile);
    }

    const response = await fetch('/api/follow-ups', {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        id,
        action: 'reschedule',
        scheduledAt,
        reason,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to reschedule follow-up');
    }

    return data.followUp;
  }

  public async completeFollowUp(
    id: string,
    outcome?: string,
    outcomeNotes?: string,
    profile?: Profile | null
  ): Promise<FollowUp> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.completeFollowUp(id, profile, outcomeNotes);
    }

    const response = await fetch('/api/follow-ups', {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        id,
        action: 'complete',
        outcome,
        outcomeNotes,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to complete follow-up');
    }

    return data.followUp;
  }

  public async cancelFollowUp(
    id: string,
    reason?: string,
    profile?: Profile | null
  ): Promise<FollowUp> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.cancelFollowUp(id, reason || 'Cancelled', profile);
    }

    const response = await fetch('/api/follow-ups', {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        id,
        action: 'cancel',
        reason,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel follow-up');
    }

    return data.followUp;
  }
}

export const followUpService = new FollowUpService();
