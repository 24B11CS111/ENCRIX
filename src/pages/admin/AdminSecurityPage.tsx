import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { SecurityEvent } from '@/types';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

export const AdminSecurityPage: React.FC = () => {
  const { profile } = useAuth();
  const [events, setEvents] = useState<SecurityEvent[]>([]);

  useEffect(() => {
    if (!profile) return;
    setEvents(db.getSecurityEvents(profile));
  }, [profile]);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Platform Security Operations Center</h1>
        <p className="text-xs text-slate-400 mt-1">
          Global threat monitoring, unassigned lead access attempts, and export prevention telemetry.
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden divide-y divide-slate-800/60">
        {events.map((evt) => (
          <div key={evt.id} className="p-4 hover:bg-slate-800/40 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    evt.severity === 'HIGH' || evt.severity === 'CRITICAL'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {evt.severity}
                </span>
                <span className="font-semibold text-white">{evt.event_type}</span>
                <span className="text-slate-500">Org: {evt.organization_id}</span>
              </div>
              <span className="text-slate-400 font-mono text-[11px]">{formatDateTime(evt.created_at)}</span>
            </div>
            <p className="text-slate-300">{evt.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
