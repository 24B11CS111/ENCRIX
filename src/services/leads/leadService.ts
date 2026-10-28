import { Lead, LeadStatus, Profile, StudentDetails } from '@/types';
import { isLiveApiMode, authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';
import { IS_DEMO_MODE } from '@/lib/config';
import { isRealSupabaseConfigured } from '@/services/supabase/client';

// Keep this list aligned with the sanitized database projection. In particular,
// never add phone or raw contact fields here.
const TELECALLER_LEAD_COLUMNS =
  'id,organization_id,lead_code,name,email,source,status,priority,assigned_to,notes,last_contacted_at,calls_count,created_at,updated_at';

const removeProtectedLeadFields = (lead: Lead): Lead => {
  const { phone: _phone, metadata: _metadata, ...safeLead } = lead;
  return safeLead as Lead;
};

export class LeadService {
  private requireTelecaller(profile: Profile): void {
    if (!profile || profile.role !== 'TELECALLER' || profile.status !== 'ACTIVE') {
      throw new Error('An active telecaller profile is required.');
    }
  }

  private useDemoAdapter(): boolean {
    if (isRealSupabaseConfigured()) return false;
    if (IS_DEMO_MODE && !isLiveApiMode()) return true;
    throw new Error('Secure telecaller lead access is not configured for this session.');
  }

  /** Reads only the authenticated, sanitized telecaller projection in live mode. */
  public async getAssignedTelecallerLeads(currentProfile: Profile): Promise<Lead[]> {
    this.requireTelecaller(currentProfile);
    if (this.useDemoAdapter()) {
      return db.getLeads(currentProfile).map(removeProtectedLeadFields);
    }
    const token = authService.getSessionToken();
    if (!token) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch('/api/leads/telecaller', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Assigned leads could not be loaded. Please try again.');
    const body = await response.json();
    if (!Array.isArray(body?.leads)) throw new Error('Assigned leads could not be loaded. Please try again.');
    return body.leads.map((row: Lead) => removeProtectedLeadFields(row));
  }

  /** Updates only the approved fields through the authenticated database RPC. */
  public async updateAssignedTelecallerLead(
    leadId: string,
    status: LeadStatus,
    notes: string,
    currentProfile: Profile
  ): Promise<Lead> {
    this.requireTelecaller(currentProfile);
    if (!leadId) throw new Error('A lead must be selected.');

    if (this.useDemoAdapter()) {
      db.updateLead(leadId, { status, notes }, currentProfile);
      const updated = db.getLeads(currentProfile).find((lead) => lead.id === leadId);
      if (!updated) throw new Error('This lead is no longer assigned to your account.');
      return removeProtectedLeadFields(updated);
    }
    const token = authService.getSessionToken();
    if (!token) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch('/api/leads/telecaller/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ leadId, status, notes }),
    });
    if (!response.ok) {
      throw new Error('This lead could not be updated. It may no longer be assigned to your account.');
    }
    const body = await response.json();
    if (!body?.lead || body.lead.id !== leadId) {
      throw new Error('The update was saved, but the lead could not be refreshed.');
    }
    return removeProtectedLeadFields(body.lead as Lead);
  }

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

  /**
   * Fetches all leads belonging to the caller's organization (Owner / Admin).
   * In live API mode, dispatches to GET /api/leads/owner.
   */
  public async getOwnerLeads(currentProfile: Profile): Promise<Lead[]> {
    if (!currentProfile || !['OWNER', 'ADMIN'].includes(currentProfile.role)) {
      throw new Error('Only owners or administrators can access organization leads.');
    }

    if (isLiveApiMode()) {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch('/api/leads/owner', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Organization leads could not be loaded.');
      }

      const body = await response.json();
      return Array.isArray(body?.leads) ? body.leads : [];
    }

    return db.getLeads(currentProfile);
  }

  /**
   * Creates a new lead in the organization.
   * In live API mode, dispatches to POST /api/leads/owner/create.
   */
  public async createLead(
    leadData: Partial<Lead>,
    currentProfile: Profile
  ): Promise<Lead> {
    if (!currentProfile || !['OWNER', 'ADMIN'].includes(currentProfile.role)) {
      throw new Error('Only owners or administrators can create leads.');
    }

    if (isLiveApiMode()) {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch('/api/leads/owner/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(leadData),
      });

      const body = await response.json();
      if (!response.ok || !body?.lead) {
        throw new Error(body?.error || 'Failed to save new lead.');
      }

      return body.lead;
    }

    return db.createLead(leadData as any, currentProfile);
  }

  /**
   * Assigns multiple leads to a telecaller.
   * In live API mode, dispatches to POST /api/leads/owner/assign.
   */
  public async assignLeads(
    leadIds: string[],
    telecallerId: string,
    currentProfile: Profile
  ): Promise<number> {
    if (!currentProfile || !['OWNER', 'ADMIN'].includes(currentProfile.role)) {
      throw new Error('Only owners or administrators can assign leads.');
    }

    if (isLiveApiMode()) {
      const token = authService.getSessionToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch('/api/leads/owner/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leadIds, telecallerId }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to assign leads.');
      }

      return body?.assigned_count ?? leadIds.length;
    }

    return db.assignLeads(leadIds, telecallerId, currentProfile);
  }
}

export const leadService = new LeadService();
