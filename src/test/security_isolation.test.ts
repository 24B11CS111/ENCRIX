import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';
import { maskPhoneNumber, maskName, maskEmail } from '@/lib/dataMasking';

describe('LEADVAULT Security & Multi-Tenant Data Isolation (RLS)', () => {
  const adminProfile: Profile = {
    id: 'prof-admin-000',
    user_id: 'user-admin-000',
    organization_id: 'org-vertex-001',
    full_name: 'Super Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

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

  const primeOwner: Profile = {
    id: 'prof-owner-002',
    user_id: 'user-owner-002',
    organization_id: 'org-prime-002',
    full_name: 'Rohan Verma',
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

  const telecallerRahul: Profile = {
    id: 'tc-rahul-02',
    user_id: 'user-tc-02',
    organization_id: 'org-vertex-001',
    full_name: 'Rahul Sharma',
    role: 'TELECALLER',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    db.resetSandbox();
  });

  it('CRITICAL: Organization A (Vertex) NEVER sees Organization B (Prime) leads', () => {
    const vertexLeads = db.getLeads(vertexOwner);
    const primeLeads = db.getLeads(primeOwner);

    expect(vertexLeads.length).toBeGreaterThan(0);
    expect(primeLeads.length).toBeGreaterThan(0);

    // Verify all vertex leads belong exclusively to org-vertex-001
    vertexLeads.forEach((l) => {
      expect(l.organization_id).toBe('org-vertex-001');
      expect(l.organization_id).not.toBe('org-prime-002');
    });

    // Verify all prime leads belong exclusively to org-prime-002
    primeLeads.forEach((l) => {
      expect(l.organization_id).toBe('org-prime-002');
      expect(l.organization_id).not.toBe('org-vertex-001');
    });
  });

  it('CRITICAL: Telecaller Arjun cannot see unassigned leads or leads assigned to Telecaller Rahul', () => {
    const arjunLeads = db.getLeads(telecallerArjun);

    expect(arjunLeads.length).toBeGreaterThan(0);

    // Every lead returned to Arjun must be assigned exclusively to Arjun
    arjunLeads.forEach((lead) => {
      expect(lead.assigned_to).toBe(telecallerArjun.id);
      expect(lead.assigned_to).not.toBe(telecallerRahul.id);
    });
  });

  it('CRITICAL: Direct lead query throws Forbidden if Telecaller accesses another caller lead', () => {
    const rahulLeads = db.getLeads(telecallerRahul);
    expect(rahulLeads.length).toBeGreaterThan(0);
    const targetLeadId = rahulLeads[0].id;

    // Arjun tries to query Rahul's lead directly
    expect(() => {
      db.getLeadById(targetLeadId, telecallerArjun);
    }).toThrow(/Forbidden/);
  });

  it('ZERO PHONE INVARIANT: Telecallers receive no phone digits and omitted phone property', () => {
    const arjunLeads = db.getLeads(telecallerArjun);
    expect(arjunLeads.length).toBeGreaterThan(0);

    const firstLead = arjunLeads[0];

    // Phone must be completely undefined and omitted
    expect(firstLead.phone).toBeUndefined();
    expect('phone' in firstLead).toBe(false);

    // Name must be formatted with initial, e.g. "Rahul K."
    if (firstLead.name.includes(' ')) {
      expect(firstLead.name).toMatch(/^[A-Za-z]+\s[A-Z]\.$/);
    }
  });

  it('DATA MASKING UNIT: maskPhoneNumber and maskName work precisely', () => {
    expect(maskPhoneNumber('+91 9876543210')).toBe('+91 ******3210');
    expect(maskName('Rahul Kumar')).toBe('Rahul K.');
    expect(maskName('Priya Sharma Patel')).toBe('Priya S.');
    expect(maskEmail('rahul.kumar@example.com')).toBe('r***r@example.com');
  });

  it('SECURITY MONITORING: Security events are recorded and access denied for telecaller', () => {
    // Telecaller is blocked from accessing security audit stream
    expect(() => {
      db.getSecurityEvents(telecallerArjun);
    }).toThrow(/Forbidden/);

    // Owner can access security stream
    const ownerEvents = db.getSecurityEvents(vertexOwner);
    expect(ownerEvents).toBeDefined();
    expect(Array.isArray(ownerEvents)).toBe(true);
  });
});
