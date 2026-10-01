import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import {
  Shield,
  Bell,
  LogOut,
  ChevronDown,
  Building,
  CheckCircle2,
  RefreshCw,
  PhoneCall,
  User,
} from 'lucide-react';
import { db } from '@/services/supabase/db';
import { Notification } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export const Navbar: React.FC = () => {
  const { profile, organization, logout, quickLogin, isDemoMode } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [realtimeActive, setRealtimeActive] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile) return;
    setNotifications(db.getNotifications(profile));

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'NEW_NOTIFICATION' ||
        type === 'NOTIFICATION_READ' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'SECURITY_EVENT_RAISED'
      ) {
        setNotifications(db.getNotifications(profile));
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAsRead = (id: string, link?: string) => {
    db.markNotificationRead(id);
    if (link) {
      navigate(link);
      setShowNotifications(false);
    }
  };

  const handleRoleSwitch = (type: 'admin' | 'owner' | 'telecaller' | 'prime_owner') => {
    quickLogin(type);
    setShowRoleSwitcher(false);
    if (type === 'admin') navigate('/admin');
    else if (type === 'owner' || type === 'prime_owner') navigate('/owner');
    else navigate('/telecaller');
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 md:px-6 backdrop-blur-md">
      {/* Brand & Organization */}
      <div className="flex items-center gap-4">
        <a href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 group-hover:scale-105 transition-transform">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight text-white">LEADVAULT</span>
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                PROD
              </span>
            </div>
            <p className="text-[10px] text-slate-400 -mt-0.5 hidden sm:block">Secure Telecaller CRM</p>
          </div>
        </a>

        {organization && (
          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-slate-800">
            <Building className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-medium text-slate-300">{organization.name}</span>
            <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
              {organization.industry}
            </span>
          </div>
        )}
      </div>

      {/* Realtime state, Quick Role Switcher, Notifications & Profile */}
      <div className="flex items-center gap-3">
        {/* Real-time Indicator */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/20 text-[11px] text-emerald-400"
          title="Supabase Realtime Stream Connected"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Realtime Live</span>
        </div>

        {/* Demo Fast Role Switcher - STRICTLY REMOVED IN PRODUCTION */}
        {isDemoMode && (
          <div className="relative">
            <button
              onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white transition-all"
              title="Switch demo persona for testing"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="font-semibold text-white">Role: {profile?.role}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {showRoleSwitcher && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl z-50">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/80">
                  Switch Test Persona
                </div>

                <button
                  onClick={() => handleRoleSwitch('owner')}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">Vikram Malhotra (Owner)</div>
                    <div className="text-[11px] text-slate-400">Vertex Consultancy • Full Org Control</div>
                  </div>
                  {profile?.role === 'OWNER' && profile.organization_id === 'org-vertex-001' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                </button>

                <button
                  onClick={() => handleRoleSwitch('telecaller')}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">Arjun Kumar (Telecaller)</div>
                    <div className="text-[11px] text-slate-400">Masked Leads • Mobile Workspace</div>
                  </div>
                  {profile?.role === 'TELECALLER' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                </button>

                <button
                  onClick={() => handleRoleSwitch('admin')}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-white">System Admin</div>
                    <div className="text-[11px] text-slate-400">Platform-Wide Health & Tenant Audit</div>
                  </div>
                  {profile?.role === 'ADMIN' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                </button>

                <div className="my-1 border-t border-slate-800/60" />

                <button
                  onClick={() => handleRoleSwitch('prime_owner')}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-800/80 transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-medium text-amber-300">Rohan Verma (Tenant B Owner)</div>
                    <div className="text-[10px] text-slate-400">Prime Careers • Test Tenant Isolation</div>
                  </div>
                  {profile?.organization_id === 'org-prime-002' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Notifications Center */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-slate-950">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur-xl z-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <span className="text-xs font-semibold text-white">Notifications ({unreadCount} unread)</span>
                <span className="text-[11px] text-emerald-400">Realtime Feed</span>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">No notifications yet.</div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleMarkAsRead(notif.id, notif.link)}
                      className={`p-3.5 hover:bg-slate-800/50 cursor-pointer transition-colors ${
                        !notif.read ? 'bg-slate-800/30' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-white">{notif.title}</span>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">
                          {formatRelativeTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{notif.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-medium text-white">{profile?.full_name}</div>
            <div className="text-[10px] text-emerald-400 capitalize">{profile?.role.toLowerCase()}</div>
          </div>
          <button
            onClick={() => logout()}
            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-colors"
            title="Log Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
