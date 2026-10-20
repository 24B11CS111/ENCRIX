import { authenticateServerRequest, isRealSupabaseServerConfigured } from '../_lib/supabaseServer.js';
import {
  processFollowUpReminders,
  timingSafeCompare,
} from '../_lib/reminderProcessor.js';

/**
 * Serverless Cron Endpoint for Follow-Up Reminders & Overdue Escalations
 *
 * Supported Authorization:
 * 1. Bearer Token matching CRON_SECRET (scheduled automated jobs like Vercel Cron or external schedulers)
 * 2. Authenticated Admin / Owner user session bearer token (scoped to user's organization)
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  const startTime = Date.now();

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    const bearerToken = authHeader && typeof authHeader === 'string'
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : '';

    if (!bearerToken) {
      return res.status(401).json({
        error: 'Unauthorized: Missing Authorization header with Bearer token.',
      });
    }

    const isProd =
      process.env.NODE_ENV === 'production' || process.env.VITE_APP_ENV === 'production';
    const configuredCronSecret = process.env.CRON_SECRET;

    // Fail closed in production if CRON_SECRET is missing or weak
    if (isProd && (!configuredCronSecret || configuredCronSecret.length < 32)) {
      return res.status(500).json({
        error: 'Server Misconfiguration: CRON_SECRET is required in production.',
      });
    }

    // Fail closed in production if Supabase database configuration is missing
    if (isProd && !isRealSupabaseServerConfigured()) {
      return res.status(500).json({
        error: 'Server Misconfiguration: Supabase database connection is required in production.',
      });
    }

    // Timing-safe comparison against CRON_SECRET
    const isCronAuthorized = Boolean(
      configuredCronSecret && timingSafeCompare(bearerToken, configuredCronSecret)
    );

    let actingProfile: any = null;

    if (!isCronAuthorized) {
      // Check if bearer token is a valid administrative user session (OWNER or ADMIN)
      const { profile, error: authError } = await authenticateServerRequest(req);
      if (!authError && profile && (profile.role === 'OWNER' || profile.role === 'ADMIN')) {
        if (profile.status !== 'ACTIVE') {
          return res.status(403).json({
            error: 'Forbidden: Inactive or suspended account.',
          });
        }
        actingProfile = profile;
      } else {
        return res.status(401).json({
          error: 'Unauthorized: Missing or invalid CRON_SECRET or administrative session token.',
        });
      }
    }

    // Rejection of caller-supplied organization scope for scheduled automated runs
    const requestedOrgId = req.query?.organizationId || req.body?.organizationId;
    if (isCronAuthorized && requestedOrgId) {
      return res.status(400).json({
        error: 'Scheduled cron execution processes all tenant organizations and does not accept caller-supplied organization scope.',
      });
    }

    // Strict tenant isolation for user-session runs
    if (actingProfile && requestedOrgId && actingProfile.role !== 'ADMIN' && actingProfile.organization_id !== requestedOrgId) {
      return res.status(403).json({
        error: 'Forbidden: Cannot process follow-up reminders for another organization.',
      });
    }

    // Reference time for deterministic testing or delayed job reconciliation
    const rawRefTime = req.query?.referenceTime || req.body?.referenceTime;
    const referenceTime = rawRefTime ? new Date(rawRefTime) : new Date();

    if (isNaN(referenceTime.getTime())) {
      return res.status(400).json({ error: 'Invalid referenceTime provided.' });
    }

    // Resolve target organization scope
    let targetOrgId: string | undefined = undefined;
    if (actingProfile) {
      targetOrgId = actingProfile.role === 'ADMIN' ? (requestedOrgId || undefined) : actingProfile.organization_id;
    }

    // Execute persistent reminder engine
    const result = await processFollowUpReminders({
      referenceTime,
      targetOrganizationId: targetOrgId,
      supabaseClient: (req as any).supabaseClient,
    });

    const executionMs = Date.now() - startTime;

    return res.status(result.success ? 200 : 500).json({
      success: result.success,
      message: result.success
        ? 'Follow-up reminders and overdue escalations processed successfully.'
        : 'Follow-up reminder processing completed with errors.',
      timestamp: result.timestamp,
      executionMs,
      remindedCount: result.remindedCount,
      overdueCount: result.overdueCount,
      escalatedCount: result.escalatedCount,
      emailStatus: result.emailStatus,
      errors: result.errors,
    });
  } catch (error: any) {
    // Sanitize error logging: never log authorization tokens or customer contact information
    console.error('Follow-up cron reminder failure:', error?.message || 'Unknown error');
    return res.status(500).json({
      error: error?.message || 'Internal Server Error during follow-up reminder processing.',
    });
  }
}
