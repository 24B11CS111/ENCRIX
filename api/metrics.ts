import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from './_lib/supabaseServer.js';
import { db } from '../src/services/supabase/db.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { user, profile, error: authError } = await authenticateServerRequest(req);
    if (authError || !user || !profile) {
      const statusCode = authError?.includes('unavailable') ? 503 : 401;
      return res.status(statusCode).json({ error: authError || 'Unauthorized' });
    }

    if (profile.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden: Account is inactive or suspended' });
    }

    const orgId = profile.organization_id;
    const now = new Date();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    if (isRealSupabaseServerConfigured()) {
      const supabase = getSupabaseServerClient();

      if (profile.role === 'OWNER' || profile.role === 'ADMIN') {
        // Parallel queries scoped strictly to organization_id
        const [
          leadsResult,
          callsResult,
          followUpsResult,
          telecallersResult,
          securityResult,
        ] = await Promise.all([
          supabase
            .from('leads')
            .select('id, status, assigned_to')
            .eq('organization_id', orgId),
          supabase
            .from('calls')
            .select('id, status, duration_seconds, telecaller_id, created_at')
            .eq('organization_id', orgId),
          supabase
            .from('follow_ups')
            .select('id, status, scheduled_at, assigned_to')
            .eq('organization_id', orgId),
          supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('organization_id', orgId)
            .eq('role', 'TELECALLER'),
          supabase
            .from('security_events')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId),
        ]);

        const leads = leadsResult.data || [];
        const calls = callsResult.data || [];
        const followUps = followUpsResult.data || [];
        const telecallers = telecallersResult.data || [];
        const securityCount = securityResult.count || 0;

        // 1. Leads breakdown
        const totalLeads = leads.length;
        const assignedLeads = leads.filter((l: any) => Boolean(l.assigned_to)).length;
        const unassignedLeads = totalLeads - assignedLeads;
        const conversions = leads.filter(
          (l: any) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
        ).length;

        const leadsByStatus: Record<string, number> = {
          NEW: 0,
          ASSIGNED: 0,
          IN_PROGRESS: 0,
          CONTACTED: 0,
          INTERESTED: 0,
          CONVERTED: 0,
          NOT_INTERESTED: 0,
          FOLLOW_UP: 0,
          DO_NOT_CONTACT: 0,
        };
        leads.forEach((l: any) => {
          if (l.status in leadsByStatus) {
            leadsByStatus[l.status]++;
          }
        });

        // 2. Calls breakdown
        const totalCallsCount = calls.length;
        const totalCallSeconds = calls.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0);
        const callsToday = calls.filter((c: any) => c.created_at >= oneDayAgo).length;
        const answeredCallsCount = calls.filter(
          (c: any) => (c.duration_seconds || 0) > 0 || c.status === 'COMPLETED'
        ).length;
        const connectRate = totalCallsCount > 0
          ? Math.round((answeredCallsCount / totalCallsCount) * 100)
          : 0;

        // 3. Follow-Ups breakdown
        const nonActiveStatuses = new Set(['COMPLETED', 'CANCELLED', 'RESCHEDULED']);
        const activeFollowUpsList = followUps.filter((f: any) => !nonActiveStatuses.has(f.status));
        const activeFollowUps = activeFollowUpsList.length;

        const followUpsDueToday = activeFollowUpsList.filter((f: any) => {
          return f.scheduled_at >= startOfToday && f.scheduled_at <= endOfToday;
        }).length;

        const followUpsOverdue = activeFollowUpsList.filter((f: any) => {
          return f.status === 'OVERDUE' || f.scheduled_at < startOfToday;
        }).length;

        // 4. Telecaller performance comparison
        const telecallerPerformance = telecallers.map((tc: any) => {
          const callerLeads = leads.filter((l: any) => l.assigned_to === tc.id);
          const callerCalls = calls.filter((c: any) => c.telecaller_id === tc.id);
          const callerPositives = callerLeads.filter(
            (l: any) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
          ).length;

          return {
            id: tc.id,
            fullName: tc.full_name,
            email: tc.email,
            status: tc.status,
            leadsCount: callerLeads.length,
            callsCount: callerCalls.length,
            positiveCount: callerPositives,
          };
        });

        return res.status(200).json({
          success: true,
          role: profile.role,
          metrics: {
            totalLeads,
            assignedLeads,
            unassignedLeads,
            conversions,
            leadsByStatus,
            totalCallsCount,
            totalCallSeconds,
            answeredCallsCount,
            connectRate,
            callsToday,
            activeFollowUps,
            followUpsDueToday,
            followUpsOverdue,
            securityCount,
            telecallerPerformance,
          },
        });
      }

      // Telecaller Scoped Metrics
      const [leadsResult, callsResult, followUpsResult] = await Promise.all([
        supabase
          .from('leads')
          .select('id, status')
          .eq('organization_id', orgId)
          .eq('assigned_to', profile.id),
        supabase
          .from('calls')
          .select('id, duration_seconds, status, created_at')
          .eq('organization_id', orgId)
          .eq('telecaller_id', profile.id),
        supabase
          .from('follow_ups')
          .select('id, status, scheduled_at')
          .eq('organization_id', orgId)
          .eq('assigned_to', profile.id),
      ]);

      const leads = leadsResult.data || [];
      const calls = callsResult.data || [];
      const followUps = followUpsResult.data || [];

      const totalAssigned = leads.length;
      const positiveLeads = leads.filter(
        (l: any) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
      ).length;

      const totalCalls = calls.length;
      const callsToday = calls.filter((c: any) => c.created_at >= oneDayAgo).length;

      const nonActiveStatuses = new Set(['COMPLETED', 'CANCELLED', 'RESCHEDULED']);
      const activeFollowUpsList = followUps.filter((f: any) => !nonActiveStatuses.has(f.status));
      const myFollowUps = activeFollowUpsList.length;

      const followUpsDueToday = activeFollowUpsList.filter((f: any) => {
        return f.scheduled_at >= startOfToday && f.scheduled_at <= endOfToday;
      }).length;

      const followUpsOverdue = activeFollowUpsList.filter((f: any) => {
        return f.status === 'OVERDUE' || f.scheduled_at < startOfToday;
      }).length;

      return res.status(200).json({
        success: true,
        role: profile.role,
        metrics: {
          totalAssigned,
          positiveLeads,
          totalCalls,
          callsToday,
          myFollowUps,
          followUpsDueToday,
          followUpsOverdue,
        },
      });
    }

    // Offline / Demo Fallback using db.ts aggregations
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Authoritative metrics require a configured database.' });
    }
    const allLeads = db.getLeads(profile as any);
    const allCalls = db.getCalls(profile as any);
    const allFollowUps = db.getFollowUps(profile as any);

    if (profile.role === 'OWNER' || profile.role === 'ADMIN') {
      const telecallers = db.getTelecallers(profile as any);
      const securityEvents = db.getSecurityEvents(profile as any);

      const totalLeads = allLeads.length;
      const assignedLeads = allLeads.filter((l) => Boolean(l.assigned_to)).length;
      const unassignedLeads = totalLeads - assignedLeads;
      const conversions = allLeads.filter(
        (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
      ).length;

      const totalCallsCount = allCalls.length;
      const totalCallSeconds = allCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
      const callsToday = allCalls.filter((c) => new Date(c.created_at) > new Date(Date.now() - 86400000)).length;
      const answeredCallsCount = allCalls.filter(
        (c) => (c.duration_seconds || 0) > 0 || c.status === 'COMPLETED'
      ).length;
      const connectRate = totalCallsCount > 0 ? Math.round((answeredCallsCount / totalCallsCount) * 100) : 0;

      const activeFollowUps = allFollowUps.filter(
        (f) => f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.status !== 'RESCHEDULED'
      ).length;

      const telecallerPerformance = telecallers.map((tc) => {
        const callerLeads = allLeads.filter((l) => l.assigned_to === tc.id);
        const callerCalls = allCalls.filter((c) => c.telecaller_id === tc.id);
        const callerPositives = callerLeads.filter(
          (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
        ).length;

        return {
          id: tc.id,
          fullName: tc.full_name,
          email: tc.email,
          status: tc.status,
          leadsCount: callerLeads.length,
          callsCount: callerCalls.length,
          positiveCount: callerPositives,
        };
      });

      return res.status(200).json({
        success: true,
        role: profile.role,
        metrics: {
          totalLeads,
          assignedLeads,
          unassignedLeads,
          conversions,
          totalCallsCount,
          totalCallSeconds,
          answeredCallsCount,
          connectRate,
          callsToday,
          activeFollowUps,
          followUpsDueToday: activeFollowUps,
          followUpsOverdue: 0,
          securityCount: securityEvents.length,
          telecallerPerformance,
        },
      });
    }

    // Telecaller Scoped Metrics Fallback
    const assigned = allLeads.filter((l) => l.assigned_to === profile.id);
    const positiveLeads = assigned.filter(
      (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
    ).length;
    const callerCalls = allCalls.filter((c) => c.telecaller_id === profile.id);
    const callsToday = callerCalls.filter((c) => new Date(c.created_at) > new Date(Date.now() - 86400000)).length;
    const myFollowUps = allFollowUps.filter(
      (f) => f.assigned_to === profile.id && f.status !== 'COMPLETED' && f.status !== 'CANCELLED'
    ).length;

    return res.status(200).json({
      success: true,
      role: profile.role,
      metrics: {
        totalAssigned: assigned.length,
        positiveLeads,
        totalCalls: callerCalls.length,
        callsToday,
        myFollowUps,
        followUpsDueToday: myFollowUps,
        followUpsOverdue: 0,
      },
    });
  } catch (error: any) {
    console.error('[metrics] Unexpected error computing metrics:', error?.message || error);
    return res.status(500).json({ error: 'Internal server error computing metrics.' });
  }
}
