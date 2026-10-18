import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import {
  Shield,
  Bell,
  LogOut,
  Building,
  Calendar,
  CheckCheck,
  Check,
  AlertTriangle,
  UserCheck,
} from 'lucide-react';
import { db } from '@/services/supabase/db';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { RealtimeStatusBadge } from '@/components/common/RealtimeStatusBadge';
import { Notification } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export const Navbar: React.FC = () => {
  const { profile, organization, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<{
    label: string;
    color: 'green' | 'amber' | 'neutral';
    title: string;
  }>({
    label: 'System Secure',
    color: 'green',
    title: 'Tenant Isolation and Data Protection Active',
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile) {
      setSecurityStatus({
        label: 'Unverified',
        color: 'neutral',
        title: 'Authentication session required',
      });
      return;
    }

    realtimeManager.setOrganization(profile.organization_id);
    setNotifications(db.getNotifications(profile));

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'NEW_NOTIFICATION' ||
        type === 'NOTIFICATION_READ' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'SECURITY_EVENT_RAISED' ||
        type === 'FOLLOWUP_CREATED' ||
        type === 'FOLLOWUP_UPDATED' ||
        type === 'FOLLOWUP_REMINDER_SENT'
      ) {
        setNotifications(db.getNotifications(profile));
      }
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  // Truthful Security Status: Backed by real health, anomaly checks and active profile status
  useEffect(() => {
    if (!profile) return;

    if (typeof window !== 'undefined' && !navigator.onLine) {
      setSecurityStatus({
        label: 'Offline Guard',
        color: 'neutral',
        title: 'Connection offline — Row-Level Protection maintained locally',
      });
      return;
    }

    const events = db.getSecurityEvents(profile);
    const hasCriticalAnomaly = events.some(
      (e) => e.severity === 'CRITICAL' || e.severity === 'HIGH'
    );

    if (hasCriticalAnomaly) {
      setSecurityStatus({
        label: 'Security Alert',
        color: 'amber',
        title: 'Security anomaly detected — review audit log',
      });
    } else if (profile.status === 'ACTIVE' && organization) {
      setSecurityStatus({
        label: 'System Secure',
        color: 'green',
        title: 'Tenant Isolation & Zero-Phone-Exposure Active',
      });
    } else {
      setSecurityStatus({
        label: 'Restricted',
        color: 'neutral',
        title: 'Profile status inactive or awaiting tenant assignment',
      });
    }
  }, [profile, organization, notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAsRead = (id: string, link?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    db.markNotificationRead(id);
    if (profile) setNotifications(db.getNotifications(profile));
    if (link) {
      navigate(link);
      setShowNotifications(false);
    }
  };

  const handleMarkAllAsRead = () => {
    if (!profile) return;
    db.markAllNotificationsRead(profile);
    setNotifications(db.getNotifications(profile));
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'FOLLOW_UP_DUE':
      case 'FOLLOW_UP_OVERDUE':
      case 'FOLLOW_UP_ESCALATED':
        return <Calendar className="w-3.5 h-3.5 text-[#1E4D8F]" />;
      case 'LEAD_ASSIGNED':
        return <UserCheck className="w-3.5 h-3.5 text-[#16845B]" />;
      case 'SECURITY_ALERT':
        return <AlertTriangle className="w-3.5 h-3.5 text-[#C53030]" />;
      default:
        return <Bell className="w-3.5 h-3.5 text-[#64748B]" />;
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#DCE4EE] bg-white px-4 md:px-6 shadow-subtle">
      {/* Brand & Organization */}
      <div className="flex items-center gap-4">
        <a href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#0B1F3A] text-white group-hover:bg-[#071A33] transition-colors shadow-subtle">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
              <span className="rounded-[6px] bg-[#EAF2FB] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E4D8F] border border-[#C7DCF3]">
                PROD
              </span>
            </div>
            <p className="text-[10px] text-[#64748B] -mt-0.5 hidden sm:block">Secure Telecaller CRM</p>
          </div>
        </a>

        {organization && (
          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-[#DCE4EE]">
            <Building className="w-4 h-4 text-[#64748B]" />
            <span className="text-xs font-semibold text-[#172B4D]">{organization.name}</span>
            <span className="text-[10px] text-[#64748B] bg-[#F6F8FB] px-1.5 py-0.5 rounded-[6px] border border-[#DCE4EE]">
              {organization.industry}
            </span>
          </div>
        )}
      </div>

      {/* Security Status, Realtime Live Status, Fast Role Switcher, Notifications & Profile */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Real-Time Connection Indicator */}
        <RealtimeStatusBadge />

        {/* Truthful Enterprise Security Indicator */}
        <div
          data-testid="navbar-security-indicator"
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
            securityStatus.color === 'green'
              ? 'bg-[#EAF7EE] border-[#C3EBD0] text-[#16845B]'
              : securityStatus.color === 'amber'
              ? 'bg-[#FEF6E7] border-[#F9E2B6] text-[#B4690E]'
              : 'bg-[#F6F8FB] border-[#DCE4EE] text-[#64748B]'
          }`}
          title={securityStatus.title}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              securityStatus.color === 'green'
                ? 'bg-[#16845B]'
                : securityStatus.color === 'amber'
                ? 'bg-[#B4690E]'
                : 'bg-[#94A3B8]'
            }`}
          />
          <span>● {securityStatus.label}</span>
        </div>

        {/* Notifications Center */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-[8px] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB] border border-transparent hover:border-[#DCE4EE] transition-all"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#1E4D8F] text-[10px] font-bold text-white shadow-subtle">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-[12px] border border-[#DCE4EE] bg-white shadow-dropdown z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#DCE4EE] bg-[#F6F8FB]">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[#0B1F3A]">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-[#1E4D8F] px-1.5 py-0.2 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-[#1E4D8F]">Event Stream</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllAsRead}
                      className="text-[10px] font-semibold text-[#1E4D8F] hover:text-[#0B1F3A] flex items-center gap-0.5 transition-colors pl-1.5 border-l border-[#DCE4EE]"
                      title="Mark all as read"
                    >
                      <CheckCheck className="w-3 h-3" />
                      <span>Read all</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-[#DCE4EE]">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#94A3B8]">No notifications yet.</div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleMarkAsRead(notif.id, notif.link)}
                      className={`p-3.5 hover:bg-[#F6F8FB] cursor-pointer transition-colors ${
                        !notif.read ? 'bg-[#EAF2FB]/50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="p-1 rounded bg-white border border-[#DCE4EE]">
                            {getNotificationIcon(notif.type)}
                          </span>
                          <span className="text-xs font-semibold text-[#0B1F3A]">{notif.title}</span>
                          {!notif.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#1E4D8F]" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-[#94A3B8] whitespace-nowrap">
                            {formatRelativeTime(notif.created_at)}
                          </span>
                          {!notif.read && (
                            <button
                              onClick={(e) => handleMarkAsRead(notif.id, undefined, e)}
                              className="p-1 text-[#64748B] hover:text-[#16845B] hover:bg-white rounded"
                              title="Mark as read"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#64748B] mt-1 line-clamp-2 pl-6">{notif.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-[#DCE4EE]">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-semibold text-[#0B1F3A]">{profile?.full_name}</div>
            <div className="text-[10px] text-[#1E4D8F] font-medium capitalize">{profile?.role.toLowerCase()}</div>
          </div>
          <button
            onClick={() => logout()}
            className="p-2 rounded-[8px] text-[#64748B] hover:text-[#C53030] hover:bg-[#FEECEB] border border-transparent hover:border-[#F8C8C6] transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
