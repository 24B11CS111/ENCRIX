import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/services/supabase/db';
import { Organization, Profile, Lead } from '@/types';

describe('ENCRIX Phase 13: Database-Driven Real-Time & Multi-Tenant Staging Suite', () => {
  const orgA: Organization = {
    id: 'org-acme-001',
    name: 'Acme Corp',
    slug: 'acme-corp',
    owner_id: 'owner-acme-001',
    industry: 'Logistics',
    company_size: '50-100',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const orgB: Organization = {
    id: 'org-zenith-002',
    name: 'Zenith Health',
    slug: 'zenith-health',
    owner_id: 'owner-zenith-002',
    industry: 'Healthcare',
    company_size: '20-50',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ownerA: Profile = {
    id: 'prof-owner-acme',
    user_id: 'user-owner-acme',
    organization_id: 'org-acme-001',
    full_name: 'Alice Johnson',
    role: 'OWNER',
    status: 'ACTIVE',
    phone: '+91 98765 00001',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA: Profile = {
    id: 'prof-tc-acme',
    user_id: 'user-tc-acme',
    organization_id: 'org-acme-001',
    full_name: 'Adam Miller',
    role: 'TELECALLER',
    status: 'ACTIVE',
    phone: '+91 98765 00002',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ownerB: Profile = {
    id: 'prof-owner-zenith',
    user_id: 'user-owner-zenith',
    organization_id: 'org-zenith-002',
    full_name: 'Bob Zenith',
    role: 'OWNER',
    status: 'ACTIVE',
    phone: '+91 98765 00003',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerB: Profile = {
    id: 'prof-tc-zenith',
    user_id: 'user-tc-zenith',
    organization_id: 'org-zenith-002',
    full_name: 'Brenda Vance',
    role: 'TELECALLER',
    status: 'ACTIVE',
    phone: '+91 98765 00004',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const adminProfile: Profile = {
    id: 'prof-super-admin',
    user_id: 'user-super-admin',
    organization_id: 'org-acme-001',
    full_name: 'Global Administrator',
    role: 'ADMIN',
    status: 'ACTIVE',
    phone: '+91 98765 99999',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset to production clean state (forceDemo = false)
    db.resetSandbox(false);
  });

  describe('1. Production Zero-State & Clean Database Initialization', () => {
    it('initializes completely clean without sample leads, fake calls or demo events', () => {
      expect(db.getOrganizations(adminProfile)).toHaveLength(0);
      expect(db.getProfiles(adminProfile)).toHaveLength(0);
      expect(db.getLeads(adminProfile)).toHaveLength(0);
      expect(db.getCalls(adminProfile)).toHaveLength(0);
      expect(db.getFollowUps(adminProfile)).toHaveLength(0);
      expect(db.getActivityLogs(adminProfile)).toHaveLength(0);
      expect(db.getSecurityEvents(adminProfile)).toHaveLength(0);
    });

    it('allows clean dynamic provisioning of tenants and users via standard database API', () => {
      db.seedTestTenant(orgA, [ownerA, telecallerA]);
      db.seedTestTenant(orgB, [ownerB, telecallerB]);

      const orgs = db.getOrganizations(adminProfile);
      expect(orgs).toHaveLength(2);
      expect(orgs.map((o) => o.id)).toEqual(expect.arrayContaining(['org-acme-001', 'org-zenith-002']));

      const profilesA = db.getProfiles(ownerA);
      expect(profilesA).toHaveLength(2);
      expect(profilesA.every((p) => p.organization_id === 'org-acme-001')).toBe(true);

      const profilesB = db.getProfiles(ownerB);
      expect(profilesB).toHaveLength(2);
      expect(profilesB.every((p) => p.organization_id === 'org-zenith-002')).toBe(true);
    });
  });

  describe('2. Multi-Tenant Isolation & Least-Privilege Role Authorization', () => {
    beforeEach(() => {
      db.seedTestTenant(orgA, [ownerA, telecallerA]);
      db.seedTestTenant(orgB, [ownerB, telecallerB]);

      // Owner A creates leads for Org A
      db.createLead(
        {
          name: 'Acme Prospect Alpha',
          phone: '+91 98111 11111',
          source: 'Website',
          priority: 'HIGH',
          status: 'NEW',
        },
        ownerA
      );

      db.createLead(
        {
          name: 'Acme Prospect Beta',
          phone: '+91 98222 22222',
          source: 'Referral',
          priority: 'MEDIUM',
          status: 'NEW',
        },
        ownerA
      );

      // Owner B creates leads for Org B
      db.createLead(
        {
          name: 'Zenith Patient Prime',
          phone: '+91 98333 33333',
          source: 'Inbound Call',
          priority: 'URGENT',
          status: 'NEW',
        },
        ownerB
      );
    });

    it('Owner A sees only Org A leads; Owner B sees only Org B leads', () => {
      const leadsA = db.getLeads(ownerA);
      const leadsB = db.getLeads(ownerB);

      expect(leadsA).toHaveLength(2);
      expect(leadsA.every((l) => l.organization_id === 'org-acme-001')).toBe(true);
      expect(leadsA.map((l) => l.name)).toContain('Acme Prospect Alpha');
      expect(leadsA.map((l) => l.name)).not.toContain('Zenith Patient Prime');

      expect(leadsB).toHaveLength(1);
      expect(leadsB.every((l) => l.organization_id === 'org-zenith-002')).toBe(true);
      expect(leadsB[0].name).toBe('Zenith Patient Prime');
    });

    it('Telecaller A cannot view unassigned leads before assignment', () => {
      const tcLeadsA = db.getLeads(telecallerA);
      expect(tcLeadsA).toHaveLength(0);
    });

    it('Lead assigned to Telecaller A is visible to Telecaller A, but completely hidden from Telecaller B', () => {
      const leadsA = db.getLeads(ownerA);
      const leadToAssign = leadsA[0];

      db.assignLeads([leadToAssign.id], telecallerA.id, ownerA);

      const tcLeadsA = db.getLeads(telecallerA);
      expect(tcLeadsA).toHaveLength(1);
      expect(tcLeadsA[0].id).toBe(leadToAssign.id);

      // Telecaller B sees 0 leads
      const tcLeadsB = db.getLeads(telecallerB);
      expect(tcLeadsB).toHaveLength(0);

      // Owner B sees 0 leads from Org A
      const leadsB = db.getLeads(ownerB);
      expect(leadsB.some((l) => l.id === leadToAssign.id)).toBe(false);
    });
  });

  describe('3. Scoped Real-Time Event Dispatch & Cross-Tenant Boundary Enforcement', () => {
    beforeEach(() => {
      db.seedTestTenant(orgA, [ownerA, telecallerA]);
      db.seedTestTenant(orgB, [ownerB, telecallerB]);
    });

    it('dispatches lead assignment event strictly within tenant boundary', () => {
      const lead = db.createLead(
        {
          name: 'Realtime Prospect',
          phone: '+91 99999 88888',
          source: 'Google Ads',
          priority: 'URGENT',
          status: 'NEW',
        },
        ownerA
      );

      const listenerOwnerA = vi.fn();
      const listenerTcA = vi.fn();
      const listenerOwnerB = vi.fn();
      const listenerTcB = vi.fn();

      const unsub1 = db.subscribe(listenerOwnerA, ownerA);
      const unsub2 = db.subscribe(listenerTcA, telecallerA);
      const unsub3 = db.subscribe(listenerOwnerB, ownerB);
      const unsub4 = db.subscribe(listenerTcB, telecallerB);

      db.assignLeads([lead.id], telecallerA.id, ownerA);

      // Listeners in Org A receive assignment events
      expect(listenerOwnerA).toHaveBeenCalled();
      expect(listenerTcA).toHaveBeenCalled();

      // Listeners in Org B received ZERO events
      expect(listenerOwnerB).not.toHaveBeenCalled();
      expect(listenerTcB).not.toHaveBeenCalled();

      unsub1();
      unsub2();
      unsub3();
      unsub4();
    });

    it('propagates call completion and outcome persistence to Owner A but isolates Org B', () => {
      const lead = db.createLead(
        {
          name: 'Calling Lead',
          phone: '+91 98888 77777',
          source: 'Organic',
          priority: 'HIGH',
          status: 'NEW',
        },
        ownerA
      );

      db.assignLeads([lead.id], telecallerA.id, ownerA);

      const listenerOwnerA = vi.fn();
      const listenerOwnerB = vi.fn();

      const unsubA = db.subscribe(listenerOwnerA, ownerA);
      const unsubB = db.subscribe(listenerOwnerB, ownerB);

      const call = db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: 145,
          status: 'COMPLETED',
        },
        telecallerA
      );

      db.recordCallOutcome(
        {
          call_id: call.id,
          lead_id: lead.id,
          outcome: 'CONVERTED',
          interest_level: 'HIGH',
          notes: 'Customer signed enterprise contract during call.',
        },
        telecallerA
      );

      // Verify Owner A received call updates
      const eventsA = listenerOwnerA.mock.calls.map((c) => c[0].type);
      expect(eventsA).toContain('CALL_RECORDED');
      expect(eventsA).toContain('CALL_OUTCOME_SAVED');

      // Verify Owner B received nothing from Org A
      expect(listenerOwnerB).not.toHaveBeenCalled();

      unsubA();
      unsubB();
    });

    it('propagates follow-up creation without requiring page refresh', () => {
      const lead = db.createLead(
        {
          name: 'FollowUp Lead',
          phone: '+91 97777 66666',
          source: 'Web',
          priority: 'HIGH',
          status: 'NEW',
        },
        ownerA
      );

      db.assignLeads([lead.id], telecallerA.id, ownerA);

      const listenerTcA = vi.fn();
      const unsub = db.subscribe(listenerTcA, telecallerA);

      db.scheduleFollowUp(
        {
          lead_id: lead.id,
          scheduled_at: new Date(Date.now() + 86400000).toISOString(),
          priority: 'HIGH',
          notes: 'Demo follow-up scheduled for 2 PM tomorrow',
        },
        telecallerA
      );

      expect(listenerTcA).toHaveBeenCalled();
      const eventTypes = listenerTcA.mock.calls.map((c) => c[0].type);
      expect(eventTypes).toContain('FOLLOWUP_CREATED');

      unsub();
    });
  });

  describe('4. Phone Number Masking & Data Loss Prevention (Export Guard)', () => {
    beforeEach(() => {
      db.seedTestTenant(orgA, [ownerA, telecallerA]);
    });

    it('strictly masks phone numbers when telecallers access leads', () => {
      const lead = db.createLead(
        {
          name: 'Secret Client',
          phone: '+91 98765 43210',
          source: 'Referral',
          priority: 'URGENT',
          status: 'NEW',
        },
        ownerA
      );

      db.assignLeads([lead.id], telecallerA.id, ownerA);

      const telecallerLeads = db.getLeads(telecallerA);
      expect(telecallerLeads[0].phone).toBeUndefined();
      expect('phone' in telecallerLeads[0]).toBe(false);
    });

    it('blocks telecallers from bulk lead export and automatically logs a security violation incident', () => {
      expect(() => {
        db.exportLeads(telecallerA);
      }).toThrow(/Forbidden/);

      const secEvents = db.getSecurityEvents(ownerA);
      expect(secEvents).toHaveLength(1);
      expect(secEvents[0].event_type).toBe('TELECALLER_EXPORT_BLOCKED');
      expect(secEvents[0].severity).toBe('HIGH');
    });
  });

  describe('5. Audit Trail & System Immutability', () => {
    beforeEach(() => {
      db.seedTestTenant(orgA, [ownerA, telecallerA]);
    });

    it('records immutable audit logs for all critical system mutations', () => {
      const lead = db.createLead(
        {
          name: 'Audit Prospect',
          phone: '+91 95555 44444',
          source: 'Campaign',
          priority: 'MEDIUM',
          status: 'NEW',
        },
        ownerA
      );

      db.assignLeads([lead.id], telecallerA.id, ownerA);

      const logs = db.getActivityLogs(ownerA);
      expect(logs.length).toBeGreaterThanOrEqual(2);

      const actions = logs.map((l) => l.action);
      expect(actions).toContain('LEAD_CREATED');
      expect(actions).toContain('LEAD_ASSIGNED');
    });

    it('forbids tampering or deleting security audit entries', () => {
      expect(() => {
        db.deleteSecurityEvent();
      }).toThrow(/Security Violation/);

      expect(() => {
        db.updateSecurityEvent();
      }).toThrow(/Security Violation/);
    });
  });
});
