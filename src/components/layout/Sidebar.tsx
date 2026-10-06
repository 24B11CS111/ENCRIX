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

  const ownerSections = [
    {
      title: 'OVERVIEW',
      links: [
        { to: '/owner', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/owner/leads', label: 'Leads', icon: Users },
        { to: '/owner/import', label: 'Import Leads', icon: Upload },
        { to: '/owner/assignments', label: 'Assignments', icon: UserCheck },
        { to: '/owner/calls', label: 'Calls', icon: PhoneCall },
        { to: '/owner/follow-ups', label: 'Follow-ups', icon: Calendar },
      ],
    },
    {
      title: 'MANAGEMENT',
      links: [
        { to: '/owner/team', label: 'Team', icon: Headphones },
        { to: '/owner/analytics', label: 'Analytics', icon: BarChart3 },
        { to: '/owner/settings', label: 'Settings', icon: Settings },
      ],
    },
    {
      title: 'SECURITY',
      links: [
        { to: '/owner/activity', label: 'Activity', icon: Activity },
        { to: '/owner/security', label: 'Security', icon: ShieldCheck },
      ],
    },
  ];

  const telecallerSections = [
    {
      title: 'WORKFLOW',
      links: [
        { to: '/telecaller', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/telecaller/leads', label: 'My Leads', icon: Users },
        { to: '/telecaller/calls', label: 'My Calls', icon: PhoneCall },
        { to: '/telecaller/follow-ups', label: 'Follow-ups', icon: Calendar },
      ],
    },
    {
      title: 'PERFORMANCE',
      links: [
        { to: '/telecaller/performance', label: 'My Performance', icon: BarChart3 },
        { to: '/telecaller/profile', label: 'Profile', icon: Settings },
      ],
    },
  ];

  const adminSections = [
    {
      title: 'OVERVIEW',
      links: [
        { to: '/admin', label: 'Platform Overview', icon: LayoutDashboard, end: true },
        { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
        { to: '/admin/users', label: 'Users', icon: Users },
      ],
    },
    {
      title: 'SECURITY & SYSTEM',
      links: [
        { to: '/admin/activity', label: 'Platform Activity', icon: Activity },
        { to: '/admin/security', label: 'Security Audit', icon: ShieldCheck },
        { to: '/admin/system', label: 'System Health', icon: Server },
      ],
    },
  ];

  const sections =
    role === 'OWNER' ? ownerSections : role === 'TELECALLER' ? telecallerSections : adminSections;

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-[#DCE4EE] bg-white p-4 shrink-0 shadow-subtle">
      {/* ENCRIX Brand Header */}
      <div className="px-3 py-2 mb-4 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[8px] bg-[#0B1F3A] flex items-center justify-center text-white font-bold text-sm shadow-subtle">
          E
        </div>
        <div>
          <span className="text-base font-bold tracking-tight text-[#0B1F3A]">ENCRIX</span>
          <div className="text-[10px] text-[#64748B] font-medium tracking-wide">
            {role === 'OWNER' ? 'Organization Portal' : role === 'TELECALLER' ? 'Telecaller Workspace' : 'Platform Administration'}
          </div>
        </div>
      </div>

      <nav className="space-y-5 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider px-3 mb-1.5">
              {section.title}
            </div>
            <div className="space-y-0.5">
              {section.links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-xs font-medium transition-all group',
                        isActive
                          ? 'bg-[#EAF2FB] text-[#0B1F3A] font-semibold border-l-2 border-[#1E4D8F]'
                          : 'text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB]'
                      )
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0 text-inherit transition-transform group-hover:scale-105" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Security posture card in sidebar */}
      <div className="mt-auto pt-4 border-t border-[#DCE4EE]">
        <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle className="w-3.5 h-3.5 text-[#16845B]" />
            <span className="text-[11px] font-semibold text-[#0B1F3A]">RLS Enforced</span>
          </div>
          <p className="text-[10px] text-[#64748B] leading-relaxed">
            {role === 'TELECALLER'
              ? 'Raw phone numbers and surnames are masked at data layer.'
              : 'PostgreSQL Row Level Security active across all queries.'}
          </p>
        </div>
      </div>
    </aside>
  );
};
