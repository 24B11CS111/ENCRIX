import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, FollowUp } from '@/types';
import { formatDuration } from '@/lib/utils';
import {
  PhoneCall,
  CheckCircle,
  XCircle,
  Calendar,
  Clock,
  TrendingUp,
  Award,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

export const TelecallerPerformancePage: React.FC = () => {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);

  useEffect(() => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setFollowUps(db.getFollowUps(profile));
  }, [profile]);

  // Section 35 Metrics for this telecaller
  const totalCalls = calls.length;
  const connectedCalls = calls.filter((c) => c.status === 'COMPLETED').length;
  const positive = leads.filter((l) => l.status === 'INTERESTED').length;
  const conversions = leads.filter((l) => l.status === 'CONVERTED').length;
  const negative = leads.filter((l) => l.status === 'NOT_INTERESTED').length;
  const scheduledFollowUps = followUps.length;

  const totalAssigned = leads.length;
  const conversionRate = totalAssigned > 0 ? Math.round(((positive + conversions) / totalAssigned) * 100) : 0;

  const avgDuration =
    totalCalls > 0
      ? Math.round(calls.reduce((acc, c) => acc + c.duration_seconds, 0) / totalCalls)
      : 0;

  const pieData = [
    { name: 'Positive/Interested', value: positive + conversions, color: '#16845B' },
    { name: 'Negative', value: negative, color: '#C53030' },
    { name: 'In Progress / New', value: Math.max(0, totalAssigned - positive - conversions - negative), color: '#1E4D8F' },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Personal Calling Performance</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Confidential metrics & conversion score for {profile?.full_name}.
        </p>
      </div>

      {/* METRICS GRID (Section 35) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Total Calls Placed</span>
          <span className="text-2xl font-bold text-[#0B1F3A]">{totalCalls}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Connected Calls</span>
          <span className="text-2xl font-bold text-[#16845B]">{connectedCalls}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Positive Leads</span>
          <span className="text-2xl font-bold text-[#16845B]">{positive}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Negative Calls</span>
          <span className="text-2xl font-bold text-[#C53030]">{negative}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Follow-ups Created</span>
          <span className="text-2xl font-bold text-[#B7791F]">{scheduledFollowUps}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Conversions</span>
          <span className="text-2xl font-bold text-[#16845B]">{conversions}</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Conversion Rate</span>
          <span className="text-2xl font-bold text-[#1E4D8F]">{conversionRate}%</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <span className="text-[11px] text-[#64748B] block mb-1">Avg Call Duration</span>
          <span className="text-2xl font-bold text-[#0B1F3A] font-mono">
            {formatDuration(avgDuration)}
          </span>
        </div>
      </div>

      {/* Outcome Breakdown Chart */}
      <div className="p-5 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-[#0B1F3A]">Lead Outcomes Breakdown</h2>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={4}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#DCE4EE', borderRadius: '8px', fontSize: '12px', color: '#172B4D', boxShadow: '0 4px 12px rgba(11,31,58,0.08)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-center gap-6 text-xs pt-2 border-t border-[#DCE4EE]">
          {pieData.map((item) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-[#172B4D] font-medium">{item.name}: {item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
