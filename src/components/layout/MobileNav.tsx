import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Calendar,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const MobileNav: React.FC = () => {
  const { profile } = useAuth();
  if (!profile || profile.role !== 'TELECALLER') return null;

  const links = [
    { to: '/telecaller', label: 'Home', icon: LayoutDashboard, end: true },
    { to: '/telecaller/leads', label: 'My Leads', icon: Users },
    { to: '/telecaller/calls', label: 'Calls', icon: PhoneCall },
    { to: '/telecaller/follow-ups', label: 'Follow-ups', icon: Calendar },
    { to: '/telecaller/performance', label: 'Stats', icon: BarChart3 },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 border-t border-[#DCE4EE] backdrop-blur-md px-2 py-1.5 flex items-center justify-around shadow-dropdown">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center py-1 px-2 rounded-[8px] text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-[#0B1F3A] font-bold bg-[#EAF2FB]'
                  : 'text-[#64748B] hover:text-[#0B1F3A]'
              )
            }
          >
            <Icon className="w-5 h-5 mb-0.5" />
            <span>{link.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};
