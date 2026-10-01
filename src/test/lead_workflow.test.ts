import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

describe('LEADVAULT Lead Creation, Import & Round-Robin Assignment', () => {
  const vertexOwner: Profile = {
    id: 'prof-owner-001',
    user_id: 'user-owner-001',
    organization_id: 'org-vertex-001',
    full_name: 'Vikram Malhotra',
    role: 'OWNER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerArjun: Profile = {
    id: 'tc-arjun-01',
    user_id: 'user-tc-01',
    organization_id: 'org-vertex-001',
    full_name: 'Arjun Kumar',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    db.resetSandbox();
  });

  it('Owner creates single lead successfully with auto-generated lead_code', () => {
    const created = db.createLead(
      {
        name: 'Siddharth Rao',
        phone: '+91 9888877777',
        email: 'siddharth@example.com',
        source: 'Google Ads',
        priority: 'HIGH',
        status: 'NEW',
        notes: 'Inquiry for Canadian PR',
      },
      vertexOwner
    );

    expect(created.id).toBeDefined();
    expect(created.lead_code).toMatch(/^LV-\d+/);
    expect(created.organization_id).toBe('org-vertex-001');
    expect(created.status).toBe('NEW');
  });

  it('Batch import ingests multiple leads into PostgreSQL state', () => {
    const batch = [
      { name: 'Import User 1', phone: '+91 9900000001', email: 'u1@example.com', source: 'Meta' },
      { name: 'Import User 2', phone: '+91 9900000002', email: 'u2@example.com', source: 'Webinar' },
      { name: 'Import User 3', phone: '+91 9900000003', email: 'u3@example.com', source: 'Direct' },
    ];

    const result = db.importLeads(batch, vertexOwner);
    expect(result.imported).toBe(3);
    expect(result.leads.length).toBe(3);

    const leads = db.getLeads(vertexOwner);
    expect(leads.some((l) => l.name === 'Import User 1')).toBe(true);
  });

  it('Manual Lead Assignment updates assigned_to and status to ASSIGNED', () => {
    // 1. Create a fresh unassigned lead
    const newLead = db.createLead(
      {
        name: 'Unassigned Test Lead',
        phone: '+91 9800012399',
        source: 'Direct',
        priority: 'MEDIUM',
        status: 'NEW',
      },
      vertexOwner
    );

    expect(newLead.assigned_to).toBeFalsy();

    // 2. Assign to Arjun
    const updatedCount = db.assignLeads([newLead.id], telecallerArjun.id, vertexOwner);
    expect(updatedCount).toBe(1);

    // 3. Verify in database
    const fetched = db.getLeadById(newLead.id, vertexOwner);
    expect(fetched.assigned_to).toBe(telecallerArjun.id);
    expect(fetched.status).toBe('ASSIGNED');
  });

  it('Round-Robin distributes leads evenly across active telecaller pool', () => {
    // 1. Create 6 unassigned leads
    const createdIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const l = db.createLead(
        {
          name: `Round Robin Lead ${i}`,
          phone: `+91 981110000${i}`,
          source: 'Bulk Import',
          priority: 'MEDIUM',
          status: 'NEW',
        },
        vertexOwner
      );
      createdIds.push(l.id);
    }

    const telecallers = ['tc-arjun-01', 'tc-rahul-02', 'tc-priya-03'];

    // 2. Run round-robin distribution
    const distribution = db.assignRoundRobin(createdIds, telecallers, vertexOwner);

    // 6 leads across 3 telecallers should equal 2 leads each
    expect(distribution['tc-arjun-01']).toBe(2);
    expect(distribution['tc-rahul-02']).toBe(2);
    expect(distribution['tc-priya-03']).toBe(2);

    // 3. Verify leads are updated
    createdIds.forEach((id) => {
      const lead = db.getLeadById(id, vertexOwner);
      expect(lead.status).toBe('ASSIGNED');
      expect(telecallers).toContain(lead.assigned_to);
    });
  });
});
