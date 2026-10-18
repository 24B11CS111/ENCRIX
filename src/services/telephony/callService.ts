import { Profile, TelephonySession } from '@/types';
import { db } from '@/services/supabase/db';
import { ITelephonyProvider } from './provider';
import { MockTelephonyProvider } from './mockProvider';
import { TwilioTelephonyProvider } from './twilioProvider';
import { TELEPHONY_PROVIDER } from '@/lib/config';
import { isLiveApiMode, authService } from '@/services/auth/authService';

export class CallService {
  private provider: ITelephonyProvider;

  constructor(providerOverride?: ITelephonyProvider) {
    if (providerOverride) {
      this.provider = providerOverride;
    } else if (TELEPHONY_PROVIDER === 'twilio') {
      this.provider = new TwilioTelephonyProvider();
    } else {
      this.provider = new MockTelephonyProvider();
    }
  }

  public getProvider(): ITelephonyProvider {
    return this.provider;
  }

  /**
   * Secure Server-Side Call Gateway.
   * Telecaller client sends ONLY { leadId }.
   * Raw customer phone number is resolved internally from the database and NEVER sent to the client.
   */
  public async dispatchCall(params: {
    leadId: string;
    callerProfile: Profile;
  }): Promise<{ session: TelephonySession; consentNotice: string }> {
    const { leadId, callerProfile } = params;

    // 1. Verify caller active status
    if (callerProfile.status === 'DISABLED' || callerProfile.status === 'SUSPENDED') {
      throw new Error('Access denied: Caller account is suspended');
    }

    // 2. In live API mode, dispatch call through secure serverless endpoint
    if (isLiveApiMode() && typeof window !== 'undefined') {
      const token = authService.getSessionToken();
      const res = await fetch('/api/telephony/call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ leadId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch outbound call');
      }

      const session: TelephonySession = {
        callId: data.callId,
        leadId,
        telecallerId: callerProfile.id,
        maskedPhoneNumber: data.maskedPhone,
        status: data.status || 'INITIATED',
        startedAt: new Date(),
        durationSeconds: 0,
        isMuted: false,
      };

      return {
        session,
        consentNotice:
          'Authorized call placed via ENCRIX Twilio Gateway. Compliant with TRAI/FCC calling standards; recorded for compliance.',
      };
    }

    // 2. Fetch lead from database using caller's authorization context
    // This enforces tenant isolation and assignment checks
    const lead = db.getLeadById(leadId, callerProfile);
    if (!lead) {
      throw new Error('Lead not found or unauthorized: Tenant mismatch or unassigned lead');
    }

    // 3. Strict Role-Based Assignment Check:
    // If caller is TELECALLER, they MUST be assigned to this lead
    if (callerProfile.role === 'TELECALLER' && lead.assigned_to !== callerProfile.id) {
      db.recordSecurityEvent(
        {
          event_type: 'UNAUTHORIZED_CALL_DISPATCH_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${callerProfile.full_name} (${callerProfile.id}) attempted to place call to unassigned lead ${lead.id}`,
          metadata: { leadId: lead.id, telecallerId: callerProfile.id },
        },
        callerProfile
      );
      throw new Error('Access forbidden: You can only place calls to leads assigned to you');
    }

    // 4. Resolve raw customer phone number securely from internal storage
    const rawPhoneNumber = db.getRawPhoneNumberForCall(lead.id, callerProfile);
    if (!rawPhoneNumber) {
      throw new Error('Customer contact number could not be resolved from secure database');
    }

    // 5. Dispatch call to Telephony Provider with internal credentials
    const session = await this.provider.initiateCall({
      leadId: lead.id,
      telecallerId: callerProfile.id,
      customerPhone: rawPhoneNumber,
      organizationId: callerProfile.organization_id,
    });

    // 6. Record call in database with 'INITIATED' status
    db.recordCall(
      {
        lead_id: lead.id,
        duration_seconds: 0,
        status: 'INITIATED',
        provider: 'TWILIO',
        provider_call_id: session.callId,
      },
      callerProfile
    );

    // 7. Update lead status to CONTACTED if it was NEW or ASSIGNED
    if (lead.status === 'NEW' || lead.status === 'ASSIGNED') {
      db.updateLead(lead.id, { status: 'CONTACTED' }, callerProfile);
    }

    // 8. Log calling activity for compliance audit trail
    db.logActivity({
      organization_id: callerProfile.organization_id,
      user_id: callerProfile.id,
      user_name: callerProfile.full_name,
      user_role: callerProfile.role,
      action: 'CALL_STARTED',
      entity_type: 'call',
      entity_id: session.callId,
      metadata: {
        leadId: lead.id,
        leadCode: lead.lead_code,
        provider: this.provider.name,
      },
    });

    return {
      session,
      consentNotice: this.provider.getConsentNotice(),
    };
  }

  /**
   * Terminate active call and persist duration & recording metadata
   */
  public async endCall(
    callId: string,
    callerProfile: Profile
  ): Promise<{ durationSeconds: number; recordingUrl: string }> {
    const result = await this.provider.endCall(callId);

    // Log call completion
    db.logActivity({
      organization_id: callerProfile.organization_id,
      user_id: callerProfile.id,
      user_name: callerProfile.full_name,
      user_role: callerProfile.role,
      action: 'CALL_COMPLETED',
      entity_type: 'call',
      entity_id: callId,
      metadata: {
        durationSeconds: result.durationSeconds,
        recordingUrl: result.recordingUrl,
      },
    });

    return result;
  }
}

export const callService = new CallService();
