import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, FollowUp, Profile } from '@/types';
import {
  Users,
  UserCheck,
  UserX,
  PhoneCall,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingUp,
  ArrowUpRight,
  Upload,
  Plus,
  Headphones,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatRelativeTime } from '@/lib/utils';

export const OwnerDashboard: React.FC = () => {
  const { profile, organization } = useAuth();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);

  const loadData = () => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setFollowUps(db.getFollowUps(profile));
    setTelecallers(db.getTelecallers(profile));
  };

  useEffect(() => {
    loadData();

    // Supabase Realtime Subscription: updates dashboard immediately without page refresh!
    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEAD_CREATED' ||
        type === 'LEADS_IMPORTED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_RECORDED' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'FOLLOWUP_CREATED' ||
        type === 'SANDBOX_RESET'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  // Compute metrics specified in Section 8
  const totalLeads = leads.length;
  const assignedLeads = leads.filter((l) => l.assigned_to).length;
  const unassignedLeads = totalLeads - assignedLeads;

  // Calls today (within last 24h)
  const oneDayAgo = new Date(Date.now() - 86400000);
  const callsToday = calls.filter((c) => new Date(c.created_at) > oneDayAgo).length;

  const positiveLeads = leads.filter(
    (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
  ).length;
  const negativeLeads = leads.filter((l) => l.status === 'NOT_INTERESTED').length;
  const activeFollowUps = followUps.filter((f) => f.status === 'PENDING').length;
  const conversionRate = totalLeads > 0 ? Math.round((positiveLeads / totalLeads) * 100) : 0;

  // Chart data: Outcome distribution
  const outcomeStats = [
    { name: 'Interested', value: leads.filter((l) => l.status === 'INTERESTED').length, color: '#10b981' },
    { name: 'Converted', value: leads.filter((l) => l.status === 'CONVERTED').length, color: '#059669' },
    { name: 'Follow-Up', value: leads.filter((l) => l.status === 'FOLLOW_UP').length, color: '#f59e0b' },
    { name: 'Contacted', value: leads.filter((l) => l.status === 'CONTACTED').length, color: '#3b82f6' },
    { name: 'Not Interested', value: negativeLeads, color: '#64748b' },
  ];

  // Chart data: Telecaller performance comparison
  const telecallerData = telecallers.map((tc) => {
    const callerLeads = leads.filter((l) => l.assigned_to === tc.id);
    const callerCalls = calls.filter((c) => c.telecaller_id === tc.id);
    const callerPositives = callerLeads.filter(
      (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
    ).length;

    return {
      name: tc.full_name.split(' ')[0],
      assigned: callerLeads.length,
      calls: callerCalls.length,
      positive: callerPositives,
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Organization Overview</h1>
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              Real-time Active
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {organization?.name} • Controlled data access, live calling telemetry & telecaller queue.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/owner/import')}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Leads</span>
          </button>
          <button
            onClick={() => navigate('/owner/assignments')}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Distribute Queue</span>
          </button>
        </div>
      </div>

      {/* METRIC CARDS (Section 8 of spec) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Total Leads</span>
            <Users className="w-3.5 h-3.5" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{totalLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Assigned</span>
            <UserCheck className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-sky-400 tracking-tight">{assignedLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Unassigned</span>
            <UserX className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-400 tracking-tight">{unassignedLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Calls Today</span>
            <PhoneCall className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-400 tracking-tight">{callsToday}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Positive</span>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 tracking-tight">{positiveLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Negative</span>
            <XCircle className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-xl font-bold text-slate-400 tracking-tight">{negativeLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Follow-ups</span>
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-400 tracking-tight">{activeFollowUps}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Conversion</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{conversionRate}%</div>
        </div>
      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Telecaller Activity Comparison */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Telecaller Performance & Queue</h2>
              <p className="text-[11px] text-slate-400">Assigned leads, calls logged & positive outcomes</p>
            </div>
            <button
              onClick={() => navigate('/owner/team')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
            >
              <span>Manage Team</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={telecallerData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="assigned" fill="#38bdf8" name="Assigned" radius={[4, 4, 0, 0]} />
                <Bar dataKey="calls" fill="#a855f7" name="Calls" radius={[4, 4, 0, 0]} />
                <Bar dataKey="positive" fill="#10b981" name="Positive" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lead Outcome Distribution */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Lead Pipeline Funnel</h2>
            <p className="text-[11px] text-slate-400">Status breakdown across active database</p>
          </div>

          <div className="h-44 w-full my-auto">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={outcomeStats}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={68}
                  paddingAngle={3}
                >
                  {outcomeStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
            {outcomeStats.slice(0, 4).map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-slate-300">{item.name}</span>
                </div>
                <span className="font-semibold text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RECENT LEADS & RECENT CALLS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Leads */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Recent Ingested Leads</h3>
            <button
              onClick={() => navigate('/owner/leads')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              View All ({leads.length})
            </button>
          </div>

          <div className="divide-y divide-slate-800/60">
            {leads.slice(0, 5).map((lead) => (
              <div key={lead.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-white">{lead.lead_code}</span>
                    <span className="text-slate-300 font-medium">{lead.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{lead.phone} • {lead.source}</div>
                </div>
                <StatusBadge status={lead.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Live Call Activity */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Live Call Feed</h3>
            <button
              onClick={() => navigate('/owner/calls')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              All Calls ({calls.length})
            </button>
          </div>

          <div className="divide-y divide-slate-800/60">
            {calls.slice(0, 5).map((call) => (
              <div key={call.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <PhoneCall className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-white font-medium">
                      {call.telecaller_name || 'Telecaller'} called {call.lead_name || 'Customer'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Duration: {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s • {call.outcome || 'Logged'}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">
                  {formatRelativeTime(call.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
