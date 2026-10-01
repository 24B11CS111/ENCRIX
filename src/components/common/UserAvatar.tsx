import React from 'react';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  avatarUrl,
  size = 'md',
  className,
}) => {
  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base font-semibold',
  };

  const getInitials = (n: string) => {
    return n
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn(
          'rounded-full object-cover border border-slate-700 bg-slate-800',
          sizeClasses[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-medium',
        sizeClasses[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
};
