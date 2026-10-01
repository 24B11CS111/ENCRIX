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
import { sanitizeLeadForRole, sanitizeLeadsForRole } from '@/lib/dataMasking';
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
import { supabase, isRealSupabaseConfigured } from './client';

type RealtimeListener = (event: { type: string; payload: unknown }) => void;

class LeadVaultDatabase {
  private orgs: Organization[] = [...DEMO_ORGS];
  private profiles: Profile[] = [...DEMO_PROFILES];
  private leads: Lead[] = [];
  private calls: Call[] = [];
  private outcomes: CallOutcome[] = [];
  private followUps: FollowUp[] = [...DEMO_FOLLOWUPS];
  private notifications: Notification[] = [...DEMO_NOTIFICATIONS];
  private securityEvents: SecurityEvent[] = [...DEMO_SECURITY_EVENTS];
  private activityLogs: ActivityLog[] = [...DEMO_ACTIVITY_LOGS];

  private listeners: Set<RealtimeListener> = new Set();
  private broadcastChannel: BroadcastChannel | null = null;
  private initialized = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.initialized) return;

    // Check localStorage for persisted sandbox data
    try {
      const storedLeads = localStorage.getItem('leadvault_leads');
      if (storedLeads) {
        this.leads = JSON.parse(storedLeads);
      } else {
        this.leads = generateDemoLeads();
        this.save('leadvault_leads', this.leads);
      }

      const storedCalls = localStorage.getItem('leadvault_calls');
      if (storedCalls) {
        this.calls = JSON.parse(storedCalls);
      } else {
        this.calls = generateDemoCalls(this.leads);
        this.save('leadvault_calls', this.calls);
      }

      const storedFollowups = localStorage.getItem('leadvault_followups');
      if (storedFollowups) {
        this.followUps = JSON.parse(storedFollowups);
      }

      const storedLogs = localStorage.getItem('leadvault_activity_logs');
      if (storedLogs) {
        this.activityLogs = JSON.parse(storedLogs);
      }

      const storedSec = localStorage.getItem('leadvault_security_events');
      if (storedSec) {
        this.securityEvents = JSON.parse(storedSec);
      }

      const storedProfiles = localStorage.getItem('leadvault_profiles');
      if (storedProfiles) {
        this.profiles = JSON.parse(storedProfiles);
      }

      const storedOrgs = localStorage.getItem('leadvault_orgs');
      if (storedOrgs) {
        this.orgs = JSON.parse(storedOrgs);
      }
    } catch {
      this.leads = generateDemoLeads();
      this.calls = generateDemoCalls(this.leads);
    }

    // Cross-tab real-time sync via BroadcastChannel
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel('leadvault_realtime_channel');
      this.broadcastChannel.onmessage = (message) => {
        if (message.data && message.data.type) {
          this.refreshFromStorage();
          this.notifyListeners(message.data.type, message.data.payload);
        }
      };
    }

    this.initialized = true;
  }

  private save(key: string, data: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage quota or SSR fallback
    }
  }

  private refreshFromStorage() {
    try {
      const storedLeads = localStorage.getItem('leadvault_leads');
      if (storedLeads) this.leads = JSON.parse(storedLeads);
      const storedCalls = localStorage.getItem('leadvault_calls');
      if (storedCalls) this.calls = JSON.parse(storedCalls);
      const storedFollowups = localStorage.getItem('leadvault_followups');
      if (storedFollowups) this.followUps = JSON.parse(storedFollowups);
      const storedLogs = localStorage.getItem('leadvault_activity_logs');
      if (storedLogs) this.activityLogs = JSON.parse(storedLogs);
      const storedSec = localStorage.getItem('leadvault_security_events');
      if (storedSec) this.securityEvents = JSON.parse(storedSec);
      const storedProfiles = localStorage.getItem('leadvault_profiles');
      if (storedProfiles) this.profiles = JSON.parse(storedProfiles);
    } catch {
      // Silent error
    }
  }

  private emit(type: string, payload: unknown) {
    this.notifyListeners(type, payload);
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload });
      } catch {
        // Fallback
      }
    }
  }

  private notifyListeners(type: string, payload: unknown) {
    this.listeners.forEach((fn) => {
      try {
        fn({ type, payload });
      } catch (e) {
        console.error('Realtime listener error:', e);
      }
    });
  }

  public subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ----------------------------------------------------
  // ORGANIZATIONS & PROFILES
  // ----------------------------------------------------

  public getOrganizations(currentProfile: Profile): Organization[] {
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
      name: data.name,
      slug: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      owner_id: data.owner_id,
      industry: data.industry,
      company_size: data.company_size,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.orgs.push(newOrg);
    this.save('leadvault_orgs', this.orgs);
    return newOrg;
  }

  public getProfiles(currentProfile: Profile): Profile[] {
    if (currentProfile.role === 'ADMIN') {
      return [...this.profiles];
    }
    // Organization-level isolation
    return this.profiles.filter(
      (p) => p.organization_id === currentProfile.organization_id
    );
  }

  public getTelecallers(currentProfile: Profile): Profile[] {
    const orgProfiles = this.getProfiles(currentProfile);
    return orgProfiles.filter((p) => p.role === 'TELECALLER' && p.status === 'ACTIVE');
  }

  public createTelecaller(
    data: { full_name: string; phone: string; email: string },
    currentProfile: Profile
  ): Profile {
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can create telecallers.');
    }

    const newProfile: Profile = {
      id: `tc-${Date.now().toString(36)}`,
      user_id: `user-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      full_name: data.full_name,
      phone: data.phone,
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
    this.save('leadvault_profiles', this.profiles);

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

    this.emit('TEAM_UPDATED', newProfile);
    return newProfile;
  }

  public updateProfileStatus(
    profileId: string,
    status: 'ACTIVE' | 'DISABLED',
    currentProfile: Profile
  ): Profile {
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
    this.save('leadvault_profiles', this.profiles);

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

    this.emit('TEAM_UPDATED', this.profiles[index]);
    return this.profiles[index];
  }

  // ----------------------------------------------------
  // LEADS & STRICT RLS ENFORCEMENT
  // ----------------------------------------------------

  public getLeads(currentProfile: Profile): Lead[] {
    // ADMIN: Can inspect org leads
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
    // And sensitive fields (full surname, raw phone, email) are sanitized/masked at data boundary
    if (currentProfile.role === 'TELECALLER') {
      const assignedOnly = orgLeads.filter((l) => l.assigned_to === currentProfile.id);
      return sanitizeLeadsForRole(assignedOnly, 'TELECALLER');
    }

    return [];
  }

  public getLeadById(leadId: string, currentProfile: Profile): Lead {
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
   * Internal method for authorized telephony gateway to resolve real phone number
   * when telecaller initiates a call. Telecallers NEVER receive this directly into UI state.
   */
  public getAuthorizedCallingNumber(leadId: string, currentProfile: Profile): string {
    const lead = this.leads.find((l) => l.id === leadId);
    if (!lead) throw new Error('Lead not found');

    if (currentProfile.role === 'TELECALLER' && lead.assigned_to !== currentProfile.id) {
      throw new Error('Unauthorized call attempt on unassigned lead.');
    }

    return lead.phone;
  }

  public createLead(
    leadData: Omit<Lead, 'id' | 'organization_id' | 'lead_code' | 'created_at' | 'updated_at'>,
    currentProfile: Profile
  ): Lead {
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can create leads.');
    }

    const nextNumber = 10300 + this.leads.length + 1;
    const newLead: Lead = {
      ...leadData,
      id: `lead-lv-${nextNumber}`,
      organization_id: currentProfile.organization_id,
      lead_code: `LV-${nextNumber}`,
      status: leadData.assigned_to ? 'ASSIGNED' : 'NEW',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      calls_count: 0,
    };

    this.leads.unshift(newLead);
    this.save('leadvault_leads', this.leads);

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

    this.emit('LEAD_CREATED', newLead);
    return newLead;
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
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can import leads.');
    }

    const newLeads: Lead[] = [];
    const baseCode = 10500 + this.leads.length;

    records.forEach((rec, index) => {
      const code = `LV-${baseCode + index}`;
      const newLead: Lead = {
        id: `lead-imp-${Date.now().toString(36)}-${index}`,
        organization_id: currentProfile.organization_id,
        lead_code: code,
        name: rec.name,
        phone: rec.phone,
        email: rec.email,
        source: rec.source || 'CSV Import',
        priority: rec.priority || 'MEDIUM',
        status: 'NEW',
        assigned_to: null,
        notes: rec.notes || 'Imported via CSV/XLSX wizard',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        calls_count: 0,
      };
      newLeads.push(newLead);
    });

    this.leads = [...newLeads, ...this.leads];
    this.save('leadvault_leads', this.leads);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'LEAD_CREATED',
      entity_type: 'lead',
      metadata: { count: newLeads.length, source: 'CSV_IMPORT' },
    });

    this.emit('LEADS_IMPORTED', { count: newLeads.length });
    return { imported: newLeads.length, leads: newLeads };
  }

  // ----------------------------------------------------
  // LEAD ASSIGNMENTS (MANUAL & ROUND-ROBIN)
  // ----------------------------------------------------

  public assignLeads(
    leadIds: string[],
    telecallerId: string,
    currentProfile: Profile
  ): number {
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can assign leads.');
    }

    const telecaller = this.profiles.find((p) => p.id === telecallerId);
    if (!telecaller || telecaller.organization_id !== currentProfile.organization_id) {
      throw new Error('Invalid telecaller selected.');
    }

    let updatedCount = 0;
    this.leads = this.leads.map((l) => {
      if (leadIds.includes(l.id) && l.organization_id === currentProfile.organization_id) {
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

    this.save('leadvault_leads', this.leads);

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

    this.emit('LEADS_ASSIGNED', { leadIds, telecallerId });
    return updatedCount;
  }

  public assignRoundRobin(
    leadIds: string[],
    activeTelecallerIds: string[],
    currentProfile: Profile
  ): Record<string, number> {
    if (currentProfile.role !== 'OWNER' && currentProfile.role !== 'ADMIN') {
      throw new Error('Unauthorized: Only Owners can assign leads.');
    }

    if (activeTelecallerIds.length === 0) {
      throw new Error('No active telecallers provided for round-robin assignment.');
    }

    const distribution: Record<string, number> = {};
    activeTelecallerIds.forEach((id) => (distribution[id] = 0));

    let index = 0;
    this.leads = this.leads.map((lead) => {
      if (leadIds.includes(lead.id) && lead.organization_id === currentProfile.organization_id) {
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

    this.save('leadvault_leads', this.leads);

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

    this.emit('LEADS_ASSIGNED_ROUND_ROBIN', distribution);
    return distribution;
  }

  // ----------------------------------------------------
  // CALLS & OUTCOMES
  // ----------------------------------------------------

  public getCalls(currentProfile: Profile): Call[] {
    const orgCalls = this.calls.filter(
      (c) => c.organization_id === currentProfile.organization_id
    );

    if (currentProfile.role === 'OWNER' || currentProfile.role === 'ADMIN') {
      return orgCalls;
    }

    // Telecaller only sees their own calls
    return orgCalls.filter((c) => c.telecaller_id === currentProfile.id);
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
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found');

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
    this.save('leadvault_calls', this.calls);

    // Update lead calls count and last_contacted_at
    const leadIdx = this.leads.findIndex((l) => l.id === data.lead_id);
    if (leadIdx !== -1) {
      this.leads[leadIdx] = {
        ...this.leads[leadIdx],
        calls_count: (this.leads[leadIdx].calls_count || 0) + 1,
        last_contacted_at: new Date().toISOString(),
        status: this.leads[leadIdx].status === 'ASSIGNED' ? 'CONTACTED' : this.leads[leadIdx].status,
        updated_at: new Date().toISOString(),
      };
      this.save('leadvault_leads', this.leads);
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

    this.emit('CALL_RECORDED', newCall);
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
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found.');

    const newOutcome: CallOutcome = {
      id: `out-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      call_id: data.call_id,
      lead_id: data.lead_id,
      telecaller_id: currentProfile.id,
      outcome: data.outcome,
      reason: data.reason,
      interest_level: data.interest_level,
      requirement: data.requirement,
      notes: data.notes,
      created_at: new Date().toISOString(),
    };

    this.outcomes.push(newOutcome);

    // Update corresponding Call record
    const callIdx = this.calls.findIndex((c) => c.id === data.call_id);
    if (callIdx !== -1) {
      this.calls[callIdx] = {
        ...this.calls[callIdx],
        outcome: data.outcome,
        notes: data.notes,
      };
      this.save('leadvault_calls', this.calls);
    }

    // Determine new Lead status according to business logic in Sections 13, 23, 24:
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
    const leadIdx = this.leads.findIndex((l) => l.id === data.lead_id);
    if (leadIdx !== -1) {
      this.leads[leadIdx] = {
        ...this.leads[leadIdx],
        status: newStatus,
        notes: data.notes ? `${this.leads[leadIdx].notes || ''}\n[${new Date().toLocaleDateString()}]: ${data.notes}` : this.leads[leadIdx].notes,
        updated_at: new Date().toISOString(),
      };
      this.save('leadvault_leads', this.leads);
    }

    // If follow-up date/time provided or outcome is POSITIVE/FOLLOW_UP, schedule follow-up
    if (data.followUpDate && data.followUpTime) {
      this.scheduleFollowUp(
        {
          lead_id: data.lead_id,
          scheduled_at: `${data.followUpDate}T${data.followUpTime}:00`,
          priority: data.outcome === 'POSITIVE' ? 'HIGH' : 'MEDIUM',
          notes: data.notes || `Follow-up after ${data.outcome} call`,
        },
        currentProfile
      );
    }

    // Notify Owner if high-value positive lead or converted
    if (data.outcome === 'POSITIVE' || data.outcome === 'CONVERTED') {
      const owner = this.profiles.find(
        (p) => p.organization_id === currentProfile.organization_id && p.role === 'OWNER'
      );
      if (owner) {
        this.createNotification({
          organization_id: currentProfile.organization_id,
          user_id: owner.id,
          type: 'CALL_OUTCOME',
          title: `Lead Marked ${data.outcome}`,
          message: `${currentProfile.full_name} marked ${lead.lead_code} (${lead.name}) as ${data.outcome}!`,
          link: '/owner/leads',
        });
      }
    }

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'OUTCOME_CHANGED',
      entity_type: 'lead',
      entity_id: data.lead_id,
      metadata: {
        leadCode: lead.lead_code,
        outcome: data.outcome,
        newStatus,
      },
    });

    this.emit('CALL_OUTCOME_SAVED', { outcome: newOutcome, leadStatus: newStatus });
    return newOutcome;
  }

  // ----------------------------------------------------
  // FOLLOW-UPS
  // ----------------------------------------------------

  public getFollowUps(currentProfile: Profile): FollowUp[] {
    const orgFollowUps = this.followUps.filter(
      (f) => f.organization_id === currentProfile.organization_id
    );

    if (currentProfile.role === 'OWNER' || currentProfile.role === 'ADMIN') {
      return orgFollowUps;
    }

    // Telecaller only sees their assigned follow-ups
    const myFollowUps = orgFollowUps.filter((f) => f.assigned_to === currentProfile.id);
    return myFollowUps.map((f) => ({
      ...f,
      lead_name: f.lead_name ? sanitizeLeadForRole({ ...f, name: f.lead_name } as unknown as Lead, 'TELECALLER').name : '—',
      lead_phone: f.lead_phone ? sanitizeLeadForRole({ ...f, phone: f.lead_phone } as unknown as Lead, 'TELECALLER').phone : '—',
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
    const lead = this.leads.find((l) => l.id === data.lead_id);
    if (!lead) throw new Error('Lead not found.');

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
      notes: data.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.followUps.unshift(newFollowUp);
    this.save('leadvault_followups', this.followUps);

    this.logActivity({
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      user_role: currentProfile.role,
      action: 'FOLLOWUP_CREATED',
      entity_type: 'follow_up',
      entity_id: newFollowUp.id,
      metadata: { leadCode: lead.lead_code, scheduled_at: data.scheduled_at },
    });

    this.emit('FOLLOWUP_CREATED', newFollowUp);
    return newFollowUp;
  }

  public completeFollowUp(id: string, currentProfile: Profile): FollowUp {
    const index = this.followUps.findIndex((f) => f.id === id);
    if (index === -1) throw new Error('Follow-up not found.');

    const fup = this.followUps[index];
    if (fup.organization_id !== currentProfile.organization_id) {
      throw new Error('Forbidden: Follow-up belongs to another organization.');
    }

    this.followUps[index] = {
      ...fup,
      status: 'COMPLETED',
      updated_at: new Date().toISOString(),
    };
    this.save('leadvault_followups', this.followUps);

    this.emit('FOLLOWUP_UPDATED', this.followUps[index]);
    return this.followUps[index];
  }

  // ----------------------------------------------------
  // NOTIFICATIONS, LOGS & SECURITY EVENTS
  // ----------------------------------------------------

  public getNotifications(currentProfile: Profile): Notification[] {
    return this.notifications.filter(
      (n) => n.organization_id === currentProfile.organization_id && n.user_id === currentProfile.id
    );
  }

  public markNotificationRead(id: string): void {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx !== -1) {
      this.notifications[idx].read = true;
      this.emit('NOTIFICATION_READ', { id });
    }
  }

  public createNotification(data: Omit<Notification, 'id' | 'read' | 'created_at'>): Notification {
    const newNotif: Notification = {
      ...data,
      id: `notif-${Date.now().toString(36)}`,
      read: false,
      created_at: new Date().toISOString(),
    };
    this.notifications.unshift(newNotif);
    this.emit('NEW_NOTIFICATION', newNotif);
    return newNotif;
  }

  public getActivityLogs(currentProfile: Profile): ActivityLog[] {
    if (currentProfile.role === 'TELECALLER') {
      // Telecallers only see their own activities
      return this.activityLogs.filter(
        (a) => a.organization_id === currentProfile.organization_id && a.user_id === currentProfile.id
      );
    }
    // Owners/Admins see full org audit log
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
    this.save('leadvault_activity_logs', this.activityLogs);
    this.emit('ACTIVITY_LOGGED', log);
    return log;
  }

  public getSecurityEvents(currentProfile: Profile): SecurityEvent[] {
    if (currentProfile.role === 'TELECALLER') {
      throw new Error('Forbidden: Telecallers cannot access security event records.');
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
      id: `sec-${Date.now().toString(36)}`,
      organization_id: currentProfile.organization_id,
      user_id: currentProfile.id,
      user_name: currentProfile.full_name,
      created_at: new Date().toISOString(),
    };

    this.securityEvents.unshift(event);
    this.save('leadvault_security_events', this.securityEvents);

    // Notify organization owner
    const owner = this.profiles.find(
      (p) => p.organization_id === currentProfile.organization_id && p.role === 'OWNER'
    );
    if (owner) {
      this.createNotification({
        organization_id: currentProfile.organization_id,
        user_id: owner.id,
        type: 'SECURITY_ALERT',
        title: `Security Event: ${event.event_type}`,
        message: event.description,
        link: '/owner/security',
      });
    }

    this.emit('SECURITY_EVENT_RAISED', event);
    return event;
  }

  // Reset sandbox back to clean demo data
  public resetSandbox() {
    localStorage.removeItem('leadvault_leads');
    localStorage.removeItem('leadvault_calls');
    localStorage.removeItem('leadvault_followups');
    localStorage.removeItem('leadvault_activity_logs');
    localStorage.removeItem('leadvault_security_events');
    localStorage.removeItem('leadvault_profiles');
    localStorage.removeItem('leadvault_orgs');
    this.initialized = false;
    this.init();
    this.emit('SANDBOX_RESET', {});
  }
}

export const db = new LeadVaultDatabase();
