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
        return 'text-[#C53030] bg-[#FEECEB] border-[#F8C8C6] font-semibold';
      case 'HIGH':
        return 'text-[#B7791F] bg-[#FEF6E7] border-[#FBDFA8]';
      case 'MEDIUM':
        return 'text-[#1E4D8F] bg-[#EAF2FB] border-[#C7DCF3]';
      case 'LOW':
        return 'text-[#64748B] bg-[#F1F5F9] border-[#E2E8F0]';
      default:
        return 'text-[#64748B] bg-[#F1F5F9] border-[#E2E8F0]';
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
