import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Call, FollowUp } from '@/types';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import { StudentDetailModal } from '@/features/leads/StudentDetailModal';
import { formatRelativeTime } from '@/lib/utils';
import {
  Users,
  PhoneCall,
  CheckCircle,
  Calendar,
  Phone,
  Eye,
  ArrowRight,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';

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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

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
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  // Telecaller metrics
  const totalAssigned = assignedLeads.length;

  const oneDayAgo = new Date(Date.now() - 86400000);
  const callsToday = calls.filter((c) => new Date(c.created_at) > oneDayAgo).length;

  const positiveLeads = assignedLeads.filter(
    (l) => l.status === 'INTERESTED' || l.status === 'CONVERTED'
  ).length;

  const myFollowUps = followUps.filter(
    (f) => f.status !== 'COMPLETED' && f.status !== 'CANCELLED' && f.status !== 'RESCHEDULED'
  ).length;

  // Next lead in queue to call
  const nextLeadToCall = assignedLeads.find(
    (l) => l.status === 'ASSIGNED' || l.status === 'NEW' || l.status === 'FOLLOW_UP'
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#1E4D8F] font-semibold uppercase tracking-wider">
              Telecaller Workspace
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EAF7EE] border border-[#C3EBD0] text-[10px] font-medium text-[#16845B]">
              <Shield className="w-3 h-3" />
              Masking Active
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#0B1F3A] tracking-tight mt-1">
            Good day, {profile?.full_name?.split(' ')[0] || 'Agent'} 👋
          </h1>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Customer contact information is safeguarded. Calls are routed via secure telephony bridge.
          </p>
        </div>

        {nextLeadToCall && (
          <button
            onClick={() => setCallingLead(nextLeadToCall)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-bold rounded-[10px] shadow-card transition-all hover:scale-[1.01]"
          >
            <Phone className="w-4 h-4 text-white" />
            <span>START CALLING</span>
          </button>
        )}
      </div>

      {/* TODAY'S WORK CARD (Section 15 of spec) */}
      <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-card space-y-3">
        <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
          <span className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">TODAY'S WORK</span>
          <span className="text-xs text-[#64748B]">Real-time Telemetry</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
          <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <div className="flex items-center justify-between text-[#64748B] mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Assigned Leads</span>
              <Users className="w-4 h-4 text-[#1E4D8F]" />
            </div>
            <div className="text-2xl font-bold text-[#0B1F3A]">{totalAssigned}</div>
          </div>

          <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <div className="flex items-center justify-between text-[#64748B] mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Calls Completed</span>
              <PhoneCall className="w-4 h-4 text-[#1E4D8F]" />
            </div>
            <div className="text-2xl font-bold text-[#0B1F3A]">{callsToday}</div>
          </div>

          <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <div className="flex items-center justify-between text-[#64748B] mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Follow-ups</span>
              <Calendar className="w-4 h-4 text-[#B7791F]" />
            </div>
            <div className="text-2xl font-bold text-[#B7791F]">{myFollowUps}</div>
          </div>

          <div className="p-3 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <div className="flex items-center justify-between text-[#64748B] mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Positive Leads</span>
              <CheckCircle className="w-4 h-4 text-[#16845B]" />
            </div>
            <div className="text-2xl font-bold text-[#16845B]">{positiveLeads}</div>
          </div>
        </div>
      </div>

      {/* MY LEADS QUEUE */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#0B1F3A] uppercase tracking-wider">My Assigned Leads Queue</h2>
            <p className="text-[11px] text-[#64748B]">
              Only leads assigned directly to your bucket are visible.
            </p>
          </div>

          <button
            onClick={() => navigate('/telecaller/leads')}
            className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold flex items-center gap-1"
          >
            <span>View All ({assignedLeads.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Lead Cards Grid */}
        {assignedLeads.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No Leads Assigned Yet"
            description="Leads assigned to you by your team manager will appear here in real-time ready to call."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {assignedLeads.slice(0, 8).map((lead) => (
              <div
                key={lead.id}
                className="p-4 rounded-[12px] border border-[#DCE4EE] bg-white hover:border-[#1E4D8F] shadow-card transition-all flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-mono text-xs font-bold text-[#1E4D8F]">
                      {lead.lead_code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <PriorityBadge priority={lead.priority} />
                      <StatusBadge status={lead.status} />
                    </div>
                  </div>

                  {/* Student Name & Voice Bridge Indicator */}
                  <h3 className="text-base font-bold text-[#0B1F3A] tracking-tight">{lead.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-[#64748B] mt-1">
                    <span className="inline-flex items-center gap-1 font-medium text-[11px] text-[#1E4D8F] bg-[#EAF2FB] px-2 py-0.5 rounded border border-[#C7DCF3]">
                      <ShieldCheck className="w-3 h-3 text-[#1E4D8F]" />
                      Voice Bridge
                    </span>
                    <span className="text-[#DCE4EE]">•</span>
                    <span>{lead.source}</span>
                  </div>

                  {lead.notes && (
                    <p className="text-xs text-[#172B4D] line-clamp-2 mt-2 bg-[#F6F8FB] p-2.5 rounded-[8px] border border-[#DCE4EE]">
                      {lead.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#DCE4EE]">
                  <span className="text-[11px] text-[#64748B]">
                    Last: {formatRelativeTime(lead.last_contacted_at || undefined)}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setIsDetailOpen(true);
                      }}
                      className="p-2 rounded-[8px] bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-xs transition-colors shadow-subtle"
                      title="View Student Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setCallingLead(lead)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-subtle transition-all"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Now</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
          lead={callingLead || assignedLeads[0]}
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

      {/* SECURE STUDENT DETAIL MODAL */}
      <StudentDetailModal
        leadId={selectedLeadId}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedLeadId(null);
        }}
        onInitiateCall={(leadId) => {
          const target = assignedLeads.find((l) => l.id === leadId);
          if (target) {
            setCallingLead(target);
          }
        }}
      />
    </div>
  );
};
