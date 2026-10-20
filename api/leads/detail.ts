import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from '../_lib/supabaseServer.js';
import { db } from '../../src/services/supabase/db.js';
import {
  scrubPhoneFromText,
  maskName,
  stripDigitsFromText,
  redactLongDigitsFromText,
  sanitizeStudentName,
} from '../../src/lib/dataMasking.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  try {
    // 1. Authenticate Request using server-signed session token or Supabase JWT
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !profile || !user) {
      return res.status(401).json({ error: authError || 'Unauthorized' });
    }

    // 2. Verify account is ACTIVE
    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    // 3. Resolve target leadId from query or body
    const leadId =
      req.query?.id ||
      req.query?.leadId ||
      req.body?.id ||
      req.body?.leadId;

    if (!leadId || typeof leadId !== 'string') {
      return res.status(400).json({ error: 'leadId is required' });
    }

    let lead: any = null;

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();

      // Explicitly select ONLY permitted student & academic fields.
      // CRITICAL SECURITY ENFORCEMENT: 'phone' is strictly excluded from the database query.
      const { data, error } = await supabase
        .from('leads')
        .select(
          'id, organization_id, lead_code, name, email, source, status, priority, assigned_to, notes, created_at, updated_at, last_contacted_at, calls_count, father_name, mother_name, neet_score, neet_rank, neet_year, neet_attempts, eamcet_score, eamcet_rank, eamcet_year, eamcet_attempts, ipe_marks, ipe_percentage, ipe_year, ipe_attempts, category, gender, city, state, school_or_college, course_interest, metadata'
        )
        .eq('id', leadId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Lead not found or unauthorized' });
      }

      lead = data;
    } else {
      // In offline / test environments, locate lead in database store
      const allLeads = db.getAllRawLeadsForSystem();
      const found = allLeads.find((l) => l.id === leadId);
      if (!found) {
        return res.status(404).json({ error: 'Lead not found or unauthorized' });
      }

      // Explicitly project without phone
      const { phone: _rawPhone, ...rest } = found;
      lead = rest;
    }

    // 4. Multi-Tenant Organization Isolation:
    // Reject cross-tenant requests with 404 to avoid disclosing existence of other tenant's records
    if (profile.role !== 'ADMIN' && lead.organization_id !== profile.organization_id) {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        await supabase.from('security_events').insert([
          {
            organization_id: lead.organization_id,
            user_id: profile.id,
            user_name: profile.full_name,
            event_type: 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
            severity: 'CRITICAL',
            description: `User ${profile.full_name} (${profile.id}) from ${profile.organization_id} attempted to access cross-tenant lead ${lead.id}`,
            metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
          },
          {
            organization_id: profile.organization_id,
            user_id: profile.id,
            user_name: profile.full_name,
            event_type: 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
            severity: 'CRITICAL',
            description: `User ${profile.full_name} (${profile.id}) from ${profile.organization_id} attempted to access cross-tenant lead ${lead.id}`,
            metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
          },
        ]);
      } else {
        db.recordSecurityEvent(
          {
            organization_id: lead.organization_id,
            event_type: 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
            severity: 'CRITICAL',
            description: `User ${profile.full_name} (${profile.id}) from ${profile.organization_id} attempted to access cross-tenant lead ${lead.id}`,
            metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
          },
          profile as any
        );
        if (profile.organization_id && profile.organization_id !== lead.organization_id) {
          db.recordSecurityEvent(
            {
              organization_id: profile.organization_id,
              event_type: 'CROSS_TENANT_LEAD_ACCESS_ATTEMPT',
              severity: 'CRITICAL',
              description: `User ${profile.full_name} (${profile.id}) from ${profile.organization_id} attempted to access cross-tenant lead ${lead.id}`,
              metadata: { targetOrg: lead.organization_id, userOrg: profile.organization_id, leadId: lead.id },
            },
            profile as any
          );
        }
      }

      return res.status(404).json({ error: 'Lead not found or unauthorized' });
    }

    // 5. Telecaller Assignment Verification:
    // Telecallers can strictly view only leads assigned to their account
    if (profile.role === 'TELECALLER' && lead.assigned_to !== profile.id) {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        await supabase.from('security_events').insert({
          organization_id: profile.organization_id,
          user_id: profile.id,
          user_name: profile.full_name,
          event_type: 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT',
          severity: 'HIGH',
          description: `Telecaller ${profile.full_name} attempted to view unassigned lead ${lead.id}`,
          metadata: { leadId: lead.id, assignedTo: lead.assigned_to, callerId: profile.id },
        });
      } else {
        db.recordSecurityEvent(
          {
            event_type: 'UNAUTHORIZED_LEAD_ACCESS_ATTEMPT',
            severity: 'HIGH',
            description: `Telecaller ${profile.full_name} attempted to view unassigned lead ${lead.id}`,
            metadata: { leadId: lead.id, assignedTo: lead.assigned_to, callerId: profile.id },
          },
          profile as any
        );
      }

      return res.status(403).json({ error: 'Forbidden: You do not have permission to access this lead' });
    }

    // 6. Record Statutory Lead-Detail Access Audit Log
    // Logs user ID, lead ID, organization ID, and timestamp without sensitive academic or contact values
    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();
      await supabase.from('activity_logs').insert({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'LEAD_DETAILS_ACCESSED',
        entity_type: 'lead',
        entity_id: lead.id,
        metadata: { leadId: lead.id, leadCode: lead.lead_code, accessedAt: new Date().toISOString() },
      });
    } else {
      db.logActivity({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'LEAD_DETAILS_ACCESSED',
        entity_type: 'lead',
        entity_id: lead.id,
        metadata: { leadId: lead.id, leadCode: lead.lead_code, accessedAt: new Date().toISOString() },
      });
    }

    // 7. Construct and Return Authorized Student Details (ZERO PHONE EXPOSURE)
    // Only permitted fields are included. Missing fields are gracefully null (never fabricated).
    const isTelecaller = profile.role === 'TELECALLER';
    const rawFather = (lead.father_name ?? lead.metadata?.father_name) as string | null;
    const rawMother = (lead.mother_name ?? lead.metadata?.mother_name) as string | null;
    const rawCity = (lead.city ?? lead.metadata?.city) as string | null;
    const rawState = (lead.state ?? lead.metadata?.state) as string | null;
    const rawSchool = (lead.school_or_college ?? lead.metadata?.school_or_college) as string | null;
    const rawCourse = (lead.course_interest ?? lead.metadata?.course_interest) as string | null;

    const studentPayload = {
      id: lead.id,
      organization_id: lead.organization_id,
      lead_code: lead.lead_code,
      name: isTelecaller ? sanitizeStudentName(lead.name) : lead.name,
      email: isTelecaller ? undefined : lead.email,
      source: lead.source,
      status: lead.status,
      priority: lead.priority,
      assigned_to: lead.assigned_to,
      notes: isTelecaller ? scrubPhoneFromText(lead.notes) : lead.notes,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
      last_contacted_at: lead.last_contacted_at,
      calls_count: lead.calls_count,

      // Family details (digits stripped for telecaller to prevent phone smuggling)
      father_name: isTelecaller ? (stripDigitsFromText(rawFather) ?? null) : (rawFather ?? null),
      mother_name: isTelecaller ? (stripDigitsFromText(rawMother) ?? null) : (rawMother ?? null),

      // Academic and examination details
      neet_score: lead.neet_score ?? (lead.metadata?.neet_score as number | null) ?? null,
      neet_rank: lead.neet_rank ?? (lead.metadata?.neet_rank as number | null) ?? null,
      neet_year: lead.neet_year ?? (lead.metadata?.neet_year as number | null) ?? null,
      neet_attempts: lead.neet_attempts ?? (lead.metadata?.neet_attempts as number | null) ?? null,

      eamcet_score: lead.eamcet_score ?? (lead.metadata?.eamcet_score as number | null) ?? null,
      eamcet_rank: lead.eamcet_rank ?? (lead.metadata?.eamcet_rank as number | null) ?? null,
      eamcet_year: lead.eamcet_year ?? (lead.metadata?.eamcet_year as number | null) ?? null,
      eamcet_attempts: lead.eamcet_attempts ?? (lead.metadata?.eamcet_attempts as number | null) ?? null,

      ipe_marks: lead.ipe_marks ?? (lead.metadata?.ipe_marks as number | null) ?? null,
      ipe_percentage: lead.ipe_percentage ?? (lead.metadata?.ipe_percentage as number | null) ?? null,
      ipe_year: lead.ipe_year ?? (lead.metadata?.ipe_year as number | null) ?? null,
      ipe_attempts: lead.ipe_attempts ?? (lead.metadata?.ipe_attempts as number | null) ?? null,

      // Approved student profile fields
      category: lead.category ?? (lead.metadata?.category as string | null) ?? null,
      gender: lead.gender ?? (lead.metadata?.gender as string | null) ?? null,
      city: isTelecaller ? (stripDigitsFromText(rawCity) ?? null) : (rawCity ?? null),
      state: isTelecaller ? (stripDigitsFromText(rawState) ?? null) : (rawState ?? null),
      school_or_college: isTelecaller ? (redactLongDigitsFromText(rawSchool) ?? null) : (rawSchool ?? null),
      course_interest: isTelecaller ? (redactLongDigitsFromText(rawCourse) ?? null) : (rawCourse ?? null),
    };

    return res.status(200).json(studentPayload);
  } catch (err: any) {
    console.error('Lead detail handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
