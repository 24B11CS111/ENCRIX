import React from 'react';
import { cn } from '@/lib/utils';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => {
  return <div className={cn('animate-pulse rounded bg-slate-800/80', className)} />;
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2 border-b border-slate-800/60 last:border-0">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16 ml-auto" />
        </div>
      ))}
    </div>
  );
};
