import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import {
  Shield,
  Bell,
  LogOut,
  ChevronDown,
  Building,
  CheckCircle2,
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

      {/* Security Status, Fast Role Switcher, Notifications & Profile */}
      <div className="flex items-center gap-3">
        {/* Calm Enterprise Security Indicator */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#EAF7EE] border border-[#C3EBD0] text-[11px] font-medium text-[#16845B]"
          title="Tenant Isolation and Data Protection Active"
        >
          <span className="w-2 h-2 rounded-full bg-[#16845B]" />
          <span>● System Secure</span>
        </div>

        {/* Demo Fast Role Switcher - STRICTLY REMOVED IN PRODUCTION */}
        {isDemoMode && (
          <div className="relative">
            <button
              onClick={() => setShowRoleSwitcher(!showRoleSwitcher)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-white border border-[#DCE4EE] hover:border-[#CBD5E1] text-xs text-[#172B4D] hover:bg-[#F6F8FB] transition-all shadow-subtle"
              title="Switch demo persona for testing"
            >
              <span className="w-2 h-2 rounded-full bg-[#1E4D8F]" />
              <span className="font-semibold text-[#0B1F3A]">Role: {profile?.role}</span>
              <ChevronDown className="w-3.5 h-3.5 text-[#64748B]" />
            </button>

            {showRoleSwitcher && (
              <div className="absolute right-0 mt-2 w-72 rounded-[12px] border border-[#DCE4EE] bg-white p-2 shadow-dropdown z-50">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider border-b border-[#DCE4EE]">
                  Switch Test Persona
                </div>

                <button
                  onClick={() => handleRoleSwitch('owner')}
                  className="w-full text-left p-2.5 rounded-[8px] hover:bg-[#F6F8FB] transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#0B1F3A]">Vikram Malhotra (Owner)</div>
                    <div className="text-[11px] text-[#64748B]">Vertex Consultancy • Full Org Control</div>
                  </div>
                  {profile?.role === 'OWNER' && profile.organization_id === 'org-vertex-001' && (
                    <CheckCircle2 className="w-4 h-4 text-[#16845B]" />
                  )}
                </button>

                <button
                  onClick={() => handleRoleSwitch('telecaller')}
                  className="w-full text-left p-2.5 rounded-[8px] hover:bg-[#F6F8FB] transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#0B1F3A]">Arjun Kumar (Telecaller)</div>
                    <div className="text-[11px] text-[#64748B]">Masked Leads • Calling Workspace</div>
                  </div>
                  {profile?.role === 'TELECALLER' && <CheckCircle2 className="w-4 h-4 text-[#16845B]" />}
                </button>

                <button
                  onClick={() => handleRoleSwitch('admin')}
                  className="w-full text-left p-2.5 rounded-[8px] hover:bg-[#F6F8FB] transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#0B1F3A]">System Admin</div>
                    <div className="text-[11px] text-[#64748B]">Platform-Wide Health & Tenant Audit</div>
                  </div>
                  {profile?.role === 'ADMIN' && <CheckCircle2 className="w-4 h-4 text-[#16845B]" />}
                </button>

                <div className="my-1 border-t border-[#DCE4EE]" />

                <button
                  onClick={() => handleRoleSwitch('prime_owner')}
                  className="w-full text-left p-2 rounded-[8px] hover:bg-[#F6F8FB] transition-colors flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#B7791F]">Rohan Verma (Tenant B Owner)</div>
                    <div className="text-[10px] text-[#64748B]">Prime Careers • Test Tenant Isolation</div>
                  </div>
                  {profile?.organization_id === 'org-prime-002' && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#B7791F]" />
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
                <span className="text-xs font-semibold text-[#0B1F3A]">Notifications ({unreadCount} unread)</span>
                <span className="text-[11px] font-medium text-[#16845B]">Live Feed</span>
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
                        !notif.read ? 'bg-[#EAF2FB]/40' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-[#0B1F3A]">{notif.title}</span>
                        <span className="text-[10px] text-[#94A3B8] whitespace-nowrap">
                          {formatRelativeTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] mt-1 line-clamp-2">{notif.message}</p>
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
