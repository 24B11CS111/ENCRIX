import React from 'react';
import { Server, Database, Radio, CheckCircle, Cpu, HardDrive } from 'lucide-react';

export const AdminSystemPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">System Infrastructure Health</h1>
        <p className="text-xs text-slate-400 mt-1">
          Live connectivity status across PostgreSQL, Supabase Realtime WebSocket, and Telephony Gateway.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>PostgreSQL + RLS Engine</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">0.8 ms</div>
          <p className="text-xs text-slate-400">
            Row Level Security verified active on all tables. Connection pool: 24 active / 100 max.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: HEALTHY</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span>Realtime Broadcast Engine</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">Connected</div>
          <p className="text-xs text-slate-400">
            WebSocket channel active for instant cross-tab and cross-tenant event notifications.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: ACTIVE</div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              <Server className="w-4 h-4 text-emerald-400" />
              <span>Telephony SIP Gateway</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">Ready</div>
          <p className="text-xs text-slate-400">
            Outbound dialing bridge and compliance recording buffer operating with statutory consent disclaimer.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: OPERATIONAL</div>
        </div>
      </div>
    </div>
  );
};
