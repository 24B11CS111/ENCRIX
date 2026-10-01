import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, FollowUp } from '@/types';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { formatRelativeTime } from '@/lib/utils';
import {
  Users,
  PhoneCall,
  CheckCircle,
  Calendar,
  TrendingUp,
  Phone,
  Eye,
  ShieldAlert,
  ArrowRight,
  Headphones,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const TelecallerDashboard: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [assignedLeads, setAssignedLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);

  // Active calling modal states
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  const loadData = () => {
    if (!profile) return;
    setAssignedLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setFollowUps(db.getFollowUps(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_RECORDED' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'FOLLOWUP_CREATED'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  // Telecaller metrics (Section 18)
  const totalAssigned = assignedLeads.length;

  const oneDayAgo = new Date(Date.now() - 86400000);
  const callsToday = calls.filter((c) => new Date(c.created_at) > oneDayAgo).length;

  const positiveLeads = assignedLeads.filter(
    (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
  ).length;

  const myFollowUps = followUps.filter((f) => f.status === 'PENDING').length;
  const conversionRate = totalAssigned > 0 ? Math.round((positiveLeads / totalAssigned) * 100) : 0;

  // Next lead in queue to call
  const nextLeadToCall = assignedLeads.find(
    (l) => l.status === 'ASSIGNED' || l.status === 'NEW' || l.status === 'FOLLOW_UP'
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Mobile-first Header Greeting (Section 18) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
            Telecaller Authorized Workspace
          </span>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-0.5">
            Good day, {profile?.full_name.split(' ')[0] || 'Agent'} 👋
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Data Masking Active: Customer contact information is safeguarded. Calls are routed via secure gateway.
          </p>
        </div>

        {nextLeadToCall && (
          <button
            onClick={() => setCallingLead(nextLeadToCall)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-950/50 transition-all hover:scale-[1.02]"
          >
            <Phone className="w-4 h-4" />
            <span>Call Next: {nextLeadToCall.lead_code}</span>
          </button>
        )}
      </div>

      {/* METRIC CARDS (Section 18) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Assigned</span>
            <Users className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-xl font-bold text-white">{totalAssigned}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Calls Today</span>
            <PhoneCall className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-400">{callsToday}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Positive</span>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400">{positiveLeads}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Follow-ups</span>
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-400">{myFollowUps}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-medium">Conversion</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white">{conversionRate}%</div>
        </div>
      </div>

      {/* SECTION 18: MY LEADS QUEUE */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">My Assigned Leads Queue</h2>
            <p className="text-[11px] text-slate-400">
              Only leads assigned directly to your bucket are visible.
            </p>
          </div>

          <button
            onClick={() => navigate('/telecaller/leads')}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
          >
            <span>View All ({assignedLeads.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lead Cards Grid (Mobile-friendly layout) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {assignedLeads.slice(0, 8).map((lead) => (
            <div
              key={lead.id}
              className="p-4 rounded-xl border border-slate-800 bg-slate-900/90 hover:border-slate-700 transition-all flex flex-col justify-between space-y-3"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-mono text-xs font-bold text-emerald-400">
                    {lead.lead_code}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <PriorityBadge priority={lead.priority} />
                    <StatusBadge status={lead.status} />
                  </div>
                </div>

                {/* Masked Name & Phone */}
                <h3 className="text-base font-bold text-white tracking-tight">{lead.name}</h3>
                <div className="flex items-center gap-3 text-xs text-slate-400 font-mono mt-1">
                  <span>{lead.phone}</span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-500">{lead.source}</span>
                </div>

                {lead.notes && (
                  <p className="text-xs text-slate-300 line-clamp-2 mt-2 bg-slate-950/40 p-2 rounded border border-slate-800/80">
                    {lead.notes}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <span className="text-[11px] text-slate-500">
                  Last: {formatRelativeTime(lead.last_contacted_at || undefined)}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDrawerLead(lead)}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
                    title="View Lead Details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setCallingLead(lead)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call Now</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ACTIVE CALL MODAL */}
      {callingLead && (
        <CallModal
          lead={callingLead}
          isOpen={Boolean(callingLead)}
          onClose={() => setCallingLead(null)}
          onCallCompleted={(callId) => {
            setCompletedCallId(callId);
            setCallingLead(null);
            setIsOutcomeOpen(true);
          }}
        />
      )}

      {/* CALL OUTCOME MODAL */}
      {isOutcomeOpen && completedCallId && (
        <OutcomeModal
          lead={callingLead || drawerLead || assignedLeads[0]}
          callId={completedCallId}
          isOpen={isOutcomeOpen}
          onClose={() => {
            setIsOutcomeOpen(false);
            setCompletedCallId(null);
          }}
          onSaved={() => {
            loadData();
          }}
        />
      )}

      {/* LEAD DETAILS DRAWER */}
      <LeadDrawer
        lead={drawerLead}
        isOpen={Boolean(drawerLead)}
        onClose={() => setDrawerLead(null)}
        onInitiateCall={(lead) => setCallingLead(lead)}
      />
    </div>
  );
};
