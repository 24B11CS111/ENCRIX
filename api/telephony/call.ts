import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer';
import { getTwilioServerConfig, maskPhoneNumber } from '../_lib/twilioServer';
import { db } from '../../src/services/supabase/db';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    // 1. Authenticate Request
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile || !user) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    // 2. Verify account is ACTIVE
    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    const { leadId } = req.body || {};
    if (!leadId) {
      return res.status(400).json({ error: 'leadId is required' });
    }

    let lead: any = null;

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();

      // 3. Query lead to verify tenant isolation and assignment
      const { data, error: leadError } = await supabase
        .from('leads')
        .select('id, organization_id, lead_code, name, phone, assigned_to, status')
        .eq('id', leadId)
        .single();

      if (leadError || !data) {
        return res.status(404).json({ error: 'Lead not found or unauthorized' });
      }
      lead = data;
    } else {
      const allLeads = db.getAllRawLeadsForSystem();
      const found = allLeads.find((l) => l.id === leadId);
      if (!found) {
        return res.status(404).json({ error: 'Lead not found or unauthorized' });
      }
      lead = found;
    }

    // 4. Tenant isolation check
    if (profile.role !== 'ADMIN' && lead.organization_id !== profile.organization_id) {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        await supabase.from('security_events').insert({
          organization_id: lead.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'CROSS_TENANT_CALL_ATTEMPT',
          severity: 'CRITICAL',
          description: `User ${profile.full_name} (${profile.id}) attempted to place call to cross-tenant lead ${lead.id}`,
          metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
        });
      } else {
        db.recordSecurityEvent(
          {
            organization_id: lead.organization_id,
            event_type: 'CROSS_TENANT_CALL_ATTEMPT',
            severity: 'CRITICAL',
            description: `User ${profile.full_name} (${profile.id}) attempted to place call to cross-tenant lead ${lead.id}`,
            metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
          },
          profile as any
        );
      }
      return res.status(403).json({ error: 'Forbidden: Cannot place calls on another organization lead' });
    }

    // 5. Telecaller assignment check
    if (profile.role === 'TELECALLER' && lead.assigned_to !== profile.id) {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        await supabase.from('security_events').insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'UNAUTHORIZED_CALL_DISPATCH_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${profile.full_name} attempted to place call to unassigned lead ${lead.id}`,
          metadata: { leadId: lead.id, assignedTo: lead.assigned_to, callerId: profile.id },
        });
      } else {
        db.recordSecurityEvent(
          {
            organization_id: profile.organization_id,
            event_type: 'UNAUTHORIZED_CALL_DISPATCH_ATTEMPT',
            severity: 'HIGH',
            description: `Telecaller ${profile.full_name} attempted to place call to unassigned lead ${lead.id}`,
            metadata: { leadId: lead.id, assignedTo: lead.assigned_to, callerId: profile.id },
          },
          profile as any
        );
      }
      return res.status(403).json({ error: 'Forbidden: You can only call leads assigned to you' });
    }

    // 6. Resolve raw customer phone number on the server (NEVER sent to client!)
    const rawPhoneNumber = lead.phone;
    if (!rawPhoneNumber) {
      return res.status(400).json({ error: 'Customer phone number is missing or invalid' });
    }

    const twilioConfig = getTwilioServerConfig();
    let callSid = `CA${Date.now().toString(16)}${Math.random().toString(16).substring(2, 10)}`;

    // 7. Dispatch call to Twilio REST API if live production credentials configured
    const isLiveConfig =
      Boolean(twilioConfig.accountSid) &&
      Boolean(twilioConfig.authToken) &&
      !twilioConfig.accountSid.includes('test') &&
      !twilioConfig.accountSid.includes('mock') &&
      !twilioConfig.accountSid.includes('placeholder') &&
      !twilioConfig.authToken.includes('test') &&
      !twilioConfig.authToken.includes('mock') &&
      !twilioConfig.authToken.includes('placeholder');

    const isProd =
      process.env.NODE_ENV === 'production' ||
      process.env.VITE_APP_ENV === 'production' ||
      process.env.VITE_ENABLE_DEMO_SANDBOX === 'false';

    if (!isLiveConfig && isProd) {
      return res.status(503).json({
        error: 'BLOCKED — REAL TELEPHONY PROVIDER CREDENTIALS REQUIRED',
      });
    }

    if (isLiveConfig) {
      const authHeader =
        'Basic ' +
        Buffer.from(`${twilioConfig.accountSid}:${twilioConfig.authToken}`).toString('base64');

      const bodyParams = new URLSearchParams({
        To: rawPhoneNumber,
        From: twilioConfig.callerId,
        Url: twilioConfig.voiceWebhookUrl,
        StatusCallback: twilioConfig.statusCallbackUrl,
        StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'].join(' '),
        Record: 'record-from-answer-dual',
      });

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Calls.json`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: bodyParams.toString(),
        }
      );

      if (!twilioRes.ok) {
        const errData = (await twilioRes.json().catch(() => ({}))) as Record<string, any>;
        throw new Error(
          `Twilio API error (${twilioRes.status}): ${errData.message || twilioRes.statusText || 'Call dispatch failed'}`
        );
      }

      const data = (await twilioRes.json()) as { sid?: string };
      if (data.sid) {
        callSid = data.sid;
      }
    }

    let createdCallId = callSid;

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();

      // 8. Record call in database with INITIATED status
      const { data: callRecord, error: callError } = await supabase
        .from('calls')
        .insert({
          organization_id: profile.organization_id,
          lead_id: lead.id,
          telecaller_id: profile.id,
          provider: 'TWILIO',
          provider_call_id: callSid,
          duration_seconds: 0,
          status: 'INITIATED',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (callError) {
        console.error('Failed to record call in DB:', callError);
      }
      if (callRecord?.id) {
        createdCallId = callRecord.id;
      }

      // 9. Update lead status if NEW or ASSIGNED
      if (lead.status === 'NEW' || lead.status === 'ASSIGNED') {
        await supabase
          .from('leads')
          .update({ status: 'CONTACTED', updated_at: new Date().toISOString() })
          .eq('id', lead.id);
      }

      // 10. Audit log activity
      await supabase.from('activity_logs').insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'CALL_STARTED',
        entity_type: 'call',
        entity_id: createdCallId,
        metadata: { leadId: lead.id, leadCode: lead.lead_code },
      });
    } else {
      const call = db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: 0,
          status: 'INITIATED',
          provider: 'TWILIO',
          provider_call_id: callSid,
        },
        profile as any
      );
      if (call?.id) {
        createdCallId = call.id;
      }

      if (lead.status === 'NEW' || lead.status === 'ASSIGNED') {
        db.updateLead(lead.id, { status: 'CONTACTED' }, profile as any);
      }

      db.logActivity({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'CALL_STARTED',
        entity_type: 'call',
        entity_id: createdCallId,
        metadata: { leadId: lead.id, leadCode: lead.lead_code },
      });
    }

    // 11. Respond to client: telecallers receive ZERO phone representation
    if (profile.role === 'TELECALLER') {
      return res.status(200).json({
        callId: createdCallId,
        status: 'INITIATED',
        leadId: lead.id,
        leadCode: lead.lead_code,
      });
    }

    return res.status(200).json({
      callId: createdCallId,
      status: 'INITIATED',
      maskedPhone: maskPhoneNumber(rawPhoneNumber),
      leadId: lead.id,
      leadCode: lead.lead_code,
    });
  } catch (err: any) {
    console.error('Call dispatch error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during call dispatch' });
  }
}
