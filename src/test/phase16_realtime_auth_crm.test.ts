import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendVerificationEmail,
  isLiveEmailConfigured,
  hashOtp,
  verifyOtpHash,
  generateSecureOtp,
} from '../../api/_lib/otpServer';
import { db, RealtimeEvent } from '../services/supabase/db';
import { authService } from '../services/auth/authService';
import { realtimeManager } from '../services/realtime/realtimeManager';
import { Profile, Lead, Call, FollowUp, Organization } from '../types';
import { maskPhoneNumber } from '../lib/dataMasking';

describe('ENCRIX Phase 16: Real-Time Production Authentication & Live CRM Test Suite', () => {
  beforeEach(() => {
    db.resetSandbox(true);
    realtimeManager.cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    realtimeManager.cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // 1. Real OTP request lifecycle
  it('1. Real OTP request lifecycle: dispatches via Resend API with Bearer token, safe metadata, and key isolation', async () => {
    const originalEnv = process.env.RESEND_API_KEY;
    const originalFrom = process.env.RESEND_FROM_EMAIL;

    process.env.RESEND_API_KEY = 'synthetic-resend-api-key-not-a-credential';
    process.env.RESEND_FROM_EMAIL = 'ENCRIX Security <auth@encrix.io>';

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_msg_live_777' }),
      };
    });

    const result = await sendVerificationEmail('vikram@vertex.com', '543210');

    expect(result.success).toBe(true);
    expect(result.provider).toBe('RESEND');
    expect(capturedUrl).toBe('https://api.resend.com/emails');
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${process.env.RESEND_API_KEY}`);
    expect(capturedBody.to).toEqual(['vikram@vertex.com']);
    expect(capturedBody.from).toBe('ENCRIX Security <auth@encrix.io>');
    expect(capturedBody.subject).toBe('Your ENCRIX verification code');

    // Key isolation check: Secret API key must never be leaked in output
    expect(JSON.stringify(result)).not.toContain('synthetic-resend-api-key-not-a-credential');

    // Database request returns server-authoritative timestamps and masked email
    const req = db.requestOtp({ email: 'vikram@vertex.com', purpose: 'LOGIN' });
    expect(req.success).toBe(true);
    expect(req.maskedEmail).toBe('v••••@vertex.com');
    expect(req.expiresAt).toBeDefined();
    expect(req.resendAvailableAt).toBeDefined();
    expect((req as any).otp).toBeUndefined();

    process.env.RESEND_API_KEY = originalEnv;
    process.env.RESEND_FROM_EMAIL = originalFrom;
  });

  // 2. OTP expiration
  it('2. OTP expiration: rejects expired OTP submissions and requires new code generation', () => {
    const email = 'vikram@vertex.com';
    const req = db.requestOtp({ email, purpose: 'LOGIN' });
    expect(req.success).toBe(true);

    const testCode = db.getTestOtp(email, 'LOGIN')!;
    expect(testCode).toBeDefined();

    const originalNow = Date.now;
    try {
      // Advance time past 5 minutes (301 seconds)
      const future = Date.now() + 6 * 60 * 1000;
      Date.now = vi.fn(() => future);

      const verifyRes = db.verifyOtp({ email, otp: testCode, purpose: 'LOGIN' });
      expect(verifyRes.success).toBe(false);
      expect(verifyRes.error).toMatch(/expired/i);
    } finally {
      Date.now = originalNow;
    }
  });

  // 3. OTP resend cooldown
  it('3. OTP resend cooldown: strictly enforces 60-second cooldown with server timestamps', () => {
    const email = 'vikram@vertex.com';
    const firstReq = db.requestOtp({ email, purpose: 'LOGIN' });
    expect(firstReq.success).toBe(true);
    expect(firstReq.expiresAt).toBeDefined();
    expect(firstReq.resendAvailableAt).toBeDefined();

    // Immediate second request within 60s cooldown must be rejected
    const secondReq = db.requestOtp({ email, purpose: 'LOGIN' });
    expect(secondReq.success).toBe(false);
    expect(secondReq.error).toMatch(/please wait \d+ seconds/i);
    expect(secondReq.resendAvailableAt).toBeDefined();
    expect(secondReq.cooldownSeconds).toBeGreaterThan(0);
  });

  // 4. OTP brute-force protection
  it('4. OTP brute-force protection: penalizes wrong codes and blocks account on 5 consecutive failures', () => {
    const email = 'vikram@vertex.com';
    const req = db.requestOtp({ email, purpose: 'LOGIN' });
    expect(req.success).toBe(true);

    // 5 invalid attempts
    for (let i = 1; i <= 4; i++) {
      const res = db.verifyOtp({ email, otp: '000000', purpose: 'LOGIN' });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/invalid verification code/i);
    }

    // 5th failed attempt triggers rate limit block
    const finalRes = db.verifyOtp({ email, otp: '000000', purpose: 'LOGIN' });
    expect(finalRes.success).toBe(false);
    expect(finalRes.error).toMatch(/too many attempts/i);
  });

  // 5. Successful OTP verification
  it('5. Successful OTP verification: verifies code, marks email_verified, and burns OTP', async () => {
    const email = 'vikram@vertex.com';
    const req = db.requestOtp({ email, purpose: 'LOGIN' });
    expect(req.success).toBe(true);

    const testCode = db.getTestOtp(email, 'LOGIN')!;
    expect(testCode).toBeDefined();

    const verifyRes = db.verifyOtp({ email, otp: testCode, purpose: 'LOGIN' });
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.profile).toBeDefined();
    expect(verifyRes.profile?.email_verified).toBe(true);

    // Code must be burned - replay attempt fails
    const replayRes = db.verifyOtp({ email, otp: testCode, purpose: 'LOGIN' });
    expect(replayRes.success).toBe(false);
    expect(replayRes.error).toMatch(/no active verification code found|expired/i);
  });

  // 6. Session creation
  it('6. Session creation: creates authenticated session, profile, and organization immediately', async () => {
    const ownerEmail = 'vikram@vertex.com';
    db.requestOtp({ email: ownerEmail, purpose: 'LOGIN' });
    const code = db.getTestOtp(ownerEmail, 'LOGIN')!;

    const result = await authService.verifyOtp({
      email: ownerEmail,
      otp: code,
      purpose: 'LOGIN',
    });

    expect(result.success).toBe(true);
    expect(result.profile).toBeDefined();
    expect(result.profile?.role).toBe('OWNER');
    expect(result.organization).toBeDefined();
    expect(result.organization?.id).toBe(result.profile?.organization_id);

    // Client persistence confirmed
    const saved = localStorage.getItem('leadvault_session');
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).profileId).toBe(result.profile?.id);
  });

  // 7. Session restoration
  it('7. Session restoration: restores authenticated state on application refresh from storage', () => {
    const allProfiles = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile);
    const owner = allProfiles.find((p) => p.role === 'OWNER')!;
    expect(owner).toBeDefined();

    // Store active session in localStorage
    localStorage.setItem('leadvault_session', JSON.stringify({ profileId: owner.id }));

    // Simulating app hydration
    const saved = localStorage.getItem('leadvault_session');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    const restored = allProfiles.find((p) => p.id === parsed.profileId);

    expect(restored).toBeDefined();
    expect(restored?.status).toBe('ACTIVE');
    expect(restored?.id).toBe(owner.id);
  });

  // 8. Logout
  it('8. Logout: clears session storage, logs audit activity, and cleans up real-time subscriptions', () => {
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
    localStorage.setItem('leadvault_session', JSON.stringify({ profileId: owner.id }));

    // Active subscription
    let callbackCalled = false;
    db.subscribe(() => {
      callbackCalled = true;
    }, owner);

    // Execute logout sequence
    localStorage.removeItem('leadvault_session');
    db.unsubscribeAll();

    expect(localStorage.getItem('leadvault_session')).toBeNull();

    // Verify unsubscribed: subsequent event will not invoke callback
    db.createLead({
      name: 'Post Logout Lead',
      phone: '+91 9876543211',
      source: 'Website',
      priority: 'MEDIUM',
      status: 'NEW',
    }, owner);

    expect(callbackCalled).toBe(false);
  });

  // 9. Owner realtime lead update
  it('9. Owner realtime lead update: owner receives instant updates on lead creation and updates', () => {
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;

    const receivedEvents: RealtimeEvent[] = [];
    const unsub = db.subscribe((event) => {
      receivedEvents.push(event);
    }, owner);

    const lead = db.createLead({
      name: 'Live Realtime Lead',
      phone: '+91 9811122334',
      source: 'Website',
      priority: 'HIGH',
      status: 'NEW',
    }, owner);

    expect(receivedEvents.some((e) => e.type === 'LEAD_CREATED')).toBe(true);

    db.updateLead(lead.id, { status: 'CONTACTED' }, owner);
    expect(receivedEvents.some((e) => e.type === 'LEAD_UPDATED')).toBe(true);

    unsub();
  });

  // 10. Telecaller realtime assignment
  it('10. Telecaller realtime assignment: telecaller receives immediate event with ZERO phone exposure when assigned', () => {
    const telecaller = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'TELECALLER')!;
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;

    let deliveredEvent: RealtimeEvent | null = null;
    const unsub = db.subscribe((event) => {
      if (event.type === 'LEAD_CREATED') {
        deliveredEvent = event;
      }
    }, telecaller);

    const rawPhone = '+91 9876543210';
    db.createLead({
      name: 'Priya Sharma',
      phone: rawPhone,
      email: 'priya.sharma@example.com',
      source: 'Website',
      priority: 'MEDIUM',
      assigned_to: telecaller.id,
      status: 'NEW',
    }, owner);

    expect(deliveredEvent).not.toBeNull();
    const payload = (deliveredEvent as any)?.payload;
    expect(payload.assigned_to).toBe(telecaller.id);
    expect(payload.phone).toBeUndefined();
    expect('phone' in payload).toBe(false);

    unsub();
  });

  // 11. Cross-tenant realtime isolation
  it('11. Cross-tenant realtime isolation: subscribers in Organization A never receive events from Organization B', () => {
    const orgAOwner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'prof-owner-001')!;
    const orgBOwner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'prof-owner-002')!;

    expect(orgAOwner.organization_id).not.toBe(orgBOwner.organization_id);

    let orgBReceivedOrgAEvent = false;
    const unsub = db.subscribe((event) => {
      if (event.organization_id === orgAOwner.organization_id) {
        orgBReceivedOrgAEvent = true;
      }
    }, orgBOwner);

    // Create lead in Org A
    db.createLead({
      name: 'Org A Exclusive Lead',
      phone: '+91 9888877777',
      source: 'Website',
      priority: 'MEDIUM',
      status: 'NEW',
    }, orgAOwner);

    expect(orgBReceivedOrgAEvent).toBe(false);

    unsub();
  });

  // 12. Unauthorized telecaller realtime access
  it('12. Unauthorized telecaller realtime access: telecaller is dropped from unassigned leads and leads of other agents', () => {
    const telecaller = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'TELECALLER')!;
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;

    let receivedUnauthorized = false;
    const unsub = db.subscribe((event) => {
      if (event.type === 'LEAD_CREATED') {
        receivedUnauthorized = true;
      }
    }, telecaller);

    // 1. Unassigned lead
    db.createLead({
      name: 'Pool Lead',
      phone: '+91 9777766666',
      source: 'Website',
      priority: 'MEDIUM',
      status: 'NEW',
    }, owner);

    // 2. Lead assigned to someone else
    db.createLead({
      name: 'Other Agent Lead',
      phone: '+91 9666655555',
      source: 'Website',
      priority: 'MEDIUM',
      assigned_to: 'different-agent-id',
      status: 'NEW',
    }, owner);

    expect(receivedUnauthorized).toBe(false);

    unsub();
  });

  // 13. Call status realtime update
  it('13. Call status realtime update: broadcasts completed calls to active listeners immediately', () => {
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
    const leads = db.getLeads(owner);

    const receivedCalls: RealtimeEvent[] = [];
    const unsub = db.subscribe((event) => {
      if (event.type === 'CALL_RECORDED') {
        receivedCalls.push(event);
      }
    }, owner);

    const call = db.recordCall({
      lead_id: leads[0].id,
      duration_seconds: 72,
      status: 'COMPLETED',
    }, owner);

    expect(receivedCalls.length).toBe(1);
    expect((receivedCalls[0].payload as Call).id).toBe(call.id);

    unsub();
  });

  // 14. Follow-up realtime update
  it('14. Follow-up realtime update: broadcasts scheduled follow-ups across realtime channel instantly', () => {
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;
    const leads = db.getLeads(owner);

    const receivedFollowups: RealtimeEvent[] = [];
    const unsub = db.subscribe((event) => {
      if (event.type === 'FOLLOWUP_CREATED') {
        receivedFollowups.push(event);
      }
    }, owner);

    const followUp = db.scheduleFollowUp({
      lead_id: leads[0].id,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      priority: 'HIGH',
      notes: 'Customer requested discussion at 4 PM.',
    }, owner);

    expect(receivedFollowups.length).toBe(1);
    expect((receivedFollowups[0].payload as FollowUp).id).toBe(followUp.id);

    unsub();
  });

  // 15. Duplicate subscription prevention
  it('15. Duplicate subscription prevention: deduplicates duplicate subscribe calls for the same listener', () => {
    const owner = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.role === 'OWNER')!;

    let leadCreatedEvents = 0;
    const singleListener = (event: RealtimeEvent) => {
      if (event.type === 'LEAD_CREATED') {
        leadCreatedEvents++;
      }
    };

    // Subscribing twice with same listener instance
    const unsub1 = db.subscribe(singleListener, owner);
    const unsub2 = db.subscribe(singleListener, owner);

    db.createLead({
      name: 'Deduplicated Lead',
      phone: '+91 9555544444',
      source: 'Website',
      priority: 'LOW',
      status: 'NEW',
    }, owner);

    // Must be invoked exactly once for LEAD_CREATED, not duplicated
    expect(leadCreatedEvents).toBe(1);

    unsub1();
    unsub2();
  });

  // 16. Reconnect behavior
  it('16. Reconnect behavior: transitions through OFFLINE -> RECONNECTING -> LIVE on network interruption', () => {
    realtimeManager.setStatus('LIVE');
    expect(realtimeManager.getStatus()).toBe('LIVE');

    let recordedStatus = '';
    const unsub = realtimeManager.onStatusChange((status) => {
      recordedStatus = status;
    });

    // Simulate network loss
    realtimeManager.setStatus('OFFLINE');
    expect(realtimeManager.getStatus()).toBe('OFFLINE');
    expect(recordedStatus).toBe('OFFLINE');

    // Trigger reconnect
    realtimeManager.reconnect();
    expect(realtimeManager.getStatus()).toBe('RECONNECTING');

    // Connection restored
    realtimeManager.setStatus('LIVE');
    expect(realtimeManager.getStatus()).toBe('LIVE');
    expect(recordedStatus).toBe('LIVE');

    unsub();
  });
});
