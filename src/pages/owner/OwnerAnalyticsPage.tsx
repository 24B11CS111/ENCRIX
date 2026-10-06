import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, Profile } from '@/types';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { formatDuration } from '@/lib/utils';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle,
  Users,
  PhoneCall,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const OwnerAnalyticsPage: React.FC = () => {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);

  useEffect(() => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setTelecallers(db.getTelecallers(profile));
  }, [profile]);

  // Section 34 Metrics
  const totalLeads = leads.length;
  const assigned = leads.filter((l) => l.assigned_to).length;
  const contacted = leads.filter((l) => l.status === 'CONTACTED').length;
  const interested = leads.filter((l) => l.status === 'INTERESTED').length;
  const followUp = leads.filter((l) => l.status === 'FOLLOW_UP').length;
  const converted = leads.filter((l) => l.status === 'CONVERTED').length;
  const notInterested = leads.filter((l) => l.status === 'NOT_INTERESTED').length;

  const totalCalls = calls.length;
  const avgCallDuration =
    totalCalls > 0
      ? Math.round(calls.reduce((acc, c) => acc + c.duration_seconds, 0) / totalCalls)
      : 0;

  const conversionRate = totalLeads > 0 ? Math.round(((interested + converted) / totalLeads) * 100) : 0;

  // Chart 1: Lead Sources breakdown
  const sourceMap: Record<string, number> = {};
  leads.forEach((l) => {
    sourceMap[l.source] = (sourceMap[l.source] || 0) + 1;
  });
  const sourceData = Object.entries(sourceMap).map(([name, count]) => ({
    name,
    count,
  }));

  // Chart 2: Outcome breakdown
  const outcomeData = [
    { name: 'Interested', value: interested, color: '#10b981' },
    { name: 'Converted', value: converted, color: '#059669' },
    { name: 'Follow-Up', value: followUp, color: '#f59e0b' },
    { name: 'Contacted', value: contacted, color: '#38bdf8' },
    { name: 'Not Interested', value: notInterested, color: '#64748b' },
  ];

  // Chart 3: Telecaller Activity
  const telecallerActivityData = telecallers.map((tc) => {
    const callerCalls = calls.filter((c) => c.telecaller_id === tc.id);
    const pos = leads.filter((l) => l.assigned_to === tc.id && (l.status === 'INTERESTED' || l.status === 'CONVERTED')).length;
    return {
      name: tc.full_name.split(' ')[0],
      calls: callerCalls.length,
      positive: pos,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Organization Analytics & BI</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Real-time calling conversion funnel, agent productivity and marketing acquisition channels.
        </p>
      </div>

      {/* METRIC STRIP (Section 34) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Total Leads</span>
          <span className="text-2xl font-bold text-[#0B1F3A]">{totalLeads}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Interested + Converted</span>
          <span className="text-2xl font-bold text-[#16845B]">{interested + converted}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Total Calls Placed</span>
          <span className="text-2xl font-bold text-[#1E4D8F]">{totalCalls}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Avg Call Duration</span>
          <span className="text-2xl font-bold text-[#0B1F3A] font-mono">
            {formatDuration(avgCallDuration)}
          </span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Pipeline Conversion</span>
          <span className="text-2xl font-bold text-[#0B1F3A]">{conversionRate}%</span>
        </div>
      </div>

      {/* CHARTS GRID */}
      {totalLeads === 0 && totalCalls === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No Analytics Data Yet"
          description="Analytics, conversion funnels, and agent productivity charts will populate automatically once leads are added and calls are conducted."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Source acquisition */}
          <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-[#0B1F3A]">Lead Acquisition Sources</h2>
            <div className="h-64 w-full">
              {sourceData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[#64748B]">
                  No lead sources recorded yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceData} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <XAxis type="number" stroke="#64748B" fontSize={11} />
                    <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={11} width={90} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#DCE4EE', borderRadius: '8px', fontSize: '12px', color: '#172B4D', boxShadow: '0 4px 12px rgba(11,31,58,0.08)' }}
                    />
                    <Bar dataKey="count" fill="#1E4D8F" radius={[0, 4, 4, 0]} name="Leads" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Telecaller Activity Chart */}
          <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-[#0B1F3A]">Telecaller Productive Output</h2>
            <div className="h-64 w-full">
              {telecallerActivityData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[#64748B]">
                  No telecaller activity recorded yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={telecallerActivityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" stroke="#64748B" fontSize={11} />
                    <YAxis stroke="#64748B" fontSize={11} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#DCE4EE', borderRadius: '8px', fontSize: '12px', color: '#172B4D', boxShadow: '0 4px 12px rgba(11,31,58,0.08)' }}
                    />
                    <Bar dataKey="calls" fill="#1E4D8F" name="Calls Placed" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="positive" fill="#16845B" name="Positive Leads" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
