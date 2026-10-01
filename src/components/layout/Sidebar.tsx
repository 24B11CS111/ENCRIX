import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Calendar,
  BarChart3,
  ShieldCheck,
  Upload,
  UserCheck,
  Activity,
  Settings,
  Building2,
  Server,
  Headphones,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sidebar: React.FC = () => {
  const { profile } = useAuth();
  if (!profile) return null;

  const role = profile.role;

  const ownerLinks = [
    { to: '/owner', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/owner/leads', label: 'All Leads', icon: Users },
    { to: '/owner/import', label: 'Import Leads', icon: Upload },
    { to: '/owner/assignments', label: 'Assignments', icon: UserCheck },
    { to: '/owner/team', label: 'Team', icon: Headphones },
    { to: '/owner/calls', label: 'Calls', icon: PhoneCall },
    { to: '/owner/follow-ups', label: 'Follow-ups', icon: Calendar },
    { to: '/owner/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/owner/activity', label: 'Activity Log', icon: Activity },
    { to: '/owner/security', label: 'Security & Alerts', icon: ShieldCheck },
    { to: '/owner/settings', label: 'Settings', icon: Settings },
  ];

  const telecallerLinks = [
    { to: '/telecaller', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/telecaller/leads', label: 'My Leads', icon: Users },
    { to: '/telecaller/calls', label: 'My Calls', icon: PhoneCall },
    { to: '/telecaller/follow-ups', label: 'Follow-ups', icon: Calendar },
    { to: '/telecaller/performance', label: 'My Performance', icon: BarChart3 },
    { to: '/telecaller/profile', label: 'Profile', icon: Settings },
  ];

  const adminLinks = [
    { to: '/admin', label: 'Platform Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/activity', label: 'Platform Activity', icon: Activity },
    { to: '/admin/security', label: 'Security Audit', icon: ShieldCheck },
    { to: '/admin/system', label: 'System Health', icon: Server },
  ];

  const links = role === 'OWNER' ? ownerLinks : role === 'TELECALLER' ? telecallerLinks : adminLinks;

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-slate-800 bg-slate-950/60 p-4 shrink-0">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
        {role === 'OWNER' ? 'Organization Portal' : role === 'TELECALLER' ? 'Telecaller Workspace' : 'Platform Administration'}
      </div>

      <nav className="space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all group',
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                )
              }
            >
              <Icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Security posture card in sidebar */}
      <div className="mt-auto pt-4 border-t border-slate-900">
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-white">RLS Enforced</span>
          </div>
          <p className="text-[10px] text-slate-400">
            {role === 'TELECALLER'
              ? 'Raw phone numbers and surnames are masked at data layer.'
              : 'PostgreSQL Row Level Security active across all queries.'}
          </p>
        </div>
      </div>
    </aside>
  );
};
