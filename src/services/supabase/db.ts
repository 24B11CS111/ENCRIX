import {
  Lead,
  Profile,
  Call,
  CallOutcome,
  FollowUp,
  Notification,
  ActivityLog,
  SecurityEvent,
  Organization,
  LeadStatus,
} from '@/types';
import { sanitizeLeadForRole, sanitizeLeadsForRole, maskPhoneNumber } from '@/lib/dataMasking';
import { sanitizeFormulaInjection, sanitizeText } from '@/lib/validation';
import { MAX_IMPORT_ROWS } from '@/lib/config';
import {
  DEMO_ORGS,
  DEMO_PROFILES,
  generateDemoLeads,
  generateDemoCalls,
  DEMO_FOLLOWUPS,
  DEMO_NOTIFICATIONS,
  DEMO_SECURITY_EVENTS,
  DEMO_ACTIVITY_LOGS,
} from './demoData';

export type RealtimeEvent = {
  type: string;
  payload: unknown;
  organization_id?: string;
  target_user_id?: string;
};

type RealtimeListener = (event: RealtimeEvent) => void;

interface SubscriptionEntry {
  listener: RealtimeListener;
  profile?: Profile;
}

class LeadVaultDatabase {
  private orgs: Organization[] = [...DEMO_ORGS];
  private profiles: Profile[] = [...DEMO_PROFILES];
  // In-memory persistent master state (never dumped as raw unmasked leads into browser localStorage)
  private leads: Lead[] = [];
  private calls: Call[] = [];
  private outcomes: CallOutcome[] = [];
  private followUps: FollowUp[] = [...DEMO_FOLLOWUPS];
  private notifications: Notification[] = [...DEMO_NOTIFICATIONS];
  private securityEvents: SecurityEvent[] = [...DEMO_SECURITY_EVENTS];
  private activityLogs: ActivityLog[] = [...DEMO_ACTIVITY_LOGS];

  private subscriptions: Set<SubscriptionEntry> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;

    // SECURITY COMPLIANCE (Section 12):
    // Purge any raw customer lead databases accidentally saved in localStorage
    if (typeof window !== 'undefined' && 'localStorage' in window) {
      try {
        localStorage.removeItem('leadvault_leads');
        localStorage.removeItem('leadvault_calls');
      } catch {
        // Fallback
      }
    }

    // Seed in-memory demo datasets
    this.leads = generateDemoLeads();
    this.calls = generateDemoCalls(this.leads);

