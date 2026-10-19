import { describe, it, expect, beforeEach } from 'vitest';
import { telephonyService } from '@/services/telephony';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

describe('LEADVAULT Telephony Calling & Outcome Workflow', () => {
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

  beforeEach(() => {
    db.resetSandbox();
  });

  it('Telephony Provider initiates, mutes, and ends call session with recording', async () => {
    const session = await telephonyService.initiateCall({
      leadId: 'lead-lv-10294',
      telecallerId: telecallerArjun.id,
      phoneNumber: '+91 9876543210',
    });

    expect(session.callId).toBeDefined();
    expect(session.status).toBe('INITIATED');
    expect(session.maskedPhoneNumber).toBeUndefined();
    expect(session.phoneNumber).toBeUndefined();

    // Test mute toggle
    const muted = await telephonyService.toggleMute(session.callId, true);
    expect(muted).toBe(true);

    // End call
    const result = await telephonyService.endCall(session.callId);
    expect(result.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(result.recordingUrl).toContain('.mp3');
  });

  it('POSITIVE outcome updates lead status to INTERESTED and schedules follow-up', () => {
    const arjunLeads = db.getLeads(telecallerArjun);
    expect(arjunLeads.length).toBeGreaterThan(0);
    const targetLead = arjunLeads[0];

    // Record call
    const call = db.recordCall(
      {
        lead_id: targetLead.id,
        duration_seconds: 145,
        status: 'COMPLETED',
      },
      telecallerArjun
    );

    expect(call.id).toBeDefined();
    expect(call.duration_seconds).toBe(145);

    // Record Positive outcome
    const outcome = db.recordCallOutcome(
      {
        call_id: call.id,
        lead_id: targetLead.id,
        outcome: 'POSITIVE',
        interest_level: 'HIGH',
        requirement: 'Master in Artificial Intelligence in Germany',
        notes: 'Enthusiastic candidate, budget 25 LPA confirmed.',
        followUpDate: '2026-10-15',
        followUpTime: '14:30',
      },
      telecallerArjun
    );

    expect(outcome.outcome).toBe('POSITIVE');

    // Check lead status updated in database
    const updatedLead = db.getLeadById(targetLead.id, vertexOwner);
    expect(updatedLead.status).toBe('INTERESTED');

    // Verify follow-up was created
    const followUps = db.getFollowUps(vertexOwner);
    expect(followUps.some((f) => f.lead_id === targetLead.id)).toBe(true);

    // Verify Owner received a notification
    const notifications = db.getNotifications(vertexOwner);
    expect(notifications.some((n) => n.type === 'CALL_OUTCOME')).toBe(true);
  });

  it('NEGATIVE outcome updates lead status to NOT_INTERESTED', () => {
    const arjunLeads = db.getLeads(telecallerArjun);
    const targetLead = arjunLeads[1];

    const call = db.recordCall(
      {
        lead_id: targetLead.id,
        duration_seconds: 40,
        status: 'COMPLETED',
      },
      telecallerArjun
    );

    db.recordCallOutcome(
      {
        call_id: call.id,
        lead_id: targetLead.id,
        outcome: 'NEGATIVE',
        reason: 'Price',
        notes: 'Candidate said fee exceeds family budget.',
      },
      telecallerArjun
    );

    const updatedLead = db.getLeadById(targetLead.id, vertexOwner);
    expect(updatedLead.status).toBe('NOT_INTERESTED');
  });
});
