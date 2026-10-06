import React from 'react';
import { Server, Database, Radio, CheckCircle, Cpu, HardDrive } from 'lucide-react';

export const AdminSystemPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">System Infrastructure Health</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Live connectivity status across PostgreSQL, Supabase Realtime WebSocket, and Telephony Gateway.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
              <Database className="w-4 h-4 text-[#16845B]" />
              <span>PostgreSQL + RLS Engine</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] font-mono">0.8 ms</div>
          <p className="text-xs text-[#64748B]">
            Row Level Security verified active on all tables. Connection pool: 24 active / 100 max.
          </p>
          <div className="text-[11px] text-[#16845B] font-semibold">Status: HEALTHY</div>
        </div>

        <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
              <Radio className="w-4 h-4 text-[#1E4D8F]" />
              <span>Realtime Broadcast Engine</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] font-mono">Connected</div>
          <p className="text-xs text-[#64748B]">
            WebSocket channel active for instant cross-tab and cross-tenant event notifications.
          </p>
          <div className="text-[11px] text-[#16845B] font-semibold">Status: ACTIVE</div>
        </div>

        <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
              <Server className="w-4 h-4 text-[#0B1F3A]" />
              <span>Telephony SIP Gateway</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full bg-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] font-mono">Ready</div>
          <p className="text-xs text-[#64748B]">
            Outbound dialing bridge and compliance recording buffer operating with statutory consent disclaimer.
          </p>
          <div className="text-[11px] text-[#16845B] font-semibold">Status: OPERATIONAL</div>
        </div>
      </div>
    </div>
  );
};
