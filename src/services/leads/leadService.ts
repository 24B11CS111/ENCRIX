import { StudentDetails, Profile } from '@/types';
import { isLiveApiMode, authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';

export class LeadService {
  /**
   * Secure Student Details Gateway.
   * Fetches authorized student and academic details for an assigned lead.
   *
   * SECURITY ENFORCEMENT:
   * - In live API mode: dispatches to GET /api/leads/detail?id=<leadId> with Bearer session token.
   * - In offline demo mode: delegates to db.getStudentLeadDetails with tenant/assignment checks.
   * - Rejects unassigned or cross-tenant leads.
   * - Returns strictly authorized StudentDetails with ZERO phone exposure.
   * - If the endpoint fails, NEVER falls back to mock data or full lead objects.
   */
  public async getStudentDetails(leadId: string, currentProfile: Profile): Promise<StudentDetails> {
    if (!leadId) {
      throw new Error('Lead ID is required');
    }

    if (!currentProfile) {
      throw new Error('Authenticated profile context is required');
    }

    if (isLiveApiMode() && typeof window !== 'undefined') {
      const token = authService.getSessionToken();
      const res = await fetch(`/api/leads/detail?id=${encodeURIComponent(leadId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to retrieve student details');
      }

      return data as StudentDetails;
    }

    // Local / Offline demo sandbox fallback
    return db.getStudentLeadDetails(leadId, currentProfile);
  }
}

export const leadService = new LeadService();
