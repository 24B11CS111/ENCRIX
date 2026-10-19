import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { TwilioTelephonyProvider } from '@/services/telephony/twilioProvider';
import { TelephonyWebhookHandler } from '@/services/telephony/webhookHandler';
import { CallService } from '@/services/telephony/callService';
import { db } from '@/services/supabase/db';
import { Profile } from '@/types';

describe('Phase 12: Production Telephony Gateway & Twilio Signature Tests', () => {
  const accountSid = 'AC_test_account_sid_12345';
  const authToken = 'super_secret_auth_token_xyz_789';
  const callerId = '+15551234567';

  let provider: TwilioTelephonyProvider;
  let webhookHandler: TelephonyWebhookHandler;
  let callService: CallService;

  beforeEach(() => {
    db.resetSandbox();
    provider = new TwilioTelephonyProvider({
      accountSid,
      authToken,
      callerId,
    });
    webhookHandler = new TelephonyWebhookHandler(provider);
    callService = new CallService(provider);
  });

  // Helper to generate legitimate Twilio signature
  const createValidSignature = (url: string, params: Record<string, string>): string => {
    const sortedKeys = Object.keys(params).sort();
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }
    return crypto.createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
  };

  it('1. Twilio provider initiates call and returns strictly masked phone number', async () => {
    const session = await provider.initiateCall({
      leadId: 'lead-test-01',
      telecallerId: 'tc-arjun-01',
      customerPhone: '+919876543210',
      organizationId: 'org-vertex-001',
    });

    expect(session.callId).toMatch(/^CA/);
    expect(session.status).toBe('INITIATED');
    // Ensure raw phone is NEVER exposed
    expect(session.maskedPhoneNumber).toBe('+91 ******3210');
    expect(session.phoneNumber).toBeUndefined();
  });

  it('2. Twilio provider generates compliant TwiML XML with dual-channel recording', () => {
    const twiml = provider.generateTwiML('+919876543210');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Dial');
    expect(twiml).toContain('record="record-from-answer-dual"');
    expect(twiml).toContain('+919876543210');
    expect(twiml).toContain('callerId="+15551234567"');
    expect(twiml).toContain('This call is being placed via LeadVault secure gateway and recorded');
  });

  it('3. Cryptographic signature check succeeds for valid Twilio webhook callback', () => {
    const url = 'https://staging.leadvault.io/api/telephony/status';
    const params: Record<string, string> = {
      CallSid: 'CA1234567890abcdef',
      CallStatus: 'completed',
      CallDuration: '45',
      RecordingUrl: 'https://api.twilio.com/recordings/RE123.mp3',
    };

    const validSignature = createValidSignature(url, params);
    const verified = provider.verifyWebhookSignature(validSignature, url, params);
    expect(verified).toBe(true);
  });

  it('4. Cryptographic signature check rejects forged or tampered webhook callbacks', () => {
    const url = 'https://staging.leadvault.io/api/telephony/status';
    const params: Record<string, string> = {
      CallSid: 'CA1234567890abcdef',
      CallStatus: 'completed',
    };

    const validSignature = createValidSignature(url, params);

    // Tampered payload (e.g. attacker changing CallSid)
    const tamperedParams = { ...params, CallSid: 'CA9999999999hacked' };
    expect(provider.verifyWebhookSignature(validSignature, url, tamperedParams)).toBe(false);

    // Completely fake signature
    expect(provider.verifyWebhookSignature('fake-signature-base64==', url, params)).toBe(false);
  });

  it('5. Webhook handler processes verified callbacks and updates call status', async () => {
    const url = 'https://staging.leadvault.io/api/telephony/status';
    const params = {
      CallSid: 'CA_valid_call_99',
      CallStatus: 'in-progress',
    };
    const signature = createValidSignature(url, params);

    const result = await webhookHandler.handleStatusCallback(signature, url, params);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.status).toBe('CONNECTED');
  });

  it('6. Webhook handler logs security event upon forged signature attempt', async () => {
    const url = 'https://staging.leadvault.io/api/telephony/status';
    const params = {
      CallSid: 'CA_attacker_probe',
      CallStatus: 'completed',
    };
    const badSignature = 'invalid_attacker_signature==';

    const result = await webhookHandler.handleStatusCallback(badSignature, url, params);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);

    // Verify security event was created
    const events = db.getSecurityEvents({ role: 'ADMIN', organization_id: '' } as Profile);
    const forgeryEvent = events.find((e) => e.event_type === 'TWILIO_WEBHOOK_FORGERY_ATTEMPT');
    expect(forgeryEvent).toBeDefined();
    expect(forgeryEvent?.severity).toBe('HIGH');
  });

  it('7. CallService allows assigned telecaller to dispatch call to their own lead', async () => {
    const arjunProfile = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'tc-arjun-01')!;
    const arjunLeads = db.getLeads(arjunProfile);
    expect(arjunLeads.length).toBeGreaterThan(0);

    const targetLead = arjunLeads[0];
    const dispatchResult = await callService.dispatchCall({
      leadId: targetLead.id,
      callerProfile: arjunProfile,
    });

    expect(dispatchResult.session.callId).toBeDefined();
    expect(dispatchResult.session.leadId).toBe(targetLead.id);
    expect(dispatchResult.session.maskedPhoneNumber).toBeUndefined();
    // Ensure raw phone is not returned to caller
    expect((dispatchResult.session as unknown as Record<string, unknown>).phoneNumber).toBeUndefined();
  });

  it('8. CallService BLOCKS telecaller from calling unassigned leads (security boundary)', async () => {
    const rahulProfile = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'tc-rahul-02')!;
    const arjunProfile = db.getProfiles({ role: 'ADMIN', organization_id: '' } as Profile).find((p) => p.id === 'tc-arjun-01')!;
    
    // Pick lead assigned to Arjun
    const arjunLeads = db.getLeads(arjunProfile);
    const arjunLead = arjunLeads[0];

    // Rahul attempts to call Arjun's lead
    await expect(
      callService.dispatchCall({
        leadId: arjunLead.id,
        callerProfile: rahulProfile,
      })
    ).rejects.toThrow(/unauthorized|forbidden|assigned to you/i);

    // Verify security event logged
    const events = db.getSecurityEvents({ role: 'ADMIN', organization_id: '' } as Profile);
    const unauthorizedCallAttempt = events.find(
      (e) =>
        e.event_type === 'UNAUTHORIZED_CALL_DISPATCH_ATTEMPT' ||
        e.event_type === 'LEAD_ASSIGNMENT_BYPASS_ATTEMPT' ||
        e.event_type === 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT'
    );
    expect(unauthorizedCallAttempt).toBeDefined();
  });

  it('9. CallService BLOCKS suspended telecaller from placing any calls', async () => {
    const suspendedProfile: Profile = {
      id: 'tc-suspended-01',
      user_id: 'user-suspended-01',
      organization_id: 'org-vertex-001',
      full_name: 'Suspended Caller',
      role: 'TELECALLER',
      status: 'DISABLED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await expect(
      callService.dispatchCall({
        leadId: 'lead-test-01',
        callerProfile: suspendedProfile,
      })
    ).rejects.toThrow(/Access denied|suspended/i);
  });
});
