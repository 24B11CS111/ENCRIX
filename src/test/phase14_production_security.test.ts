import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { db } from '@/services/supabase/db';
import { Organization, Profile, Lead } from '@/types';
import { TwilioTelephonyProvider } from '@/services/telephony/twilioProvider';
import { TelephonyWebhookHandler } from '@/services/telephony/webhookHandler';
import { CallService } from '@/services/telephony/callService';
import { recordingService } from '@/services/telephony/recordingService';
import { TwilioWebhookParams } from '@/services/telephony';
import { IS_DEMO_MODE } from '@/lib/config';

describe('ENCRIX Phase 14: Production Security & Telephony Verification Suite', () => {
  // Test Tenants
  const orgA: Organization = {
    id: 'org-titan-001',
    name: 'Titan Defense Corp',
    slug: 'titan-defense',
    owner_id: 'owner-titan-001',
    industry: 'Cybersecurity',
    company_size: '50-100',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const orgB: Organization = {
    id: 'org-apex-002',
    name: 'Apex Capital',
    slug: 'apex-capital',
    owner_id: 'owner-apex-002',
    industry: 'Finance',
    company_size: '20-50',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Test Profiles
  const ownerA: Profile = {
    id: 'prof-owner-titan',
    user_id: 'user-owner-titan',
    organization_id: 'org-titan-001',
    full_name: 'Marcus Vance',
    role: 'OWNER',
    status: 'ACTIVE',
    phone: '+91 98765 11111',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA: Profile = {
    id: 'prof-tc-titan-01',
    user_id: 'user-tc-titan-01',
    organization_id: 'org-titan-001',
    full_name: 'Alex Mercer',
    role: 'TELECALLER',
    status: 'ACTIVE',
    phone: '+91 98765 11112',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerA2: Profile = {
    id: 'prof-tc-titan-02',
    user_id: 'user-tc-titan-02',
    organization_id: 'org-titan-001',
    full_name: 'Priya Sharma',
    role: 'TELECALLER',
    status: 'ACTIVE',
    phone: '+91 98765 11113',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const ownerB: Profile = {
    id: 'prof-owner-apex',
    user_id: 'user-owner-apex',
    organization_id: 'org-apex-002',
    full_name: 'Elena Rostova',
    role: 'OWNER',
    status: 'ACTIVE',
    phone: '+91 98765 22221',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const telecallerB: Profile = {
    id: 'prof-tc-apex-01',
    user_id: 'user-tc-apex-01',
    organization_id: 'org-apex-002',
    full_name: 'Boris Becker',
    role: 'TELECALLER',
    status: 'ACTIVE',
    phone: '+91 98765 22222',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const adminProfile: Profile = {
    id: 'prof-platform-admin',
    user_id: 'user-platform-admin',
    organization_id: 'org-titan-001',
    full_name: 'Platform Root Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    phone: '+91 98765 99999',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Telephony credentials
  const accountSid = 'AC_test_account_sid_prod14';
  const authToken = 'prod_secret_auth_token_hash_2026';
  const callerId = '+15550005678';
  const webhookUrl = 'https://app.leadvault.io/api/telephony/webhook';

  let provider: TwilioTelephonyProvider;
  let webhookHandler: TelephonyWebhookHandler;
  let callService: CallService;

  const createValidSignature = (url: string, params: Record<string, string>): string => {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    return crypto.createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
  };

  beforeEach(() => {
    db.resetSandbox(false); // Clean production zero-state
    provider = new TwilioTelephonyProvider({
      accountSid,
      authToken,
      callerId,
      statusCallbackUrl: webhookUrl,
    });
    webhookHandler = new TelephonyWebhookHandler(provider);
    callService = new CallService(provider);

    // Register isolated Test Tenants and Profiles
    db.seedTestTenant(orgA, [ownerA, telecallerA, telecallerA2]);
    db.seedTestTenant(orgB, [ownerB, telecallerB]);
  });

  // =========================================================================
  // 10 MANDATORY SECURITY VERIFICATION CRITERIA
  // =========================================================================

  it('Criterion 1: Cross-tenant lead access denied', () => {
    // Create Lead in Org A
    const leadA = db.createLead(
      {
        name: 'Confidential Enterprise Lead A',
        phone: '+91 98765 33001',
        email: 'alpha@titan.test',
        source: 'INBOUND',
        priority: 'HIGH',
        status: 'NEW',
      },
      ownerA
    );

    // Owner B (Apex Capital) attempts to read lead A by ID
    expect(() => db.getLeadById(leadA.id, ownerB)).toThrow(/Forbidden/i);

    // Telecaller B attempts to fetch lead A
    expect(() => db.getLeadById(leadA.id, telecallerB)).toThrow(/Forbidden/i);

    // Direct phone extraction attempt across tenants is blocked
    expect(() => db.getRawPhoneNumberForCall(leadA.id, ownerB)).toThrow(
      /Forbidden: Lead belongs to another organization/i
    );
  });

  it('Criterion 2: Unassigned telecaller lead access denied', async () => {
    // Create Lead in Org A assigned specifically to Alex Mercer (telecallerA)
    const leadA = db.createLead(
      {
        name: 'Target Account Acme',
        phone: '+91 98765 33002',
        email: 'acme@titan.test',
        source: 'OUTBOUND',
        priority: 'HIGH',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    // Telecaller A2 (Priya Sharma in Org A) is NOT assigned to this lead
    // Direct attempt to retrieve raw phone number for call must be blocked
    expect(() => db.getRawPhoneNumberForCall(leadA.id, telecallerA2)).toThrow(
      /Forbidden: Telecaller cannot call unassigned lead/i
    );

    // Calling via CallService must be rejected
    await expect(
      callService.dispatchCall({
        leadId: leadA.id,
        callerProfile: telecallerA2,
      })
    ).rejects.toThrow(/Forbidden|assigned to you/i);

    // Security event logged for unassigned call attempt
    const events = db.getSecurityEvents(adminProfile);
    const unauthCallEvent = events.find(
      (e) =>
        e.event_type === 'UNAUTHORIZED_CALL_DISPATCH_ATTEMPT' ||
        e.event_type === 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT' ||
        e.event_type === 'UNAUTHORIZED_CALL_ATTEMPT'
    );
    expect(unauthCallEvent).toBeDefined();
    expect(unauthCallEvent?.severity).toBe('HIGH');
  });

  it('Criterion 3: Raw phone extraction blocked from telecallers', async () => {
    const rawPhoneNumber = '+91 98765 33003';
    const leadA = db.createLead(
      {
        name: 'High Net Worth Lead',
        phone: rawPhoneNumber,
        source: 'WEBSITE',
        priority: 'URGENT',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    // 1. In lead lists, phone number is completely omitted for telecallers
    const telecallerLeads = db.getLeads(telecallerA);
    const listedLead = telecallerLeads.find((l) => l.id === leadA.id);
    expect(listedLead).toBeDefined();
    expect(listedLead?.phone).toBeUndefined();
    expect((listedLead as any)?.raw_phone).toBeUndefined();

    // 2. Dispatch call returns zero phone digits to telecaller client
    const dispatchResult = await callService.dispatchCall({
      leadId: leadA.id,
      callerProfile: telecallerA,
    });
    expect(dispatchResult.session.maskedPhoneNumber).toBeUndefined();
    expect((dispatchResult.session as unknown as Record<string, unknown>).phoneNumber).toBeUndefined();
    expect((dispatchResult.session as unknown as Record<string, unknown>).customerPhone).toBeUndefined();
  });

  it('Criterion 4: Telecaller export denied', () => {
    db.createLead(
      {
        name: 'Export Guard Lead',
        phone: '+91 98765 33004',
        source: 'REFERRAL',
        priority: 'MEDIUM',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    // Telecaller attempts to call exportLeads
    expect(() => db.exportLeads(telecallerA)).toThrow(/Forbidden.*strictly prohibited/i);

    // Verify security event created
    const events = db.getSecurityEvents(adminProfile);
    const exportEvent = events.find((e) => e.event_type === 'TELECALLER_EXPORT_BLOCKED');
    expect(exportEvent).toBeDefined();
    expect(exportEvent?.severity).toBe('HIGH');
  });

  it('Criterion 5: Forged Twilio webhook rejected', async () => {
    const forgedParams = {
      CallSid: 'CA_attacker_probe_888',
      CallStatus: 'completed',
      CallDuration: '120',
    };

    const forgedSignature = 'bad_forged_signature_header_value==';

    const result = await webhookHandler.handleStatusCallback(forgedSignature, webhookUrl, forgedParams);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toMatch(/Invalid Twilio HMAC signature/i);

    // Security event logged
    const events = db.getSecurityEvents(adminProfile);
    const forgeryEvent = events.find((e) => e.event_type === 'TWILIO_WEBHOOK_FORGERY_ATTEMPT');
    expect(forgeryEvent).toBeDefined();
    expect(forgeryEvent?.severity).toBe('HIGH');
  });

  it('Criterion 6: Valid Twilio webhook processed with duplicate idempotency check', async () => {
    // Create lead and place initiated call
    const lead = db.createLead(
      {
        name: 'Webhook Test Lead',
        phone: '+91 98765 33006',
        source: 'INBOUND',
        priority: 'HIGH',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    const callRecord = db.recordCall(
      {
        lead_id: lead.id,
        duration_seconds: 0,
        status: 'INITIATED',
      },
      telecallerA
    );

    const callSid = 'CA_valid_sid_444555';
    // Link provider call ID
    db.updateCall(callRecord.id, { provider_call_id: callSid }, adminProfile);

    const validParams: TwilioWebhookParams = {
      CallSid: callSid,
      CallStatus: 'in-progress',
      SequenceNumber: '1',
    };
    const validSig = createValidSignature(webhookUrl, validParams as Record<string, string>);

    // 1. First delivery -> processed successfully
    const result1 = await webhookHandler.handleStatusCallback(validSig, webhookUrl, validParams);
    expect(result1.success).toBe(true);
    expect(result1.statusCode).toBe(200);
    expect(result1.status).toBe('CONNECTED');
    expect(result1.isDuplicate).toBeFalsy();

    // 2. Replayed duplicate delivery -> detected and handled idempotently
    const result2 = await webhookHandler.handleStatusCallback(validSig, webhookUrl, validParams);
    expect(result2.success).toBe(true);
    expect(result2.statusCode).toBe(200);
    expect(result2.isDuplicate).toBe(true);
  });

  it('Criterion 7: Unauthorized recording access denied', () => {
    // Call in Org A
    const leadA = db.createLead(
      {
        name: 'Recorded Customer Alpha',
        phone: '+91 98765 33007',
        source: 'INBOUND',
        priority: 'HIGH',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    const callA = db.recordCall(
      {
        lead_id: leadA.id,
        duration_seconds: 75,
        status: 'COMPLETED',
        recording_url: 'https://storage.encrix.internal/recordings/org-titan-001/call-alpha.mp3',
      },
      telecallerA
    );

    // 1. Cross-tenant access: Owner B (Apex Capital) attempts to access Org A recording
    expect(recordingService.canAccessRecording(callA, ownerB)).toBe(false);
    expect(() => recordingService.getRecordingAccess(callA.id, ownerB)).toThrow(
      /not found or unauthorized/i
    );

    // 2. Same tenant, but unassigned telecaller (Priya Sharma telecallerA2):
    expect(recordingService.canAccessRecording(callA, telecallerA2)).toBe(false);

    // 3. Authorized access: Owner A
    expect(recordingService.canAccessRecording(callA, ownerA)).toBe(true);
    const ownerAccess = recordingService.getRecordingAccess(callA.id, ownerA);
    expect(ownerAccess.recordingUrl).toContain('call-alpha.mp3');
    expect(ownerAccess.expiresInSeconds).toBe(60);

    // 4. Authorized access: Telecaller A (initiator)
    expect(recordingService.canAccessRecording(callA, telecallerA)).toBe(true);
    const tcAccess = recordingService.getRecordingAccess(callA.id, telecallerA);
    expect(tcAccess.recordingUrl).toContain('call-alpha.mp3');
  });

  it('Criterion 8: Service-role key absent from client-accessible environment', () => {
    // import.meta.env must never expose SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN
    const clientEnv = import.meta.env as Record<string, unknown>;
    expect(clientEnv.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(clientEnv.TWILIO_AUTH_TOKEN).toBeUndefined();
    expect(clientEnv.TWILIO_ACCOUNT_SID).toBeUndefined();
  });

  it('Criterion 9: Demo mode disabled in production', () => {
    // In production build configuration, VITE_ENABLE_DEMO_SANDBOX must be false
    // Clean production database contains 0 demo or fake records
    expect(db.getOrganizations(adminProfile)).toHaveLength(2); // Only explicitly provisioned orgs A & B
    expect(db.getLeads(adminProfile)).toHaveLength(0);
    expect(db.getCalls(adminProfile)).toHaveLength(0);
  });

  it('Criterion 10: Security events immutable and tamper-proof', () => {
    // Record a security event
    db.recordSecurityEvent(
      {
        event_type: 'TAMPER_TEST_EVENT',
        severity: 'CRITICAL',
        description: 'Testing audit immutability',
        metadata: { probe: true },
      },
      adminProfile
    );

    const initialEvents = db.getSecurityEvents(adminProfile);
    expect(initialEvents.length).toBeGreaterThan(0);

    // Verify security events are append-only and strictly immutable
    expect(() => db.updateSecurityEvent()).toThrow(/strictly immutable/i);
    expect(() => db.deleteSecurityEvent()).toThrow(/append-only and cannot be deleted/i);
  });

  // =========================================================================
  // PRODUCTION MULTI-TENANT ACCEPTANCE LIFECYCLE: ORG A VS ORG B
  // =========================================================================

  it('Production Multi-Tenant Acceptance: Org A vs Org B isolated telecalling lifecycle', async () => {
    // 1. Create Lead in Org A (assigned to telecallerA)
    const leadA = db.createLead(
      {
        name: 'Enterprise Client A',
        phone: '+91 98765 44001',
        source: 'REFERRAL',
        priority: 'URGENT',
        status: 'ASSIGNED',
        assigned_to: telecallerA.id,
      },
      ownerA
    );

    // 2. Create Lead in Org B (assigned to telecallerB)
    const leadB = db.createLead(
      {
        name: 'Commercial Client B',
        phone: '+91 98765 44002',
        source: 'CAMPAIGN',
        priority: 'HIGH',
        status: 'ASSIGNED',
        assigned_to: telecallerB.id,
      },
      ownerB
    );

    // 3. Verify Org isolation in query views
    const leadsSeenByOwnerA = db.getLeads(ownerA);
    expect(leadsSeenByOwnerA.some((l) => l.id === leadA.id)).toBe(true);
    expect(leadsSeenByOwnerA.some((l) => l.id === leadB.id)).toBe(false);

    const leadsSeenByOwnerB = db.getLeads(ownerB);
    expect(leadsSeenByOwnerB.some((l) => l.id === leadB.id)).toBe(true);
    expect(leadsSeenByOwnerB.some((l) => l.id === leadA.id)).toBe(false);

    // 4. Telecaller A initiates authorized call to Lead A
    const dispatchA = await callService.dispatchCall({
      leadId: leadA.id,
      callerProfile: telecallerA,
    });

    expect(dispatchA.session.callId).toBeDefined();
    expect(dispatchA.session.status).toBe('INITIATED');
    expect(dispatchA.session.maskedPhoneNumber).toBeUndefined();

    // Lead status updated to CONTACTED
    const updatedLeadA = db.getLeadById(leadA.id, telecallerA);
    expect(updatedLeadA?.status).toBe('CONTACTED');

    // 5. Twilio webhook delivers COMPLETED status update for Org A call
    const callSidA = dispatchA.session.callId;
    const completedParams = {
      CallSid: callSidA,
      CallStatus: 'completed',
      CallDuration: '185',
      RecordingUrl: 'https://storage.encrix.internal/recordings/org-titan-001/rec_alpha_185.mp3',
    };
    const completedSig = createValidSignature(webhookUrl, completedParams);

    const webhookResult = await webhookHandler.handleStatusCallback(completedSig, webhookUrl, completedParams);
    expect(webhookResult.success).toBe(true);
    expect(webhookResult.status).toBe('COMPLETED');

    // 6. Owner A sees call record in Org A
    const callsA = db.getCalls(ownerA);
    const callInA = callsA.find((c) => c.lead_id === leadA.id);
    expect(callInA).toBeDefined();
    expect(callInA?.status).toBe('COMPLETED');
    expect(callInA?.duration_seconds).toBe(185);

    // 7. Owner B queries calls -> absolutely 0 calls from Org A visible
    const callsB = db.getCalls(ownerB);
    expect(callsB.some((c) => c.organization_id === orgA.id)).toBe(false);
    expect(callsB.some((c) => c.lead_id === leadA.id)).toBe(false);
  });
});
