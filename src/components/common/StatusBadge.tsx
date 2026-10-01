import React from 'react';
import { LeadStatus } from '@/types';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: LeadStatus;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const getStyles = () => {
    switch (status) {
      case 'INTERESTED':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25';
      case 'CONVERTED':
        return 'bg-green-500/15 text-green-400 border-green-500/30 font-semibold';
      case 'ASSIGNED':
        return 'bg-sky-500/10 text-sky-400 border-sky-500/25';
      case 'FOLLOW_UP':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/25';
      case 'CONTACTED':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/25';
      case 'NEW':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/25';
      case 'NOT_INTERESTED':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
      case 'INVALID':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/25';
      case 'DO_NOT_CONTACT':
        return 'bg-red-500/15 text-red-400 border-red-500/30';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/25';
    }
  };

  const getLabel = () => {
    switch (status) {
      case 'DO_NOT_CONTACT':
        return 'DNC';
      case 'NOT_INTERESTED':
        return 'Not Interested';
      case 'FOLLOW_UP':
        return 'Follow-Up';
      default:
        return status.charAt(0) + status.slice(1).toLowerCase();
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors',
        getStyles(),
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 opacity-80" />
      {getLabel()}
    </span>
  );
};