    // Cross-tab real-time sync with tenant context
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('leadvault_realtime_channel');
        this.broadcastChannel.onmessage = (message) => {
          if (message.data && message.data.type) {
            this.notifyListeners(message.data as RealtimeEvent);
          }
        };
      } catch {
        // Fallback
      }
    }

    this.initialized = true;
  }

  /**
   * Session validation guard: Ensures caller account is not disabled/suspended
   */
  private ensureActive(profile: Profile): void {
    if (profile.status === 'DISABLED') {
      throw new Error('Forbidden: Account has been suspended. All access revoked.');
    }
  }

  private emit(
    type: string,
    payload: unknown,
    meta?: { organization_id?: string; target_user_id?: string }
  ) {
    const event: RealtimeEvent = {
      type,
      payload,
      organization_id: meta?.organization_id,
      target_user_id: meta?.target_user_id,
    };

    this.notifyListeners(event);
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(event);
      } catch {
        // Fallback
      }
    }
  }

  private notifyListeners(event: RealtimeEvent) {
    this.subscriptions.forEach((sub) => {
      try {
        // Tenant & User Isolation for Realtime Events (Section 11)
        if (sub.profile) {
          // If event has organization_id, ensure listener is in same org or is ADMIN
          if (
            event.organization_id &&
            sub.profile.role !== 'ADMIN' &&
            sub.profile.organization_id !== event.organization_id
          ) {
            return; // Drop cross-tenant event
          }

          // If event has target_user_id, ensure listener is target user, OWNER, or ADMIN
          if (
            event.target_user_id &&
            sub.profile.role === 'TELECALLER' &&
            sub.profile.id !== event.target_user_id
          ) {
            return; // Drop other telecaller's event
          }
        }

        sub.listener(event);
      } catch (e) {
        console.error('Realtime listener error:', e);
      }
    });
  }

  /**
   * Subscribe to real-time events with tenant boundary enforcement
   */
  public subscribe(listener: RealtimeListener, userProfile?: Profile): () => void {
    const entry: SubscriptionEntry = { listener, profile: userProfile };
    this.subscriptions.add(entry);
    return () => {
      this.subscriptions.delete(entry);
    };
  }

  // ----------------------------------------------------
  // ORGANIZATIONS & PROFILES
  // ----------------------------------------------------

  public getOrganizations(currentProfile: Profile): Organization[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'ADMIN') {
      return [...this.orgs];
    }
    return this.orgs.filter((o) => o.id === currentProfile.organization_id);
  }

  public createOrganization(data: {
    name: string;
    industry: string;
    company_size: string;
    owner_id: string;
  }): Organization {
    const newOrg: Organization = {
      id: `org-${Date.now().toString(36)}`,
      name: sanitizeText(data.name),
      slug: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      owner_id: data.owner_id,
      industry: sanitizeText(data.industry),
      company_size: data.company_size,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.orgs.push(newOrg);
    return newOrg;
  }

  public getProfiles(currentProfile: Profile): Profile[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'ADMIN') {
      return [...this.profiles];
    }
    return this.profiles.filter(
      (p) => p.organization_id === currentProfile.organization_id
    );
  }

  public getTelecallers(currentProfile: Profile): Profile[] {
    this.ensureActive(currentProfile);
    const orgProfiles = this.getProfiles(currentProfile);
    return orgProfiles.filter((p) => p.role === 'TELECALLER' && p.status === 'ACTIVE');
  }

  public createTelecaller(
    data: { full_name: string; phone: string; email: string },
    currentProfile: Profile
  ): Profile {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can create telecallers.');
    }

    const newProfile: Profile = {
      id: `tc-${Date.now().toString(36)}`,
      user_id: `user-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      full_name: sanitizeText(data.full_name),
      phone: data.phone.trim(),
      role: 'TELECALLER',
      status: 'ACTIVE',
      avatar_url: `https://images.unsplash.com/photo-${1530000000000 + Math.floor(Math.random() * 100000)}?w=120&auto=format&fit=crop&q=80`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_count: 0,
      calls_today: 0,
      positive_count: 0,
      conversion_rate: 0,
    };

    this.profiles.push(newProfile);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'USER_CREATED',
      entity_type: 'profile',
      entity_id: newProfile.id,
      metadata: { name: newProfile.full_name, role: 'TELECALLER' },
    });

    this.emit('TEAM_UPDATED', newProfile, { organization_id: currentProfile.organization_id });
    return newProfile;
  }

  public updateProfileStatus(
    profileId: string,
    status: 'ACTIVE' | 'DISABLED',
    currentProfile: Profile
  ): Profile {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can modify user status.');
    }

    const index = this.profiles.findIndex((p) => p.id === profileId);
    if (index === -1) throw new Error('User profile not found.');

    const target = this.profiles[index];
    if (target.organization_id !== currentProfile.organization_id && currentProfile.role !== 'ADMIN') {
      throw new Error('Forbidden: Cannot modify users of another organization.');
    }

    this.profiles[index] = { ...target, status, updated_at: new Date().toISOString() };

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: status === 'DISABLED' ? 'USER_DISABLED' : 'LEAD_UPDATED',
      entity_type: 'profile',
      entity_id: profileId,
      metadata: { targetUser: target.full_name, status },
    });

    this.emit('TEAM_UPDATED', this.profiles[index], { organization_id: currentProfile.organization_id });
    return this.profiles[index];
  }

  // ----------------------------------------------------
  // LEADS & DATA MASKING
  // ----------------------------------------------------

  public getLeads(currentProfile: Profile): Lead[] {
    this.ensureActive(currentProfile);

    // ADMIN: Can inspect platform leads
    if (currentProfile.role === 'ADMIN') {
      return [...this.leads];
    }

    // Multi-tenant organization isolation filter
    const orgLeads = this.leads.filter(
      (l) => l.organization_id === currentProfile.organization_id
    );

    // OWNER: Sees all leads in their organization unmasked
    if (currentProfile.role === 'OWNER') {
      return orgLeads;
    }

    // TELECALLER: Can ONLY see leads assigned to them!
    // Sensitive fields (full surname, raw phone, email) are sanitized/masked at data boundary
    if (currentProfile.role === 'TELECALLER') {
      const assignedOnly = orgLeads.filter((l) => l.assigned_to === currentProfile.id);
      return sanitizeLeadsForRole(assignedOnly, 'TELECALLER');
    }

    return [];
  }

  public getLeadById(leadId: string, currentProfile: Profile): Lead {
    this.ensureActive(currentProfile);
    const lead = this.leads.find((l) => l.id === leadId);
    if (!lead) {
      throw new Error('Lead not found.');
    }

    // Check organization isolation
    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: You do not have permission to access this lead.');
    }

    // Check telecaller assignment isolation
    if (currentProfile.role === 'TELECALLER' && lead.assigned_to !== currentProfile.id) {
      // Record security event if an unauthorized lead view attempt occurs!
      this.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to view unassigned lead ${lead.lead_code}.`,
          metadata: { targetLeadId: leadId, targetLeadCode: lead.lead_code },
        },
        currentProfile
      );

      throw new Error('Forbidden: You do not have permission to access this lead.');
    }

    // Return sanitized lead for telecaller, unmasked for owner/admin
    return sanitizeLeadForRole(lead, currentProfile.role);
  }

  /**
   * Search leads with strict RLS enforcement (Section 22)
   */
  public searchLeads(query: string, currentProfile: Profile): Lead[] {
    this.ensureActive(currentProfile);
    const normalized = query.toLowerCase().trim();
    if (!normalized) return this.getLeads(currentProfile);

    // Filter ONLY authorized leads for caller
    const authorizedLeads = this.getLeads(currentProfile);
    return authorizedLeads.filter(
      (l) =>
        l.lead_code.toLowerCase().includes(normalized) ||
        l.name.toLowerCase().includes(normalized) ||
        l.phone.toLowerCase().includes(normalized) ||
        (l.email && l.email.toLowerCase().includes(normalized)) ||
        l.source.toLowerCase().includes(normalized)
    );
  }

  /**
   * Server-side/internal phone resolution for telephony gateway only.
   * Telecallers are strictly blocked from calling this directly into client code!
   */
  public getAuthorizedCallingNumber(leadId: string, currentProfile: Profile): string {
    this.ensureActive(currentProfile);
    const lead = this.leads.find((l) => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    if (currentProfile.role === 'TELECALLER') {
      this.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_PHONE_EXTRACTION_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted direct client extraction of raw phone for lead ${lead.lead_code}.`,
          metadata: { leadId, leadCode: lead.lead_code },
        },
        currentProfile
      );
      throw new Error(
        'Forbidden: Client-side extraction of raw customer phone numbers is prohibited. Calling must be placed through server gateway.'
      );
    }

    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: Lead belongs to another organization.');
    }

    return lead.phone;
  }

  public createLead(
    leadData: Omit<Lead, 'id' | 'organization_id' | 'lead_code' | 'created_at' | 'updated_at'>,
    currentProfile: Profile
  ): Lead {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can create leads.');
    }

    const nextNumber = 10300 + this.leads.length + 1;
    const newLead: Lead = {
      ...leadData,
      name: sanitizeText(leadData.name),
      phone: leadData.phone.trim(),
      email: leadData.email ? leadData.email.trim() : undefined,
      source: sanitizeText(leadData.source || 'Direct'),
      notes: leadData.notes ? sanitizeText(leadData.notes) : undefined,
      id: `lead-lv-${nextNumber}`,
      // Enforce organization isolation: cannot inject another organization_id!
      organization_id: currentProfile.organization_id,
      lead_code: `LV-${nextNumber}`,
      status: leadData.assigned_to ? 'ASSIGNED' : 'NEW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      calls_count: 0,
    };

    this.leads.unshift(newLead);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_CREATED',
      entity_type: 'lead',
      entity_id: newLead.id,
      metadata: { leadCode: newLead.lead_code, name: newLead.name },
    });

    this.emit('LEAD_CREATED', newLead, { organization_id: currentProfile.organization_id });
    return newLead;
  }

  public updateLead(
    leadId: string,
    updates: Partial<Lead>,
    currentProfile: Profile
  ): Lead {
    this.ensureActive(currentProfile);
    const index = this.leads.findIndex((l) => l.id === leadId);
    if (index === -1) throw new Error('Lead not found.');

    const lead = this.leads[index];

    // Organization isolation
    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: You do not have permission to modify this lead.');
    }

    // Telecaller field restriction & assignment check (Section 4)
    if (currentProfile.role === 'TELECALLER') {
      if (lead.assigned_to !== currentProfile.id) {
        this.recordSecurityEvent(
          {
            event_type: 'UNAUTHORIZED_LEAD_UPDATE_ATTEMPT',
            severity: 'HIGH',
            description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to modify unassigned lead ${lead.lead_code}.`,
            metadata: { targetLeadId: leadId, targetLeadCode: lead.lead_code },
          },
          currentProfile
        );
        throw new Error('Forbidden: You can only update leads assigned to you.');
      }

      // Telecaller may only update status and notes
      const restrictedFields = ['phone', 'email', 'organization_id', 'assigned_to', 'lead_code', 'id'];
      const hasRestricted = restrictedFields.some((field) => field in updates);
      if (hasRestricted) {
        this.recordSecurityEvent(
          {
            event_type: 'UNAUTHORIZED_FIELD_TAMPERING_ATTEMPT',
            severity: 'HIGH',
            description: `Telecaller ${currentProfile.full_name} attempted to modify restricted fields on lead ${lead.lead_code}.`,
            metadata: { updates },
          },
          currentProfile
        );
        throw new Error('Forbidden: Telecallers are not authorized to modify sensitive lead fields.');
      }
    }

    // Apply allowed sanitized updates
    const updatedLead: Lead = {
      ...lead,
      status: updates.status || lead.status,
      notes: updates.notes !== undefined ? sanitizeText(updates.notes) : lead.notes,
      name: updates.name && currentProfile.role !== 'TELECALLER' ? sanitizeText(updates.name) : lead.name,
      phone: updates.phone && currentProfile.role !== 'TELECALLER' ? updates.phone.trim() : lead.phone,
      email: updates.email !== undefined && currentProfile.role !== 'TELECALLER' ? updates.email.trim() : lead.email,
      priority: updates.priority || lead.priority,
      assigned_to: updates.assigned_to !== undefined && currentProfile.role !== 'TELECALLER' ? updates.assigned_to : lead.assigned_to,
      updated_at: new Date().toISOString(),
    };

    this.leads[index] = updatedLead;

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_UPDATED',
      entity_type: 'lead',
      entity_id: leadId,
      metadata: { leadCode: lead.lead_code, updates },
    });

    this.emit('LEAD_UPDATED', updatedLead, { organization_id: currentProfile.organization_id });
    return sanitizeLeadForRole(updatedLead, currentProfile.role);
  }

  public deleteLead(leadId: string, currentProfile: Profile): boolean {
    this.ensureActive(currentProfile);
    const index = this.leads.findIndex((l) => l.id === leadId);
    if (index === -1) throw new Error('Lead not found.');

    const lead = this.leads[index];

    // Telecaller deletion attempt trap
    if (currentProfile.role === 'TELECALLER') {
      this.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_LEAD_DELETION_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to delete lead ${lead.lead_code}. Blocked by RLS Guard.`,
          metadata: { targetLeadId: leadId, targetLeadCode: lead.lead_code },
        },
        currentProfile
      );
      throw new Error('Forbidden: Telecallers cannot delete leads.');
    }

    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: You cannot delete leads from another organization.');
    }

    this.leads.splice(index, 1);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_UPDATED',
      entity_type: 'lead',
      entity_id: leadId,
      metadata: { leadCode: lead.lead_code, action: 'DELETED' },
    });

    this.emit('LEAD_DELETED', { leadId }, { organization_id: currentProfile.organization_id });
    return true;
  }

  public importLeads(
    records: Array<{
      name: string;
      phone: string;
      email?: string;
      source?: string;
      priority?: Lead['priority'];
      notes?: string;
    }>,
    currentProfile: Profile
  ): { imported: number; leads: Lead[] } {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can import leads.');
    }

    if (records.length > MAX_IMPORT_ROWS) {
      throw new Error(`Batch size exceeds maximum limit of ${MAX_IMPORT_ROWS} rows.`);
    }

    const newLeads: Lead[] = [];
    const baseCode = 10500 + this.leads.length;

    records.forEach((rec, index) => {
      const code = `LV-${baseCode + index}`;
      const newLead: Lead = {
        id: `lead-imp-${Date.now().toString(36)}-${index}`,
        organization_id: currentProfile.organization_id,
        lead_code: code,
        name: sanitizeText(rec.name),
        phone: rec.phone.trim(),
        email: rec.email ? rec.email.trim() : undefined,
        source: sanitizeText(rec.source || 'CSV Import'),
        priority: rec.priority || 'MEDIUM',
        status: 'NEW',
        assigned_to: null,
        notes: rec.notes ? sanitizeText(rec.notes) : 'Imported via CSV/XLSX wizard',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        calls_count: 0,
      };
      newLeads.push(newLead);
    });

    this.leads = [...newLeads, ...this.leads];

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_CREATED',
      entity_type: 'lead',
      metadata: { count: newLeads.length, source: 'CSV_IMPORT' },
    });

    this.emit('LEADS_IMPORTED', { count: newLeads.length }, { organization_id: currentProfile.organization_id });
    return { imported: newLeads.length, leads: newLeads };
  }

  /**
   * Secure Lead Export (Section 9)
   * Telecallers are strictly prohibited from exporting.
   * Owners/Admins receive data sanitized against spreadsheet formula injection.
   */
  public exportLeads(
    currentProfile: Profile,
    _format: 'csv' | 'json' = 'csv'
  ): Lead[] {
    this.ensureActive(currentProfile);

    if (currentProfile.role === 'TELECALLER') {
      this.recordSecurityEvent(
        {
          event_type: 'TELECALLER_EXPORT_BLOCKED',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to export master lead database via direct API. Blocked by LeadVault Export Guard.`,
          metadata: { agent: currentProfile.full_name },
        },
        currentProfile
      );
      throw new Error('Forbidden: Telecallers are strictly prohibited from exporting lead databases.');
    }

    const orgLeads = this.getLeads(currentProfile);

    // Sanitize exported fields to prevent CSV formula injection (Section 16)
    return orgLeads.map((l) => ({
      ...l,
      name: sanitizeFormulaInjection(l.name),
      notes: l.notes ? sanitizeFormulaInjection(l.notes) : l.notes,
      source: sanitizeFormulaInjection(l.source),
    }));
  }

  // ----------------------------------------------------
  // LEAD ASSIGNMENTS (MANUAL & ROUND-ROBIN)
  // ----------------------------------------------------

  public assignLeads(
    leadIds: string[],
    telecallerId: string,
    currentProfile: Profile
  ): number {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can assign leads.');
    }

    const telecaller = this.profiles.find((p) => p.id === telecallerId);
    if (!telecaller || (telecaller.organization_id !== currentProfile.organization_id && currentProfile.role !== 'ADMIN')) {
      throw new Error('Invalid telecaller selected.');
    }

    // Verify all leads belong to this organization (Section 4 Cross-Tenant Assignment Check)
    const unauthorizedLead = this.leads.find(
      (l) => leadIds.includes(l.id) && l.organization_id !== currentProfile.organization_id && currentProfile.role !== 'ADMIN'
    );
    if (unauthorizedLead) {
      this.recordSecurityEvent(
        {
          event_type: 'CROSS_TENANT_ASSIGNMENT_ATTEMPT',
          severity: 'HIGH',
          description: `Attempted to assign lead ${unauthorizedLead.lead_code} belonging to another organization.`,
          metadata: { targetLeadId: unauthorizedLead.id },
        },
        currentProfile
      );
      throw new Error('Forbidden: Cannot assign leads belonging to another organization.');
    }

    let updatedCount = 0;
    this.leads = this.leads.map((l) => {
      if (leadIds.includes(l.id) && (l.organization_id === currentProfile.organization_id || currentProfile.role === 'ADMIN')) {
        updatedCount++;
        return {
          ...l,
          assigned_to: telecallerId,
          status: l.status === 'NEW' ? 'ASSIGNED' : l.status,
          updated_at: new Date().toISOString(),
        };
      }
      return l;
    });

    // Notify telecaller
    this.createNotification({
      organization_id: currentProfile.organization_id,
      user_id: telecallerId,
      type: 'LEAD_ASSIGNED',
      title: 'New Leads Assigned',
      message: `${updatedCount} new leads assigned to your queue by ${currentProfile.full_name}.`,
      link: '/telecaller/leads',
    });

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_ASSIGNED',
      entity_type: 'lead',
      metadata: { count: updatedCount, assignedTo: telecaller.full_name },
    });

    this.emit('LEADS_ASSIGNED', { leadIds, telecallerId }, { organization_id: currentProfile.organization_id });
    return updatedCount;
  }

  public assignRoundRobin(
    leadIds: string[],
    activeTelecallerIds: string[],
    currentProfile: Profile
  ): Record<string, number> {
    this.ensureActive(currentProfile);
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can assign leads.');
    }

    if (activeTelecallerIds.length === 0) {
      throw new Error('No active telecallers provided for round-robin assignment.');
    }

    // Verify all leads belong to this organization
    const unauthorizedLead = this.leads.find(
      (l) => leadIds.includes(l.id) && l.organization_id !== currentProfile.organization_id && currentProfile.role !== 'ADMIN'
    );
    if (unauthorizedLead) {
      throw new Error('Forbidden: Cannot assign leads belonging to another organization.');
    }

    const distribution: Record<string, number> = {};
    activeTelecallerIds.forEach((id) => (distribution[id] = 0));

    let index = 0;
    this.leads = this.leads.map((lead) => {
      if (leadIds.includes(lead.id) && (lead.organization_id === currentProfile.organization_id || currentProfile.role === 'ADMIN')) {
        const assignedTc = activeTelecallerIds[index % activeTelecallerIds.length];
        distribution[assignedTc] = (distribution[assignedTc] || 0) + 1;
        index++;

        return {
          ...lead,
          assigned_to: assignedTc,
          status: lead.status === 'NEW' ? 'ASSIGNED' : lead.status,
          updated_at: new Date().toISOString(),
        };
      }
      return lead;
    });

    // Send notifications to each assigned telecaller
    activeTelecallerIds.forEach((tcId) => {
      const count = distribution[tcId] || 0;
      if (count > 0) {
        this.createNotification({
          organization_id: currentProfile.organization_id,
          user_id: tcId,
          type: 'LEAD_ASSIGNED',
          title: 'Round-Robin Lead Assignment',
          message: `${count} leads assigned to you via automatic round-robin distribution.`,
          link: '/telecaller/leads',
        });
      }
    });

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_ASSIGNED',
      entity_type: 'lead',
      metadata: {
        algorithm: 'ROUND_ROBIN',
        totalLeads: leadIds.length,
        telecallerCount: activeTelecallerIds.length,
      },
    });

    this.emit('LEADS_ASSIGNED_ROUND_ROBIN', distribution, { organization_id: currentProfile.organization_id });
    return distribution;
  }

  // ----------------------------------------------------
  // CALLS & OUTCOMES
  // ----------------------------------------------------

  public getCalls(currentProfile: Profile): Call[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'ADMIN') {
      return [...this.calls];
    }

    const orgCalls = this.calls.filter(
      (c) => c.organization_id === currentProfile.organization_id
    );

    if (currentProfile.role === 'OWNER') {
      return orgCalls;
    }

    // Telecaller only sees their own calls
    return orgCalls.filter((c) => c.telecaller_id === currentProfile.id);
  }

  public getCallById(callId: string, currentProfile: Profile): Call {
    this.ensureActive(currentProfile);
    const call = this.calls.find((c) => c.id === callId);
    if (!call) throw new Error('Call record not found.');

    if (currentProfile.role !== 'ADMIN' && call.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: Access denied to call in another organization.');
    }

    if (currentProfile.role === 'TELECALLER' && call.telecaller_id !== currentProfile.id) {
      throw new Error("Forbidden: Access denied to another telecaller's call.");
    }

    return call;
  }

  public recordCall(
    data: {
      lead_id: string;
      duration_seconds: number;
      status: Call['status'];
      recording_url?: string;
    },
    currentProfile: Profile
  ): Call {
    this.ensureActive(currentProfile);
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found');

    // Organization Isolation (Section 3 & 4)
    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error("Forbidden: Cannot place calls on another organization's lead.");
    }

    // Telecaller Assignment Isolation (Section 4)
    if (currentProfile.role === 'TELECALLER' && lead.assigned_to !== currentProfile.id) {
      this.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_CALL_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to place call on unassigned lead ${lead.lead_code}.`,
          metadata: { leadId: lead.id, leadCode: lead.lead_code },
        },
        currentProfile
      );
      throw new Error('Forbidden: Cannot place calls on leads not assigned to you.');
    }

    const newCall: Call = {
      id: `call-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      lead_id: data.lead_id,
      lead_code: lead.lead_code,
      lead_name: currentProfile.role === 'TELECALLER' ? sanitizeLeadForRole(lead, 'TELECALLER').name : lead.name,
      telecaller_id: currentProfile.id,
      telecaller_name: currentProfile.full_name,
      provider: 'MOCK',
      provider_call_id: `CALL_REF_${Date.now()}`,
      started_at: new Date(Date.now() - data.duration_seconds * 1000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: data.duration_seconds,
      status: data.status,
      recording_url: data.recording_url || `https://mock-telephony.leadvault.dev/rec_${Date.now()}.mp3`,
      recording_consent: true,
      created_at: new Date().toISOString(),
    };

    this.calls.unshift(newCall);

    // Update lead calls count and last_contacted_at
    const leadIdx = this.leads.findIndex((l) => l.id === data.lead_id);
    if (leadIdx !== -1) {
      this.leads[leadIdx] = {
        ...this.leads[leadIdx],
        calls_count: (this.leads[leadIdx].calls_count || 0) + 1,
        last_contacted_at: new Date().toISOString(),
      };
    }

    // Update telecaller profile stats
    const profIdx = this.profiles.findIndex((p) => p.id === currentProfile.id);
    if (profIdx !== -1) {
      this.profiles[profIdx] = {
        ...this.profiles[profIdx],
        calls_today: (this.profiles[profIdx].calls_today || 0) + 1,
      };
    }

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'CALL_COMPLETED',
      entity_type: 'call',
      entity_id: newCall.id,
      metadata: {
        leadCode: lead.lead_code,
        duration: data.duration_seconds,
        status: data.status,
      },
    });

    this.emit('CALL_RECORDED', newCall, { organization_id: currentProfile.organization_id });
    return newCall;
  }

  public recordCallOutcome(
    data: {
      call_id: string;
      lead_id: string;
      outcome: CallOutcome['outcome'];
      reason?: string;
      interest_level?: string;
      requirement?: string;
      notes?: string;
      followUpDate?: string;
      followUpTime?: string;
    },
    currentProfile: Profile
  ): CallOutcome {
    this.ensureActive(currentProfile);
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found.');

    // Organization Isolation (Section 3 & 4)
    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error("Forbidden: Cannot record outcome on another organization's lead.");
    }

    // Telecaller Assignment Isolation (Section 4)
    if (currentProfile.role === 'TELECALLER' && lead.assigned_to !== currentProfile.id) {
      this.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_OUTCOME_MUTATION_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${currentProfile.full_name} (${currentProfile.id}) attempted to record outcome on unassigned lead ${lead.lead_code}.`,
          metadata: { leadId: lead.id, leadCode: lead.lead_code },
        },
        currentProfile
      );
      throw new Error('Forbidden: Cannot record outcomes on leads not assigned to you.');
    }

    // Check call ownership if modifying an existing call (Section 4)
    const callIdx = this.calls.findIndex((c) => c.id === data.call_id);
    if (callIdx !== -1) {
      const existingCall = this.calls[callIdx];
      if (currentProfile.role === 'TELECALLER' && existingCall.telecaller_id !== currentProfile.id) {
        this.recordSecurityEvent(
          {
            event_type: 'UNAUTHORIZED_CALL_OUTCOME_OVERWRITE',
            severity: 'HIGH',
            description: `Telecaller ${currentProfile.full_name} attempted to modify another telecaller's call (${data.call_id}).`,
            metadata: { callId: data.call_id },
          },
          currentProfile
        );
        throw new Error("Forbidden: Cannot modify another telecaller's call outcome.");
      }
    }

    const newOutcome: CallOutcome = {
      id: `out-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      call_id: data.call_id,
      lead_id: data.lead_id,
      telecaller_id: currentProfile.id,
      outcome: data.outcome,
      reason: data.reason ? sanitizeText(data.reason) : undefined,
      interest_level: data.interest_level,
      requirement: data.requirement ? sanitizeText(data.requirement) : undefined,
      notes: data.notes ? sanitizeText(data.notes) : undefined,
      created_at: new Date().toISOString(),
    };

    this.outcomes.push(newOutcome);

    // Update corresponding Call record
    if (callIdx !== -1) {
      this.calls[callIdx] = {
        ...this.calls[callIdx],
        outcome: data.outcome,
        notes: data.notes ? sanitizeText(data.notes) : this.calls[callIdx].notes,
      };
    }

    // Determine new Lead status according to business logic
    let newStatus: LeadStatus = lead.status;
    if (data.outcome === 'POSITIVE') {
      newStatus = 'INTERESTED';
    } else if (data.outcome === 'NEGATIVE') {
      newStatus = 'NOT_INTERESTED';
    } else if (data.outcome === 'CONVERTED') {
      newStatus = 'CONVERTED';
    } else if (data.outcome === 'DO_NOT_CONTACT') {
      newStatus = 'DO_NOT_CONTACT';
    } else if (data.outcome === 'FOLLOW_UP') {
      newStatus = 'FOLLOW_UP';
    } else if (data.outcome === 'NO_ANSWER' || data.outcome === 'BUSY') {
      newStatus = 'CONTACTED';
    }

    // Update lead in state
    const leadIndex = this.leads.findIndex((l) => l.id === data.lead_id);
    if (leadIndex !== -1) {
      this.leads[leadIndex] = {
        ...this.leads[leadIndex],
        status: newStatus,
        notes: data.notes ? sanitizeText(data.notes) : this.leads[leadIndex].notes,
        updated_at: new Date().toISOString(),
      };
    }

    // Auto schedule follow-up if provided
    if (data.followUpDate) {
      this.scheduleFollowUp(
        {
          lead_id: data.lead_id,
          scheduled_at: `${data.followUpDate}T${data.followUpTime || '11:00'}:00Z`,
          priority: data.outcome === 'POSITIVE' ? 'HIGH' : 'MEDIUM',
          notes: data.notes,
        },
        currentProfile
      );
    }

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'OUTCOME_CHANGED',
      entity_type: 'call_outcome',
      entity_id: newOutcome.id,
      metadata: {
        leadCode: lead.lead_code,
        outcome: data.outcome,
        newStatus,
      },
    });

    // Notify organization owner
    const owner = this.profiles.find(
      (p) => p.organization_id === currentProfile.organization_id && p.role === 'OWNER'
    );
    if (owner) {
      this.createNotification({
        organization_id: currentProfile.organization_id,
        user_id: owner.id,
        type: 'CALL_OUTCOME',
        title: `Lead Marked ${data.outcome}`,
        message: `${currentProfile.full_name} marked ${lead.lead_code} as ${data.outcome}!`,
        link: '/owner/calls',
      });
    }

    this.emit('CALL_OUTCOME_SAVED', newOutcome, { organization_id: currentProfile.organization_id });
    return newOutcome;
  }

  // ----------------------------------------------------
  // FOLLOW-UPS
  // ----------------------------------------------------

  public getFollowUps(currentProfile: Profile): FollowUp[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'ADMIN') {
      return [...this.followUps];
    }

    const orgFollowUps = this.followUps.filter(
      (f) => f.organization_id === currentProfile.organization_id
    );

    if (currentProfile.role === 'OWNER') {
      return orgFollowUps;
    }

    // Telecaller only sees their assigned follow-ups with masked phone
    const myFollowUps = orgFollowUps.filter((f) => f.assigned_to === currentProfile.id);
    return myFollowUps.map((f) => ({
      ...f,
      lead_name: f.lead_name ? sanitizeLeadForRole({ ...f, name: f.lead_name } as unknown as Lead, 'TELECALLER').name : '—',
      lead_phone: f.lead_phone ? maskPhoneNumber(f.lead_phone) : '—',
    }));
  }

  public scheduleFollowUp(
    data: {
      lead_id: string;
      scheduled_at: string;
      priority: FollowUp['priority'];
      notes?: string;
    },
    currentProfile: Profile
  ): FollowUp {
    this.ensureActive(currentProfile);
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found.');

    // Organization Isolation
    if (currentProfile.role !== 'ADMIN' && lead.organization_id !== currentProfile.organization_id) {
      throw new Error("Forbidden: Cannot schedule follow-ups on another organization's lead.");
    }

    // Telecaller Assignment Isolation
    if (currentProfile.role === 'TELECALLER' && lead.assigned_to !== currentProfile.id) {
      throw new Error('Forbidden: Cannot schedule follow-ups on leads not assigned to you.');
    }

    const newFollowUp: FollowUp = {
      id: `fup-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      lead_id: data.lead_id,
      lead_code: lead.lead_code,
      lead_name: lead.name,
      lead_phone: lead.phone,
      assigned_to: currentProfile.id,
      scheduled_at: data.scheduled_at,
      status: 'PENDING',
      priority: data.priority || 'MEDIUM',
      notes: data.notes ? sanitizeText(data.notes) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.followUps.unshift(newFollowUp);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'FOLLOWUP_CREATED',
      entity_type: 'follow_up',
      entity_id: newFollowUp.id,
      metadata: { leadCode: lead.lead_code, scheduledAt: data.scheduled_at },
    });

    this.emit('FOLLOWUP_CREATED', newFollowUp, { organization_id: currentProfile.organization_id });
    return newFollowUp;
  }

  public completeFollowUp(id: string, currentProfile: Profile): FollowUp {
    this.ensureActive(currentProfile);
    const index = this.followUps.findIndex((f) => f.id === id);
    if (index === -1) throw new Error('Follow-up not found.');

    const fup = this.followUps[index];
    if (currentProfile.role !== 'ADMIN' && fup.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: Follow-up belongs to another organization.');
    }

    if (currentProfile.role === 'TELECALLER' && fup.assigned_to !== currentProfile.id) {
      throw new Error("Forbidden: Cannot complete another telecaller's follow-up.");
    }

    this.followUps[index] = {
      ...fup,
      status: 'COMPLETED',
      updated_at: new Date().toISOString(),
    };

    this.emit('FOLLOWUP_UPDATED', this.followUps[index], { organization_id: currentProfile.organization_id });
    return this.followUps[index];
  }

  // ----------------------------------------------------
  // NOTIFICATIONS, LOGS & SECURITY EVENTS
  // ----------------------------------------------------

  public getNotifications(currentProfile: Profile): Notification[] {
    this.ensureActive(currentProfile);
    return this.notifications.filter(
      (n) => n.organization_id === currentProfile.organization_id && n.user_id === currentProfile.id
    );
  }

  public markNotificationRead(id: string): void {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx !== -1) {
      this.notifications[idx].read = true;
      this.emit('NOTIFICATION_READ', { id }, { organization_id: this.notifications[idx].organization_id });
    }
  }

  public createNotification(data: Omit<Notification, 'id' | 'read' | 'created_at'>): Notification {
    const newNotif: Notification = {
      ...data,
      title: sanitizeText(data.title),
      message: sanitizeText(data.message),
      id: `notif-${Date.now().toString(36)}`,
      read: false,
      created_at: new Date().toISOString(),
    };
    this.notifications.unshift(newNotif);
    this.emit('NEW_NOTIFICATION', newNotif, {
      organization_id: data.organization_id,
      target_user_id: data.user_id,
    });
    return newNotif;
  }

  public getActivityLogs(currentProfile: Profile): ActivityLog[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'ADMIN') {
      return [...this.activityLogs];
    }

    if (currentProfile.role === 'TELECALLER') {
      // Telecallers only see their own activities
      return this.activityLogs.filter(
        (a) => a.organization_id === currentProfile.organization_id && a.user_id === currentProfile.id
      );
    }
    // Owners see full org audit log
    return this.activityLogs.filter(
      (a) => a.organization_id === currentProfile.organization_id
    );
  }

  public logActivity(data: Omit<ActivityLog, 'id' | 'created_at'>): ActivityLog {
    const log: ActivityLog = {
      ...data,
      id: `act-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
    };
    this.activityLogs.unshift(log);
    this.emit('ACTIVITY_LOGGED', log, { organization_id: data.organization_id });
    return log;
  }

  /**
   * SECURITY ENFORCEMENT (Section 19):
   * Activity logs are append-only. Modifying or deleting logs is strictly prohibited.
   */
  public deleteActivityLog(): never {
    throw new Error('Security Violation: Activity audit logs are append-only and cannot be deleted.');
  }

  public updateActivityLog(): never {
    throw new Error('Security Violation: Activity audit logs are strictly immutable and cannot be modified.');
  }

  public getSecurityEvents(currentProfile: Profile): SecurityEvent[] {
    this.ensureActive(currentProfile);
    if (currentProfile.role === 'TELECALLER') {
      throw new Error('Forbidden: Telecallers cannot access security event records.');
    }
    if (currentProfile.role === 'ADMIN') {
      return [...this.securityEvents];
    }
    return this.securityEvents.filter(
      (s) => s.organization_id === currentProfile.organization_id
    );
  }

  public recordSecurityEvent(
    data: Omit<SecurityEvent, 'id' | 'organization_id' | 'created_at'>,
    currentProfile: Profile
  ): SecurityEvent {
    const event: SecurityEvent = {
      ...data,
      description: sanitizeText(data.description),
      id: `sec-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      created_at: new Date().toISOString(),
    };

    this.securityEvents.unshift(event);

    // Notify organization owner
    const owner = this.profiles.find(
      (p) => p.organization_id === currentProfile.organization_id && p.role === 'OWNER'
    );
    if (owner) {
      this.createNotification({
        organization_id: currentProfile.organization_id,
        user_id: owner.id,
        type: 'SECURITY_ALERT',
        title: `Security Alert: ${event.event_type}`,
        message: event.description,
        link: '/owner/security',
      });
    }

    this.emit('SECURITY_EVENT_RAISED', event, { organization_id: currentProfile.organization_id });
    return event;
  }

  /**
   * SECURITY ENFORCEMENT (Section 20):
   * Security events are immutable tamper-evident logs. Deletion and updates are forbidden.
   */
  public deleteSecurityEvent(): never {
    throw new Error('Security Violation: Security events are append-only and cannot be deleted.');
  }

  public updateSecurityEvent(): never {
    throw new Error('Security Violation: Security events are strictly immutable and cannot be modified.');
  }

  // Reset sandbox back to clean demo data
  public resetSandbox() {
    this.initialized = false;
    this.init();
    this.emit('SANDBOX_RESET', {});
  }
}

export const db = new LeadVaultDatabase();
