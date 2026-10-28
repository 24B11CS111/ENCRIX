import { Notification, Profile } from '@/types';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';

class NotificationService {
  private getHeaders(): Record<string, string> {
    const token = authService.getSessionToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async getNotifications(profile?: Profile | null): Promise<Notification[]> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      return db.getNotifications(profile);
    }

    try {
      const response = await fetch('/api/notifications', {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const data = await response.json();
      return data.notifications || [];
    } catch (error) {
      if (profile) {
        return db.getNotifications(profile);
      }
      throw error;
    }
  }

  public async markAsRead(id: string, profile?: Profile | null): Promise<boolean> {
    const token = authService.getSessionToken();
    if (!token) {
      db.markNotificationRead(id);
      return true;
    }

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error(`Failed to mark notification read: ${response.status}`);
      }

      db.markNotificationRead(id);
      return true;
    } catch (error) {
      db.markNotificationRead(id);
      return true;
    }
  }

  public async markAllAsRead(profile?: Profile | null): Promise<boolean> {
    const token = authService.getSessionToken();
    if (!token && profile) {
      db.markAllNotificationsRead(profile);
      return true;
    }

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ all: true }),
      });

      if (!response.ok) {
        throw new Error(`Failed to mark all notifications read: ${response.status}`);
      }

      if (profile) {
        db.markAllNotificationsRead(profile);
      }
      return true;
    } catch (error) {
      if (profile) {
        db.markAllNotificationsRead(profile);
      }
      return true;
    }
  }
}

export const notificationService = new NotificationService();
