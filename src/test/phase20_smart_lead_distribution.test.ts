import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile, Lead, DistributionMode } from '@/types';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import distributionConfigHandler from '../../api/_lib/leads/distribution-config';
import distributeHandler from '../../api/_lib/leads/distribute';

// Mock HTTP Request/Response helper for API endpoint tests
function createMockReqRes(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, any>;
}) {
  const req: any = {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    url: '/',
  };

  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };

  return { req, res };
}

describe('ENCRIX Phase 20: Smart Lead Distribution & Workload Balancing', () => {
  const orgAId = 'org-vertex-001';
  const orgBId = 'org-prime-002';

  const ownerA: Profile = {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: orgAId,
    full_name: 'Vikram Malhotra',
    email: 'vikram@vertex.com',
    role: 'OWNER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ownerB: Profile = {
    id: 'prof-owner-002',
    user_id: 'user-owner-002',
    organization_id: orgBId,
    full_name: 'Rohan Verma',
    email: 'rohan@prime.com',
    role: 'OWNER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA1: Profile = {
    id: 'tc-arjun-01',
    user_id: 'user-tc-01',
    organization_id: orgAId,
    full_name: 'Arjun Kumar',
    email: 'arjun@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA2: Profile = {
    id: 'tc-rahul-02',
    user_id: 'user-tc-02',
    organization_id: orgAId,
    full_name: 'Rahul Sharma',
    email: 'rahul@vertex.com',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    db.resetSandbox(true);
  });

  // =========================================================================
  // 1. DISTRIBUTION CONFIGURATION RULES & RBAC
  // =========================================================================
  describe('1. Organization Distribution Configuration & RBAC', () => {
    it('retrieves default distribution config for an organization', () => {
      const config = db.getDistributionConfig(ownerA);
      expect(config).toBeDefined();
      expect(config.organization_id).toBe(orgAId);
      expect(['MANUAL', 'ROUND_ROBIN', 'WORKLOAD_BALANCED']).toContain(config.mode);
      expect(typeof config.round_robin_index).toBe('number');
    });

    it('allows owner to update distribution mode, auto-import, max workload, and eligible pool', () => {
      const updated = db.updateDistributionConfig(
        {
          mode: 'WORKLOAD_BALANCED',
          enabled_for_import: true,
          max_workload: 35,
          eligible_telecaller_ids: [telecallerA1.id],
        },
        ownerA
      );

      expect(updated.mode).toBe('WORKLOAD_BALANCED');
      expect(updated.enabled_for_import).toBe(true);
      expect(updated.max_workload).toBe(35);
      expect(updated.eligible_telecaller_ids).toEqual([telecallerA1.id]);

      // Re-read to ensure persistence
      const reRead = db.getDistributionConfig(ownerA);
      expect(reRead.mode).toBe('WORKLOAD_BALANCED');
      expect(reRead.max_workload).toBe(35);
    });

    it('rejects invalid mode or invalid max_workload', () => {
      expect(() =>
        db.updateDistributionConfig({ mode: 'INVALID_MODE' as any }, ownerA)
      ).toThrow(/Invalid distribution mode/i);

      expect(() =>
        db.updateDistributionConfig({ max_workload: -10 }, ownerA)
      ).toThrow(/positive integer/i);

      expect(() =>
        db.updateDistributionConfig({ max_workload: 0 }, ownerA)
      ).toThrow(/positive integer/i);
    });

    it('strictly forbids telecallers from accessing or updating distribution configuration', () => {
      expect(() => db.getDistributionConfig(telecallerA1)).toThrow(/Unauthorized/i);

      expect(() =>
        db.updateDistributionConfig({ mode: 'ROUND_ROBIN' }, telecallerA1)
      ).toThrow(/Unauthorized/i);

      // Verify security event was recorded
      const secEvents = db.getSecurityEvents(ownerA);
      const attempt = secEvents.find(
        (e) => e.event_type === 'UNAUTHORIZED_DISTRIBUTION_CONFIG_ATTEMPT'
      );
      expect(attempt).toBeDefined();
      expect(attempt?.user_id).toBe(telecallerA1.id);
    });

    it('prevents cross-tenant configuration updates', () => {
      expect(() =>
        db.updateDistributionConfig(
          { organization_id: orgBId, mode: 'WORKLOAD_BALANCED' },
          ownerA
        )
      ).toThrow(/Forbidden/i);
    });
  });

  // =========================================================================
  // 2. ROUND-ROBIN DISTRIBUTION & PERSISTENT ROTATION
  // =========================================================================
  describe('2. Round-Robin Distribution & Persistent Rotation', () => {
    it('distributes leads sequentially across eligible telecallers and advances persistent pointer', () => {
      // Configure round-robin with unlimited capacity
      db.updateDistributionConfig(
        { mode: 'ROUND_ROBIN', max_workload: null, eligible_telecaller_ids: [] },
        ownerA
      );

      // Import batch of 4 leads
      const batch1 = db.importLeads(
        [
          { name: 'Lead 1', phone: '+91 99000 00001' },
          { name: 'Lead 2', phone: '+91 99000 00002' },
          { name: 'Lead 3', phone: '+91 99000 00003' },
          { name: 'Lead 4', phone: '+91 99000 00004' },
        ],
        ownerA
      );

      const res1 = db.distributeLeads(
        { leadIds: batch1.leads.map((l) => l.id), mode: 'ROUND_ROBIN' },
        ownerA
      );

      expect(res1.success).toBe(true);
      expect(res1.assigned_count).toBe(4);
      expect(res1.unassigned_count).toBe(0);

      // Check persistent index has advanced
      const cfgAfterBatch1 = db.getDistributionConfig(ownerA);
      const cursorAfterBatch1 = cfgAfterBatch1.round_robin_index;
      expect(cursorAfterBatch1).toBeGreaterThanOrEqual(0);

      // Import a second batch of 2 leads
      const batch2 = db.importLeads(
        [
          { name: 'Lead 5', phone: '+91 99000 00005' },
          { name: 'Lead 6', phone: '+91 99000 00006' },
        ],
        ownerA
      );

      const res2 = db.distributeLeads(
        { leadIds: batch2.leads.map((l) => l.id), mode: 'ROUND_ROBIN' },
        ownerA
      );

      expect(res2.success).toBe(true);
      expect(res2.assigned_count).toBe(2);

      // Persistent index continues forward
      const cfgAfterBatch2 = db.getDistributionConfig(ownerA);
      expect(cfgAfterBatch2.round_robin_index).toBeDefined();
    });

    it('skips telecallers at max workload capacity during round-robin', () => {
      const eligible = db.getEligibleTelecallers(ownerA);
      expect(eligible.length).toBeGreaterThanOrEqual(2);

      const targetTc = eligible[0];
      const otherTc = eligible[1];

      // Set max workload to 1 for testing cap
      const currentOpenTarget = db.getOpenLeadCount(targetTc.id, orgAId);
      db.updateDistributionConfig(
        { mode: 'ROUND_ROBIN', max_workload: currentOpenTarget, eligible_telecaller_ids: [targetTc.id, otherTc.id] },
        ownerA
      );

      const batch = db.importLeads(
        [{ name: 'Capped Test Lead', phone: '+91 99000 11111' }],
        ownerA
      );

      const res = db.distributeLeads(
        { leadIds: [batch.leads[0].id], mode: 'ROUND_ROBIN' },
        ownerA
      );

      expect(res.success).toBe(true);
      expect(res.assignments[otherTc.id]).toBe(1);
      expect(res.assignments[targetTc.id] || 0).toBe(0);
    });

    it('overflows to unassigned queue with CAPACITY_REACHED when all telecallers reach max workload', () => {
      // Set cap to 0 so all telecallers are at or above cap
      db.updateDistributionConfig(
        { mode: 'ROUND_ROBIN', max_workload: 1 },
        ownerA
      );

      // Artificially assign leads so telecallers reach cap
      const eligible = db.getEligibleTelecallers(ownerA);
      eligible.forEach((tc) => {
        const dummy = db.importLeads([{ name: `Fill ${tc.id}`, phone: '+91 99000 22222' }], ownerA);
        db.distributeLeads({ leadIds: [dummy.leads[0].id], targetTelecallerId: tc.id }, ownerA);
      });

      // Now attempt to distribute new lead
      const newLeadBatch = db.importLeads([{ name: 'Overflow Lead', phone: '+91 99000 33333' }], ownerA);
      const res = db.distributeLeads(
        { leadIds: [newLeadBatch.leads[0].id], mode: 'ROUND_ROBIN' },
        ownerA
      );

      expect(res.assigned_count).toBe(0);
      expect(res.unassigned_count).toBe(1);
      expect(res.unassigned_reason).toBe('CAPACITY_REACHED');

      const lead = db.getLeads(ownerA).find((l) => l.id === newLeadBatch.leads[0].id);
      expect(lead?.assigned_to).toBeNull();
      expect(lead?.unassigned_reason).toBe('CAPACITY_REACHED');
    });
  });

  // =========================================================================
  // 3. WORKLOAD-BALANCED DISTRIBUTION
  // =========================================================================
  describe('3. Workload-Balanced Lead Distribution', () => {
    it('assigns leads to telecaller with fewest open leads', () => {
      const eligible = db.getEligibleTelecallers(ownerA);
      expect(eligible.length).toBeGreaterThanOrEqual(2);

      const tc1 = eligible[0];
      const tc2 = eligible[1];

      // Restrict pool to tc1 and tc2
      db.updateDistributionConfig(
        { mode: 'WORKLOAD_BALANCED', max_workload: null, eligible_telecaller_ids: [tc1.id, tc2.id] },
        ownerA
      );

      // Give tc1 more open leads than tc2
      const fillLeads = db.importLeads(
        [
          { name: 'Fill 1', phone: '+91 99111 00001' },
          { name: 'Fill 2', phone: '+91 99111 00002' },
          { name: 'Fill 3', phone: '+91 99111 00003' },
        ],
        ownerA
      );
      db.distributeLeads({ leadIds: fillLeads.leads.map((l) => l.id), targetTelecallerId: tc1.id }, ownerA);

      const tc1Open = db.getOpenLeadCount(tc1.id, orgAId);
      const tc2Open = db.getOpenLeadCount(tc2.id, orgAId);
      expect(tc1Open).toBeGreaterThan(tc2Open);

      // Now distribute 1 new lead in WORKLOAD_BALANCED mode
      const testBatch = db.importLeads([{ name: 'Balanced Target', phone: '+91 99111 00004' }], ownerA);
      const res = db.distributeLeads(
        { leadIds: [testBatch.leads[0].id], mode: 'WORKLOAD_BALANCED' },
        ownerA
      );

      expect(res.success).toBe(true);
      // Must be routed to tc2 because tc2 has fewer open leads
      expect(res.assignments[tc2.id]).toBe(1);
      expect(res.assignments[tc1.id] || 0).toBe(0);
    });

    it('closed lead statuses do not count against telecaller active workload', () => {
      const eligible = db.getEligibleTelecallers(ownerA);
      const tc = eligible[0];

      // Add a closed lead
      const closedBatch = db.importLeads([{ name: 'Converted Lead', phone: '+91 99111 00005' }], ownerA);
      db.distributeLeads({ leadIds: [closedBatch.leads[0].id], targetTelecallerId: tc.id }, ownerA);
      db.updateLead(closedBatch.leads[0].id, { status: 'CONVERTED' }, ownerA);

      const openCountAfterClose = db.getOpenLeadCount(tc.id, orgAId);

      // Add another lead and mark as NOT_INTERESTED
      const notIntBatch = db.importLeads([{ name: 'Not Interested Lead', phone: '+91 99111 00006' }], ownerA);
      db.distributeLeads({ leadIds: [notIntBatch.leads[0].id], targetTelecallerId: tc.id }, ownerA);
      db.updateLead(notIntBatch.leads[0].id, { status: 'NOT_INTERESTED' }, ownerA);

      const finalOpenCount = db.getOpenLeadCount(tc.id, orgAId);
      expect(finalOpenCount).toBe(openCountAfterClose);
    });

    it('dynamically balances load within a multi-lead batch', () => {
      const eligible = db.getEligibleTelecallers(ownerA);
      expect(eligible.length).toBeGreaterThanOrEqual(2);

      db.updateDistributionConfig({ mode: 'WORKLOAD_BALANCED', max_workload: null }, ownerA);

      const batch = db.importLeads(
        [
          { name: 'Batch 1', phone: '+91 99222 00001' },
          { name: 'Batch 2', phone: '+91 99222 00002' },
          { name: 'Batch 3', phone: '+91 99222 00003' },
          { name: 'Batch 4', phone: '+91 99222 00004' },
        ],
        ownerA
      );

      const res = db.distributeLeads(
        { leadIds: batch.leads.map((l) => l.id), mode: 'WORKLOAD_BALANCED' },
        ownerA
      );

      expect(res.assigned_count).toBe(4);
      // Workload should be shared across the telecallers
      const assignedTelecallers = Object.keys(res.assignments).filter((id) => res.assignments[id] > 0);
      expect(assignedTelecallers.length).toBeGreaterThanOrEqual(2);
    });
  });

  // =========================================================================
  // 4. UNASSIGNED QUEUE & REASON TRACKING
  // =========================================================================
  describe('4. Unassigned Queue & Reasons', () => {
    it('sets unassigned_reason to EMPTY_TEAM or NO_ELIGIBLE_TELECALLERS when no active agents are available', () => {
      // Exclude all telecallers by setting non-existent eligible ID
      db.updateDistributionConfig(
        { mode: 'ROUND_ROBIN', eligible_telecaller_ids: [] },
        ownerA
      );

      // Mark all telecallers disabled
      const activeTc = db.getEligibleTelecallers(ownerA);
      activeTc.forEach((tc) => {
        db.updateProfileStatus(tc.id, 'DISABLED', ownerA);
      });

      const batch = db.importLeads([{ name: 'No Agent Lead', phone: '+91 99333 00001' }], ownerA);
      const res = db.distributeLeads(
        { leadIds: [batch.leads[0].id], mode: 'ROUND_ROBIN' },
        ownerA
      );

      expect(res.success).toBe(false);
      expect(res.assigned_count).toBe(0);
      expect(res.unassigned_count).toBe(1);
      expect(res.unassigned_reason).toBe('NO_ELIGIBLE_TELECALLERS');

      const lead = db.getLeads(ownerA).find((l) => l.id === batch.leads[0].id);
      expect(lead?.assigned_to).toBeNull();
      expect(lead?.unassigned_reason).toBe('NO_ELIGIBLE_TELECALLERS');

      // Verify activity log contains ASSIGNMENT_FAILED
      const logs = db.getActivityLogs(ownerA);
      const failLog = logs.find((l) => l.action === 'ASSIGNMENT_FAILED');
      expect(failLog).toBeDefined();
    });

    it('sets unassigned_reason to MANUAL_UNASSIGNED when in MANUAL mode without target caller', () => {
      const batch = db.importLeads([{ name: 'Manual Lead', phone: '+91 99333 00002' }], ownerA);
      const res = db.distributeLeads(
        { leadIds: [batch.leads[0].id], mode: 'MANUAL' },
        ownerA
      );

      expect(res.assigned_count).toBe(0);
      expect(res.unassigned_count).toBe(1);
      expect(res.unassigned_reason).toBe('MANUAL_UNASSIGNED');

      const lead = db.getLeads(ownerA).find((l) => l.id === batch.leads[0].id);
      expect(lead?.unassigned_reason).toBe('MANUAL_UNASSIGNED');
    });

    it('provides accurate distribution preview without mutating state', () => {
      db.updateDistributionConfig({ enabled_for_import: false }, ownerA);
      const batch = db.importLeads(
        [
          { name: 'Preview 1', phone: '+91 99444 00001' },
          { name: 'Preview 2', phone: '+91 99444 00002' },
        ],
        ownerA
      );

      const preview = db.previewDistribution(
        batch.leads.map((l) => l.id),
        'ROUND_ROBIN',
        ownerA
      );

      expect(preview.mode).toBe('ROUND_ROBIN');
      expect(preview.total_leads).toBe(2);
      expect(preview.assignable_count).toBe(2);
      expect(preview.telecaller_breakdown.length).toBeGreaterThan(0);

      // Verify leads were not actually assigned by preview
      const lead1 = db.getLeads(ownerA).find((l) => l.id === batch.leads[0].id);
      expect(lead1?.assigned_to).toBeNull();
    });
  });

  // =========================================================================
  // 5. MANUAL REASSIGNMENT WITH MANDATORY REASON
  // =========================================================================
  describe('5. Manual Reassignment with Mandatory Reason', () => {
    it('successfully reassigns lead to a new telecaller with mandatory reason and updates audit trail', () => {
      const batch = db.importLeads([{ name: 'Reassign Candidate', phone: '+91 99555 00001' }], ownerA);
      const leadId = batch.leads[0].id;

      // Initial assignment to telecallerA1
      db.distributeLeads({ leadIds: [leadId], targetTelecallerId: telecallerA1.id }, ownerA);

      const reason = 'Telecaller on medical leave; shifting queue to Rahul';
      const reassignedLead = db.reassignLead(leadId, telecallerA2.id, reason, ownerA);

      expect(reassignedLead.assigned_to).toBe(telecallerA2.id);
      expect(reassignedLead.reassign_reason).toBe(reason);
      expect(reassignedLead.reassigned_at).toBeDefined();

      // Check assignment history
      const assignments = db.getLeadAssignments(ownerA);
      const newAsgn = assignments.find((a) => a.lead_id === leadId && a.user_id === telecallerA2.id);
      expect(newAsgn).toBeDefined();
      expect(newAsgn?.previous_user_id).toBe(telecallerA1.id);
      expect(newAsgn?.reassign_reason).toBe(reason);

      // Check activity log
      const logs = db.getActivityLogs(ownerA);
      const reassignLog = logs.find((l) => l.action === 'LEAD_REASSIGNED');
      expect(reassignLog).toBeDefined();
      expect(reassignLog?.metadata?.reason).toBe(reason);
      expect(reassignLog?.metadata?.previousUserId).toBe(telecallerA1.id);
      expect(reassignLog?.metadata?.newUserId).toBe(telecallerA2.id);
    });

    it('rejects reassignment when reason is empty or whitespace', () => {
      const batch = db.importLeads([{ name: 'Reason Test Lead', phone: '+91 99555 00002' }], ownerA);
      const leadId = batch.leads[0].id;
      db.distributeLeads({ leadIds: [leadId], targetTelecallerId: telecallerA1.id }, ownerA);

      expect(() => db.reassignLead(leadId, telecallerA2.id, '', ownerA)).toThrow(
        /Reassignment reason is mandatory/i
      );

      expect(() => db.reassignLead(leadId, telecallerA2.id, '   ', ownerA)).toThrow(
        /Reassignment reason is mandatory/i
      );
    });

    it('rejects reassignment to the telecaller already assigned to the lead', () => {
      const batch = db.importLeads([{ name: 'Same Assignee Lead', phone: '+91 99555 00003' }], ownerA);
      const leadId = batch.leads[0].id;
      db.distributeLeads({ leadIds: [leadId], targetTelecallerId: telecallerA1.id }, ownerA);

      expect(() =>
        db.reassignLead(leadId, telecallerA1.id, 'Redistribution attempt', ownerA)
      ).toThrow(/already assigned/i);
    });

    it('rejects reassignment if target telecaller is at max workload capacity', () => {
      const batch = db.importLeads([{ name: 'Cap Reassign Lead', phone: '+91 99555 00004' }], ownerA);
      const leadId = batch.leads[0].id;
      db.distributeLeads({ leadIds: [leadId], targetTelecallerId: telecallerA1.id }, ownerA);

      const a2Open = db.getOpenLeadCount(telecallerA2.id, orgAId);
      db.updateDistributionConfig({ max_workload: a2Open }, ownerA);

      expect(() =>
        db.reassignLead(leadId, telecallerA2.id, 'Valid reason', ownerA)
      ).toThrow(/maximum capacity/i);
    });
  });

  // =========================================================================
  // 6. ROLE-BASED ACCESS CONTROL & CROSS-TENANT SECURITY
  // =========================================================================
  describe('6. Role-Based Access Control & Cross-Tenant Security', () => {
    it('strictly forbids telecallers from distributing or reassigning leads', () => {
      const batch = db.importLeads([{ name: 'RBAC Lead', phone: '+91 99666 00001' }], ownerA);
      const leadId = batch.leads[0].id;

      expect(() =>
        db.distributeLeads({ leadIds: [leadId], mode: 'ROUND_ROBIN' }, telecallerA1)
      ).toThrow(/Forbidden/i);

      expect(() =>
        db.reassignLead(leadId, telecallerA2.id, 'Malicious reassignment', telecallerA1)
      ).toThrow(/Forbidden/i);

      // Verify security event logged
      const secEvents = db.getSecurityEvents(ownerA);
      const unauthorizedDist = secEvents.find(
        (e) => e.event_type === 'UNAUTHORIZED_DISTRIBUTION_ATTEMPT'
      );
      expect(unauthorizedDist).toBeDefined();
    });

    it('blocks cross-tenant distribution attempts and records security event', () => {
      // Lead belonging to Org A
      const batchA = db.importLeads([{ name: 'Org A Lead', phone: '+91 99666 00002' }], ownerA);
      const leadAId = batchA.leads[0].id;

      // Owner B attempts to distribute Org A lead
      expect(() =>
        db.distributeLeads({ leadIds: [leadAId], mode: 'ROUND_ROBIN' }, ownerB)
      ).toThrow(/Forbidden/i);

      const secEvents = db.getSecurityEvents(ownerB);
      const crossTenant = secEvents.find(
        (e) => e.event_type === 'CROSS_TENANT_ASSIGNMENT_ATTEMPT'
      );
      expect(crossTenant).toBeDefined();
    });

    it('preserves zero-phone-exposure invariant across distribution results and audit logs', () => {
      const batch = db.importLeads([{ name: 'Sanitization Lead', phone: '+91 98450 12345' }], ownerA);
      const res = db.distributeLeads(
        { leadIds: [batch.leads[0].id], targetTelecallerId: telecallerA1.id },
        ownerA
      );

      // Distribution result must not leak raw phone numbers
      const resJson = JSON.stringify(res);
      expect(resJson).not.toContain('+91 98450 12345');

      // Telecaller reading assignments must not see other telecallers' assignments
      const telecallerAsgns = db.getLeadAssignments(telecallerA1);
      telecallerAsgns.forEach((asgn) => {
        expect(asgn.user_id).toBe(telecallerA1.id);
      });
    });
  });

  // =========================================================================
  // 7. CSV IMPORT AUTO-DISTRIBUTION INTEGRATION
  // =========================================================================
  describe('7. CSV Import Auto-Distribution Integration', () => {
    it('automatically distributes imported leads when enabled_for_import is true', () => {
      db.updateDistributionConfig(
        {
          mode: 'ROUND_ROBIN',
          enabled_for_import: true,
          max_workload: null,
        },
        ownerA
      );

      const result = db.importLeads(
        [
          { name: 'Import Auto 1', phone: '+91 99777 00001' },
          { name: 'Import Auto 2', phone: '+91 99777 00002' },
        ],
        ownerA
      );

      expect(result.distribution).toBeDefined();
      expect(result.distribution?.assigned_count).toBe(2);

      // Check leads in database are assigned
      const leads = db.getLeads(ownerA);
      const imported1 = leads.find((l) => l.name === 'Import Auto 1');
      const imported2 = leads.find((l) => l.name === 'Import Auto 2');

      expect(imported1?.assigned_to).not.toBeNull();
      expect(imported2?.assigned_to).not.toBeNull();
      expect(imported1?.status).toBe('ASSIGNED');
    });

    it('keeps imported leads unassigned with MANUAL_UNASSIGNED when enabled_for_import is false', () => {
      db.updateDistributionConfig(
        {
          mode: 'ROUND_ROBIN',
          enabled_for_import: false,
        },
        ownerA
      );

      const result = db.importLeads(
        [{ name: 'Import Manual 1', phone: '+91 99777 00003' }],
        ownerA
      );

      expect(result.distribution).toBeNull();
      const lead = db.getLeads(ownerA).find((l) => l.name === 'Import Manual 1');
      expect(lead?.assigned_to).toBeNull();
      expect(lead?.unassigned_reason).toBe('MANUAL_UNASSIGNED');
    });
  });

  // =========================================================================
  // 8. SERVER ENDPOINTS (/api/leads/distribution-config & /api/leads/distribute)
  // =========================================================================
  describe('8. Server API Endpoints Verification', () => {
    it('/api/leads/distribution-config allows Owner GET and POST, forbids Telecaller with 403', async () => {
      const ownerToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: orgAId,
        role: 'OWNER',
        email: ownerA.email || 'vikram@vertex.com',
        fullName: ownerA.full_name,
        status: 'ACTIVE',
      });

      // Owner GET
      const { req: getReq, res: getRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      await distributionConfigHandler(getReq, getRes);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.config).toBeDefined();

      // Owner POST
      const { req: postReq, res: postRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: { mode: 'WORKLOAD_BALANCED', max_workload: 40 },
      });
      await distributionConfigHandler(postReq, postRes);
      expect(postRes.statusCode).toBe(200);
      expect(postRes.body.config.mode).toBe('WORKLOAD_BALANCED');
      expect(postRes.body.config.max_workload).toBe(40);

      // Telecaller GET -> 403 Forbidden
      const tcToken = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: orgAId,
        role: 'TELECALLER',
        email: telecallerA1.email || 'arjun@vertex.com',
        fullName: telecallerA1.full_name,
        status: 'ACTIVE',
      });
      const { req: tcReq, res: tcRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${tcToken}` },
      });
      await distributionConfigHandler(tcReq, tcRes);
      expect(tcRes.statusCode).toBe(403);
    });

    it('/api/leads/distribute handles preview GET, distribution POST, and reassignment', async () => {
      const ownerToken = createSignedSessionToken({
        userId: ownerA.user_id,
        profileId: ownerA.id,
        organizationId: orgAId,
        role: 'OWNER',
        email: ownerA.email || 'vikram@vertex.com',
        fullName: ownerA.full_name,
        status: 'ACTIVE',
      });

      // Ensure import doesn't auto-distribute
      db.updateDistributionConfig({ enabled_for_import: false }, ownerA);
      const batch = db.importLeads([{ name: 'API Lead 1', phone: '+91 99888 00001' }], ownerA);
      const leadId = batch.leads[0].id;

      // GET preview
      const { req: prevReq, res: prevRes } = createMockReqRes({
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
        query: { leadIds: leadId, mode: 'WORKLOAD_BALANCED' },
      });
      await distributeHandler(prevReq, prevRes);
      expect(prevRes.statusCode).toBe(200);
      expect(prevRes.body.preview.total_leads).toBe(1);

      // POST batch distribute
      const { req: distReq, res: distRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: { leadIds: [leadId], targetTelecallerId: telecallerA1.id },
      });
      await distributeHandler(distReq, distRes);
      expect(distRes.statusCode).toBe(200);
      expect(distRes.body.result.assigned_count).toBe(1);

      // POST reassignment without reason -> 400 Bad Request
      const { req: failReassignReq, res: failReassignRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: { leadId, targetTelecallerId: telecallerA2.id, isReassignment: true, reason: '' },
      });
      await distributeHandler(failReassignReq, failReassignRes);
      expect(failReassignRes.statusCode).toBe(400);

      // POST valid reassignment
      const { req: okReassignReq, res: okReassignRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: {
          leadId,
          targetTelecallerId: telecallerA2.id,
          isReassignment: true,
          reason: 'Valid operational reason',
        },
      });
      await distributeHandler(okReassignReq, okReassignRes);
      expect(okReassignRes.statusCode).toBe(200);
      expect(okReassignRes.body.reassigned).toBe(true);
      expect(okReassignRes.body.lead.phone).toBeUndefined(); // Zero phone exposure invariant
    });

    it('/api/leads/distribute rejects telecallers with 403 Forbidden', async () => {
      const tcToken = createSignedSessionToken({
        userId: telecallerA1.user_id,
        profileId: telecallerA1.id,
        organizationId: orgAId,
        role: 'TELECALLER',
        email: telecallerA1.email || 'arjun@vertex.com',
        fullName: telecallerA1.full_name,
        status: 'ACTIVE',
      });

      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${tcToken}` },
        body: { leadIds: ['dummy-lead'], mode: 'ROUND_ROBIN' },
      });
      await distributeHandler(req, res);
      expect(res.statusCode).toBe(403);
    });
  });
});
