import { authService } from '@/services/auth/authService';
import { Profile } from '@/types';

export interface OwnerDashboardMetrics {
  totalLeads: number;
  assignedLeads: number;
  unassignedLeads: number;
  conversions: number;
  leadsByStatus?: Record<string, number>;
  totalCallsCount: number;
  totalCallSeconds: number;
  answeredCallsCount: number;
  connectRate: number;
  callsToday: number;
  activeFollowUps: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  securityCount: number;
  telecallerPerformance: Array<{
    id: string;
    fullName: string;
    email: string;
    status: string;
    leadsCount: number;
    callsCount: number;
    positiveCount: number;
  }>;
}

export interface TelecallerDashboardMetrics {
  totalAssigned: number;
  positiveLeads: number;
  totalCalls: number;
  callsToday: number;
  myFollowUps: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
}

class MetricsService {
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

  public async getDashboardMetrics<T = OwnerDashboardMetrics | TelecallerDashboardMetrics>(
    profile?: Profile | null
  ): Promise<T | null> {
    try {
      const response = await fetch('/api/metrics', {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to load metrics: ${response.status}`);
      }

      const data = await response.json();
      return data.metrics as T;
    } catch (error) {
      console.warn('[metricsService] Unable to fetch server metrics:', error);
      return null;
    }
  }
}

export const metricsService = new MetricsService();
