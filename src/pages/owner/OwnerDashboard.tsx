import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, FollowUp, Profile, SecurityEvent } from '@/types';
import {
  Users,
  UserCheck,
  PhoneCall,
  Calendar,
  TrendingUp,
  ArrowUpRight,
  Upload,
  ShieldAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
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
import { EmptyState } from '@/components/common/EmptyState';
import { formatRelativeTime } from '@/lib/utils';

export const OwnerDashboard: React.FC = () => {
  const { profile, organization } = useAuth();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);

  const loadData = () => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setFollowUps(db.getFollowUps(profile));
    setTelecallers(db.getTelecallers(profile));
    setSecurityEvents(db.getSecurityEvents(profile));
  };

  useEffect(() => {
    loadData();

    // Supabase Realtime Subscription: updates dashboard immediately without page refresh
    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEAD_CREATED' ||
        type === 'LEADS_IMPORTED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_RECORDED' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'FOLLOWUP_CREATED' ||
        type === 'SECURITY_EVENT_RAISED' ||
        type === 'SANDBOX_RESET'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const totalLeads = leads.length;
  const assignedLeads = leads.filter((l) => l.assigned_to).length;
  const unassignedLeads = totalLeads - assignedLeads;

  // Calls today (within last 24h)
  const oneDayAgo = new Date(Date.now() - 86400000);
  const callsToday = calls.filter((c) => new Date(c.created_at) > oneDayAgo).length;

  const conversions = leads.filter(
    (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
  ).length;
  const activeFollowUps = followUps.filter((f) => f.status === 'PENDING').length;
  const securityCount = securityEvents.length;

  // Chart data: Outcome distribution
  const outcomeStats = [
    { name: 'Interested', value: leads.filter((l) => l.status === 'INTERESTED').length, color: '#1E4D8F' },
    { name: 'Converted', value: leads.filter((l) => l.status === 'CONVERTED').length, color: '#16845B' },
    { name: 'Follow-Up', value: leads.filter((l) => l.status === 'FOLLOW_UP').length, color: '#B7791F' },
    { name: 'Contacted', value: leads.filter((l) => l.status === 'CONTACTED').length, color: '#0B1F3A' },
    { name: 'Not Interested', value: leads.filter((l) => l.status === 'NOT_INTERESTED').length, color: '#64748B' },
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

  const firstName = profile?.full_name?.split(' ')[0] || 'Leader';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">
            Good morning, {firstName}
          </h1>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Monitor your lead operations and team activity.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate('/owner/import')}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Leads</span>
          </button>
          <button
            onClick={() => navigate('/owner/assignments')}
            className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] text-xs font-medium rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-colors"
          >
            <UserCheck className="w-3.5 h-3.5 text-[#1E4D8F]" />
            <span>Distribute Queue</span>
          </button>
        </div>
      </div>

      {/* STATS CARDS (Section 6 of spec) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card">
          <div className="flex items-center justify-between text-[#64748B] mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">TOTAL LEADS</span>
            <Users className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{totalLeads}</div>
          <div className="text-[11px] text-[#64748B] mt-1 flex items-center gap-1">
            <span>{assignedLeads} assigned</span>
            <span>•</span>
            <span>{unassignedLeads} unassigned</span>
          </div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card">
          <div className="flex items-center justify-between text-[#64748B] mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">ACTIVE CALLS</span>
            <PhoneCall className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{callsToday}</div>
          <div className="text-[11px] text-[#16845B] mt-1">Logged within last 24h</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card">
          <div className="flex items-center justify-between text-[#64748B] mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">FOLLOW-UPS</span>
            <Calendar className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{activeFollowUps}</div>
          <div className="text-[11px] text-[#B7791F] mt-1">Pending callbacks</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card">
          <div className="flex items-center justify-between text-[#64748B] mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">CONVERSIONS</span>
            <TrendingUp className="w-4 h-4 text-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{conversions}</div>
          <div className="text-[11px] text-[#16845B] mt-1">Interested & converted</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-[#64748B] mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider">SECURITY EVENTS</span>
            <ShieldAlert className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{securityCount}</div>
          <div className="text-[11px] text-[#16845B] mt-1">Protected by RLS</div>
        </div>
      </div>

      {/* CHARTS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Telecaller Activity Comparison */}
        <div className="lg:col-span-2 p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#0B1F3A]">Telecaller Performance & Queue</h2>
              <p className="text-[11px] text-[#64748B]">Assigned leads, calls logged & positive outcomes</p>
            </div>
            <button
              onClick={() => navigate('/owner/team')}
              className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold flex items-center gap-1"
            >
              <span>Manage Team</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            {telecallerData.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No telecallers yet"
                description="Add team members to see queue and performance metrics."
                actionText="Manage Team"
                onAction={() => navigate('/owner/team')}
                className="w-full border-none shadow-none p-4"
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={telecallerData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#64748B" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#DCE4EE', borderRadius: '10px', fontSize: '12px', boxShadow: '0 4px 16px rgba(11, 31, 58, 0.08)', color: '#172B4D' }}
                  />
                  <Bar dataKey="assigned" fill="#0B1F3A" name="Assigned" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="calls" fill="#1E4D8F" name="Calls" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="positive" fill="#16845B" name="Positive" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Lead Outcome Distribution */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#0B1F3A]">Lead Pipeline Funnel</h2>
            <p className="text-[11px] text-[#64748B]">Status breakdown across active database</p>
          </div>

          <div className="h-44 w-full my-auto flex items-center justify-center">
            {totalLeads === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No pipeline data"
                description="Status breakdown will appear when leads are ingested."
                className="w-full border-none shadow-none p-2"
              />
            ) : (
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
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#DCE4EE', borderRadius: '10px', fontSize: '12px', boxShadow: '0 4px 16px rgba(11, 31, 58, 0.08)', color: '#172B4D' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[#DCE4EE]">
            {outcomeStats.slice(0, 4).map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[#172B4D]">{item.name}</span>
                </div>
                <span className="font-semibold text-[#0B1F3A]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RECENT LEADS & RECENT CALLS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Leads */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#0B1F3A]">Recent Ingested Leads</h3>
            <button
              onClick={() => navigate('/owner/leads')}
              className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold"
            >
              View All ({leads.length})
            </button>
          </div>

          {leads.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No leads yet"
              description="Import your first lead list to start assigning leads."
              actionText="Import Leads"
              onAction={() => navigate('/owner/import')}
            />
          ) : (
            <div className="divide-y divide-[#DCE4EE]">
              {leads.slice(0, 5).map((lead) => (
                <div key={lead.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[#0B1F3A]">{lead.lead_code}</span>
                      <span className="text-[#172B4D] font-medium">{lead.name}</span>
                    </div>
                    <div className="text-[11px] text-[#64748B] font-mono mt-0.5">{lead.phone} • {lead.source}</div>
                  </div>
                  <StatusBadge status={lead.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Call Activity */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#0B1F3A]">Live Call Feed</h3>
            <button
              onClick={() => navigate('/owner/calls')}
              className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold"
            >
              All Calls ({calls.length})
            </button>
          </div>

          {calls.length === 0 ? (
            <EmptyState
              icon={PhoneCall}
              title="No calls yet"
              description="Call activity will appear here once your telecallers begin outreach."
            />
          ) : (
            <div className="divide-y divide-[#DCE4EE]">
              {calls.slice(0, 5).map((call) => (
                <div key={call.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#EAF2FB] border border-[#C7DCF3] flex items-center justify-center text-[#1E4D8F]">
                      <PhoneCall className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-[#0B1F3A] font-medium">
                        {call.telecaller_name || 'Telecaller'} called {call.lead_name || 'Customer'}
                      </div>
                      <div className="text-[11px] text-[#64748B]">
                        Duration: {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s • {call.outcome || 'Logged'}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-[#94A3B8] whitespace-nowrap">
                    {formatRelativeTime(call.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
