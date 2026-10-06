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
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Platform Security Operations Center</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Global threat monitoring, unassigned lead access attempts, and export prevention telemetry.
        </p>
      </div>

      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden divide-y divide-[#DCE4EE] shadow-sm">
        {events.map((evt) => (
          <div key={evt.id} className="p-4 hover:bg-[#F6F8FB]/60 transition-colors space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    evt.severity === 'HIGH' || evt.severity === 'CRITICAL'
                      ? 'bg-rose-50 text-[#C53030] border border-rose-200'
                      : 'bg-amber-50 text-[#B7791F] border border-amber-200'
                  }`}
                >
                  {evt.severity}
                </span>
                <span className="font-semibold text-[#172B4D]">{evt.event_type}</span>
                <span className="text-[#64748B]">Org: {evt.organization_id}</span>
              </div>
              <span className="text-[#64748B] font-mono text-[11px]">{formatDateTime(evt.created_at)}</span>
            </div>
            <p className="text-[#64748B]">{evt.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
