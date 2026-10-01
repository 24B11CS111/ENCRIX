import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

describe('LEADVAULT Real-Time State Synchronization', () => {
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

  it('Owner dashboard receives real-time event when telecaller marks lead POSITIVE', () => {
    const listener = vi.fn();
    const unsubscribe = db.subscribe(listener);

    const arjunLeads = db.getLeads(telecallerArjun);
    const target = arjunLeads[0];

    const call = db.recordCall(
      { lead_id: target.id, duration_seconds: 120, status: 'COMPLETED' },
      telecallerArjun
    );

    db.recordCallOutcome(
      {
        call_id: call.id,
        lead_id: target.id,
        outcome: 'POSITIVE',
        interest_level: 'HIGH',
        notes: 'Candidate interested',
      },
      telecallerArjun
    );

    expect(listener).toHaveBeenCalled();
    const eventTypes = listener.mock.calls.map((c) => c[0].type);
    expect(eventTypes).toContain('CALL_RECORDED');
    expect(eventTypes).toContain('CALL_OUTCOME_SAVED');

    unsubscribe();
  });

  it('Telecaller receives real-time notification when owner assigns new leads', () => {
    const listener = vi.fn();
    const unsubscribe = db.subscribe(listener);

    const newLead = db.createLead(
      {
        name: 'Realtime Candidate',
        phone: '+91 9888800001',
        source: 'Website',
        priority: 'HIGH',
        status: 'NEW',
      },
      vertexOwner
    );

    db.assignLeads([newLead.id], telecallerArjun.id, vertexOwner);

    expect(listener).toHaveBeenCalled();
    const eventTypes = listener.mock.calls.map((c) => c[0].type);
    expect(eventTypes).toContain('LEADS_ASSIGNED');
    expect(eventTypes).toContain('NEW_NOTIFICATION');

    unsubscribe();
  });
});
