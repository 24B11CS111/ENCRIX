import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { FollowUp, Lead } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import { Calendar, Clock, CheckCircle, Phone } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const TelecallerFollowUpsPage: React.FC = () => {
  const { profile } = useAuth();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setFollowUps(db.getFollowUps(profile));
    setLeads(db.getLeads(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'FOLLOWUP_CREATED' || type === 'FOLLOWUP_UPDATED' || type === 'CALL_OUTCOME_SAVED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const handleComplete = (id: string) => {
    if (!profile) return;
    db.completeFollowUp(id, profile);
    loadData();
  };

  const handleCallFromFollowUp = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (lead) {
      setCallingLead(lead);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">My Follow-Up Schedule</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Stay on top of scheduled customer callbacks and intake appointments.
        </p>
      </div>

      {/* LIST */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="divide-y divide-[#DCE4EE]">
          {followUps.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Calendar}
                title="No Follow-Ups Scheduled"
                description="Follow-up callbacks scheduled after your calls will appear here in chronological order."
              />
            </div>
          ) : (
            followUps.map((fup) => (
              <div
                key={fup.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F8FB]/60 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#1E4D8F]">
                      {fup.lead_code}
                    </span>
                    <span className="text-sm font-semibold text-[#172B4D]">{fup.lead_name}</span>
                    <PriorityBadge priority={fup.priority} />
                  </div>

                  <p className="text-xs text-[#172B4D] bg-[#F6F8FB] p-2 rounded-[8px] border border-[#DCE4EE]">
                    {fup.notes || 'Scheduled customer callback'}
                  </p>

                  <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
                    <Clock className="w-3 h-3 text-[#64748B]" />
                    <span>{formatDateTime(fup.scheduled_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    onClick={() => handleCallFromFollowUp(fup.lead_id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Call Now</span>
                  </button>

                  {fup.status === 'PENDING' && (
                    <button
                      onClick={() => handleComplete(fup.id)}
                      className="px-2.5 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-xs font-medium rounded-[8px] transition-colors shadow-sm"
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
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

      {/* OUTCOME MODAL */}
      {isOutcomeOpen && completedCallId && (
        <OutcomeModal
          lead={callingLead || leads[0]}
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
    </div>
  );
};
