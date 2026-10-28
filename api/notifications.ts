import {
  authenticateServerRequest,
  getSupabaseServerClient,
  isRealSupabaseServerConfigured,
} from './_lib/supabaseServer.js';
import { db } from '../src/services/supabase/db.js';
import { sanitizeText } from '../src/lib/validation.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, PATCH, POST');
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

    // -------------------------------------------------------------------------
    // GET: List Current User's Notifications
    // -------------------------------------------------------------------------
    if (req.method === 'GET') {
      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();
        const { data, error } = await supabase
          .from('notifications')
          .select('id, organization_id, user_id, type, title, message, read, link, created_at')
          .eq('organization_id', orgId)
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          console.error('[notifications] Error loading notifications:', error.message);
          return res.status(500).json({ error: 'Failed to load notifications.' });
        }

        return res.status(200).json({
          success: true,
          notifications: data || [],
        });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Notification storage requires a configured database.' });
      }
      const notifications = db.getNotifications(profile as any);
      return res.status(200).json({
        success: true,
        notifications,
      });
    }

    // -------------------------------------------------------------------------
    // PATCH: Mark Notification(s) as Read
    // -------------------------------------------------------------------------
    if (req.method === 'PATCH') {
      const { id, all } = req.body || {};

      if (all !== true && (!id || typeof id !== 'string')) {
        return res.status(400).json({ error: 'Notification ID or "all: true" is required.' });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();

        if (all === true) {
          const { error } = await supabase
            .from('notifications')
            .update({ read: true })
            .eq('organization_id', orgId)
            .eq('user_id', profile.id)
            .eq('read', false);

          if (error) {
            console.error('[notifications] Error marking all notifications read:', error.message);
            return res.status(500).json({ error: 'Failed to update notifications.' });
          }

          return res.status(200).json({ success: true, markedAll: true });
        }

        if (!id || typeof id !== 'string') {
          return res.status(400).json({ error: 'Notification ID or "all: true" is required.' });
        }

        const { data: updated, error } = await supabase
          .from('notifications')
          .update({ read: true })
          .eq('id', id)
          .eq('organization_id', orgId)
          .eq('user_id', profile.id)
          .select()
          .maybeSingle();

        if (error) {
          console.error('[notifications] Error marking notification read:', error.message);
          return res.status(500).json({ error: 'Failed to update notification.' });
        }

        if (!updated) {
          return res.status(404).json({ error: 'Notification not found.' });
        }

        return res.status(200).json({ success: true, notification: updated });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Notification updates require a configured database.' });
      }
      if (all === true) {
        db.markAllNotificationsRead(profile as any);
      } else if (id) {
        db.markNotificationRead(id);
      }
      return res.status(200).json({ success: true });
    }

    // -------------------------------------------------------------------------
    // POST: Create Durable Notification (Internal / Admin / Triggered)
    // -------------------------------------------------------------------------
    if (req.method === 'POST') {
      const { userId, type, title, message, link } = req.body || {};

      if (!userId || !type || !title || !message) {
        return res.status(400).json({
          error: 'userId, type, title, and message are required fields.',
        });
      }

      if (isRealSupabaseServerConfigured()) {
        const supabase = getSupabaseServerClient();

        // Verify recipient belongs to the same organization
        const { data: recipient, error: recError } = await supabase
          .from('profiles')
          .select('id, organization_id')
          .eq('id', userId)
          .eq('organization_id', orgId)
          .maybeSingle();

        if (recError || !recipient) {
          return res.status(404).json({ error: 'Recipient user not found in organization.' });
        }

        const sanitizedTitle = sanitizeText(String(title));
        const sanitizedMsg = sanitizeText(String(message));

        const { data: created, error: insError } = await supabase
          .from('notifications')
          .insert({
            organization_id: orgId,
            user_id: userId,
            type: String(type),
            title: sanitizedTitle,
            message: sanitizedMsg,
            read: false,
            link: link ? String(link) : null,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insError) {
          console.error('[notifications] Error creating notification:', insError.message);
          return res.status(500).json({ error: 'Failed to create notification.' });
        }

        return res.status(201).json({ success: true, notification: created });
      }

      // Offline / Test Fallback
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Notification creation requires a configured database.' });
      }
      const created = db.createNotification({
        organization_id: orgId,
        user_id: userId,
        type: type as any,
        title: title,
        message: message,
        link: link,
      });

      return res.status(201).json({ success: true, notification: created });
    }
  } catch (error: any) {
    console.error('[notifications] Unexpected handler error:', error?.message || error);
    return res.status(500).json({ error: 'Internal server error processing notifications.' });
  }
}
