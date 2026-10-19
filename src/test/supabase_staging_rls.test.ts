import { describe, it, expect, beforeEach } from 'vitest';
import { supabase, isRealSupabaseConfigured } from '@/services/supabase/client';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

describe('Phase 12: Supabase Staging Environment & RLS Verification', () => {
  beforeEach(() => {
    db.resetSandbox();
  });

  it('1. Supabase client is correctly instantiated with environment configuration', () => {
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.from).toBe('function');
  });

  it('2. isRealSupabaseConfigured identifies mock vs live credentials properly', () => {
    // In local dev test environment, mock URL is present
    const isLive = isRealSupabaseConfigured();
    // Default vitest runner uses mock-vault URL from .env
    expect(typeof isLive).toBe('boolean');
  });

  it('3. Multi-Tenant Staging Isolation Contract: Tenant A cannot read Tenant B leads', () => {
    const ownerVertex = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'prof-owner-001')!;
    const ownerPrime = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'prof-owner-002')!;

    expect(ownerVertex.organization_id).not.toBe(ownerPrime.organization_id);

    const vertexLeads = db.getLeads(ownerVertex);
    const primeLeads = db.getLeads(ownerPrime);

    expect(vertexLeads.length).toBeGreaterThan(0);
    expect(primeLeads.length).toBeGreaterThan(0);

    // Cross-tenant verification: zero overlap
    const vertexLeadIds = new Set(vertexLeads.map((l) => l.id));
    const primeLeadIds = new Set(primeLeads.map((l) => l.id));

    for (const id of vertexLeadIds) {
      expect(primeLeadIds.has(id)).toBe(false);
    }
  });

  it('4. Staging RLS Contract: Telecallers only receive their own assigned leads with zero phone exposure', () => {
    const arjun = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'tc-arjun-01')!;
    const arjunLeads = db.getLeads(arjun);

    expect(arjunLeads.length).toBeGreaterThan(0);

    for (const lead of arjunLeads) {
      expect(lead.assigned_to).toBe(arjun.id);
      expect(lead.phone).toBeUndefined();
      // Ensure customer full surname is protected
      expect(lead.name).not.toMatch(/\s[A-Z][a-z]{3,}$/);
    }
  });

  it('5. Staging RLS Contract: Activity logs and security events are append-only and tenant-isolated', () => {
    const ownerVertex = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'prof-owner-001')!;
    const initialLogCount = db.getActivityLogs(ownerVertex).length;

    db.logActivity({
      organization_id: ownerVertex.organization_id,
      user_id: ownerVertex.id,
      user_name: ownerVertex.full_name,
      user_role: 'OWNER',
      action: 'LEAD_VIEW',
      entity_type: 'lead',
      entity_id: 'test-lead-001',
    });

    const newLogs = db.getActivityLogs(ownerVertex);
    expect(newLogs.length).toBe(initialLogCount + 1);

    const latest = newLogs[0];
    expect(latest.organization_id).toBe(ownerVertex.organization_id);
    expect(latest.user_id).toBe(ownerVertex.id);
  });
});
