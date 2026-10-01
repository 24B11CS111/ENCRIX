import React from 'react';
import { LeadPriority } from '@/types';
import { cn } from '@/lib/utils';

interface PriorityBadgeProps {
  priority: LeadPriority;
  className?: string;
}

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority, className }) => {
  const getStyles = () => {
    switch (priority) {
      case 'URGENT':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'HIGH':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'MEDIUM':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'LOW':
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border uppercase tracking-wider',
        getStyles(),
        className
      )}
    >
      {priority}
    </span>
  );
};
