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
        return 'bg-[#EAF7EE] text-[#16845B] border-[#C3EBD0]';
      case 'CONVERTED':
        return 'bg-[#E4F4E9] text-[#16845B] border-[#A8E2BA] font-semibold';
      case 'ASSIGNED':
        return 'bg-[#EAF2FB] text-[#1E4D8F] border-[#C7DCF3]';
      case 'FOLLOW_UP':
        return 'bg-[#FEF6E7] text-[#B7791F] border-[#FBDFA8]';
      case 'CONTACTED':
        return 'bg-[#EBF3FB] text-[#1E4D8F] border-[#C7DCF3]';
      case 'NEW':
        return 'bg-[#F0F3F9] text-[#0B1F3A] border-[#DCE4EE] font-medium';
      case 'NOT_INTERESTED':
        return 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]';
      case 'INVALID':
        return 'bg-[#FEECEB] text-[#C53030] border-[#F8C8C6]';
      case 'DO_NOT_CONTACT':
        return 'bg-[#FEECEB] text-[#C53030] border-[#F8C8C6] font-semibold';
      default:
        return 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]';
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
