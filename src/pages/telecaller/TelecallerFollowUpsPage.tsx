import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { followUpService } from '@/services/followUps/followUpService';
import { FollowUp, Lead, LeadPriority } from '@/types';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import {
  Calendar,
  Clock,
  CheckCircle,
  Phone,
  Plus,
  RotateCcw,
  XCircle,
  AlertTriangle,
  History,
  Globe,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const TelecallerFollowUpsPage: React.FC = () => {
  const { profile } = useAuth();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'DUE_TODAY' | 'UPCOMING' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'>('DUE_TODAY');

  // Call Initiation & Outcome Modals
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);

  // Quick Schedule Modal State
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [scheduleLeadId, setScheduleLeadId] = useState('');
  const [scheduleDate, setScheduleDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [scheduleTime, setScheduleTime] = useState('11:00');
  const [schedulePriority, setSchedulePriority] = useState<LeadPriority>('MEDIUM');
  const [scheduleReason, setScheduleReason] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Reschedule Modal State
  const [reschedulingFup, setReschedulingFup] = useState<FollowUp | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [rescheduleTime, setRescheduleTime] = useState('11:00');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  // Completion Modal State
  const [completingFup, setCompletingFup] = useState<FollowUp | null>(null);
  const [completionOutcome, setCompletionOutcome] = useState<string>('COMPLETED');
  const [completionNotes, setCompletionNotes] = useState('');

  // Cancel Modal State
  const [cancellingFup, setCancellingFup] = useState<FollowUp | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const loadData = async () => {
    if (!profile) return;
    try {
      const serverFollowUps = await followUpService.getFollowUps(profile);
      setFollowUps(serverFollowUps);
    } catch {
      setFollowUps(db.getFollowUps(profile));
    }
    setLeads(db.getLeads(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'FOLLOWUP_CREATED' ||
        type === 'FOLLOWUP_UPDATED' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'LEADS_ASSIGNED'
      ) {
        loadData();
      }
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  // Tab Filtering
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  const dueTodayFollowUps = followUps.filter((f) => {
    if (f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED') return false;
    const time = new Date(f.scheduled_at).getTime();
    return f.status === 'DUE' || (time >= startOfToday && time <= endOfToday && f.status !== 'OVERDUE');
  });

  const upcomingFollowUps = followUps.filter((f) => {
    if (f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED') return false;
    const time = new Date(f.scheduled_at).getTime();
    return time > endOfToday && f.status !== 'OVERDUE';
  });

  const overdueFollowUps = followUps.filter((f) => f.status === 'OVERDUE');
  const completedFollowUps = followUps.filter((f) => f.status === 'COMPLETED');
  const cancelledFollowUps = followUps.filter((f) => f.status === 'CANCELLED');

  const currentList =
    activeTab === 'DUE_TODAY'
      ? dueTodayFollowUps
      : activeTab === 'UPCOMING'
      ? upcomingFollowUps
      : activeTab === 'OVERDUE'
      ? overdueFollowUps
      : activeTab === 'COMPLETED'
      ? completedFollowUps
      : cancelledFollowUps;

  // Preset Date Applier
  const applyPreset = (
    preset: '1H' | 'TOMORROW_10AM' | 'IN_2_DAYS' | 'NEXT_MONDAY',
    target: 'SCHEDULE' | 'RESCHEDULE'
  ) => {
    const d = new Date();
    let targetDate = '';
    let targetTime = '11:00';

    if (preset === '1H') {
      d.setHours(d.getHours() + 1);
      targetDate = d.toISOString().split('T')[0];
      targetTime = d.toTimeString().slice(0, 5);
    } else if (preset === 'TOMORROW_10AM') {
      d.setDate(d.getDate() + 1);
      targetDate = d.toISOString().split('T')[0];
      targetTime = '10:00';
    } else if (preset === 'IN_2_DAYS') {
      d.setDate(d.getDate() + 2);
      targetDate = d.toISOString().split('T')[0];
      targetTime = '11:00';
    } else if (preset === 'NEXT_MONDAY') {
      const daysUntilMonday = ((1 + 7 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMonday);
      targetDate = d.toISOString().split('T')[0];
      targetTime = '11:00';
    }

    if (target === 'SCHEDULE') {
      setScheduleDate(targetDate);
      setScheduleTime(targetTime);
    } else {
      setRescheduleDate(targetDate);
      setRescheduleTime(targetTime);
    }
  };

  const handleCallFromFollowUp = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (lead) {
      setCallingLead(lead);
    }
  };

  // Create Follow-Up Handler
  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setScheduleError(null);

    if (!scheduleLeadId) {
      setScheduleError('Please select a lead.');
      return;
    }

    try {
      const scheduledAt = `${scheduleDate}T${scheduleTime}:00Z`;
      db.createFollowUp(
        {
          lead_id: scheduleLeadId,
          scheduled_at: scheduledAt,
          priority: schedulePriority,
          reason: scheduleReason,
          notes: scheduleReason,
          timezone: displayTimezone,
        },
        profile
      );
      setIsScheduleOpen(false);
      setScheduleReason('');
      setScheduleLeadId('');
      loadData();
    } catch (err: any) {
      setScheduleError(err.message || 'Failed to schedule follow-up');
    }
  };

  // Reschedule Handler
  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !reschedulingFup) return;
    setRescheduleError(null);

    if (!rescheduleReason.trim()) {
      setRescheduleError('Reschedule reason is mandatory.');
      return;
    }

    try {
      const newScheduledAt = `${rescheduleDate}T${rescheduleTime}:00Z`;
      try {
        await followUpService.rescheduleFollowUp(
          reschedulingFup.id,
          newScheduledAt,
          rescheduleReason,
          profile
        );
      } catch {
        db.rescheduleFollowUp(
          reschedulingFup.id,
          newScheduledAt,
          rescheduleReason,
          profile
        );
      }
      setReschedulingFup(null);
      setRescheduleReason('');
      loadData();
    } catch (err: any) {
      setRescheduleError(err.message || 'Failed to reschedule follow-up');
    }
  };

  // Complete Handler
  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !completingFup) return;

    try {
      try {
        await followUpService.completeFollowUp(
          completingFup.id,
          completionOutcome,
          completionNotes,
          profile
        );
      } catch {
        db.completeFollowUp(
          completingFup.id,
          profile,
          completionNotes,
          completionOutcome
        );
      }
      setCompletingFup(null);
      setCompletionNotes('');
      loadData();
    } catch (err: any) {
      console.error('Failed to complete follow-up:', err);
    }
  };

  // Cancel Handler
  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !cancellingFup) return;
    setCancelError(null);

    if (!cancelReason.trim()) {
      setCancelError('Cancellation reason is mandatory.');
      return;
    }

    try {
      try {
        await followUpService.cancelFollowUp(cancellingFup.id, cancelReason, profile);
      } catch {
        db.cancelFollowUp(cancellingFup.id, cancelReason, profile);
      }
      setCancellingFup(null);
      setCancelReason('');
      loadData();
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel follow-up');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">My Follow-Up Workspace</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Manage scheduled callbacks, track due appointments, and prevent lead pipeline attrition.
          </p>
        </div>
        <button
          onClick={() => {
            if (leads.length > 0 && !scheduleLeadId) {
              setScheduleLeadId(leads[0].id);
            }
            setIsScheduleOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule Callback</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <button
          onClick={() => setActiveTab('DUE_TODAY')}
          className={`p-3.5 rounded-[10px] border text-left transition-all ${
            activeTab === 'DUE_TODAY'
              ? 'bg-white border-[#16845B] ring-1 ring-[#16845B] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Due Today</span>
            <Clock className="w-3.5 h-3.5 text-[#16845B]" />
          </div>
          <div className="text-xl font-bold text-[#16845B]">{dueTodayFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('OVERDUE')}
          className={`p-3.5 rounded-[10px] border text-left transition-all ${
            activeTab === 'OVERDUE'
              ? 'bg-white border-[#C53030] ring-1 ring-[#C53030] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#C53030]">Overdue</span>
            <AlertTriangle className="w-3.5 h-3.5 text-[#C53030]" />
          </div>
          <div className="text-xl font-bold text-[#C53030]">{overdueFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('UPCOMING')}
          className={`p-3.5 rounded-[10px] border text-left transition-all ${
            activeTab === 'UPCOMING'
              ? 'bg-white border-[#1E4D8F] ring-1 ring-[#1E4D8F] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Upcoming</span>
            <Calendar className="w-3.5 h-3.5 text-[#1E4D8F]" />
          </div>
          <div className="text-xl font-bold text-[#1E4D8F]">{upcomingFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('COMPLETED')}
          className={`p-3.5 rounded-[10px] border text-left transition-all ${
            activeTab === 'COMPLETED'
              ? 'bg-white border-[#64748B] ring-1 ring-[#64748B] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Completed</span>
            <CheckCircle className="w-3.5 h-3.5 text-[#64748B]" />
          </div>
          <div className="text-xl font-bold text-[#64748B]">{completedFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('CANCELLED')}
          className={`p-3.5 rounded-[10px] border text-left transition-all ${
            activeTab === 'CANCELLED'
              ? 'bg-white border-[#94A3B8] ring-1 ring-[#94A3B8] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Cancelled</span>
            <XCircle className="w-3.5 h-3.5 text-[#94A3B8]" />
          </div>
          <div className="text-xl font-bold text-[#94A3B8]">{cancelledFollowUps.length}</div>
        </button>
      </div>

      {/* Follow-Up Cards List */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="divide-y divide-[#DCE4EE]">
          {currentList.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Calendar}
                title={
                  activeTab === 'DUE_TODAY'
                    ? 'No Follow-Ups Due Today'
                    : activeTab === 'OVERDUE'
                    ? 'Great Job! Zero Overdue Follow-Ups'
                    : `No ${activeTab.toLowerCase().replace('_', ' ')} tasks found`
                }
                description={
                  activeTab === 'OVERDUE'
                    ? 'All scheduled callbacks are on track. Keep up the high responsiveness!'
                    : 'Scheduled customer callbacks assigned to you will appear here with dynamic status derivation.'
                }
              />
            </div>
          ) : (
            currentList.map((fup) => {
              const isOverdue = fup.status === 'OVERDUE';
              const isDueNow = fup.status === 'DUE';

              return (
                <div
                  key={fup.id}
                  className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                    isOverdue ? 'bg-[#FEECEB]/30' : isDueNow ? 'bg-[#FEF6E7]/30' : 'hover:bg-[#F6F8FB]/60'
                  }`}
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-[#1E4D8F]">
                        {fup.lead_code || 'ENC-Lead'}
                      </span>
                      <span className="text-sm font-semibold text-[#172B4D]">{fup.lead_name}</span>
                      <PriorityBadge priority={fup.priority} />

                      {/* Status Badges */}
                      {isOverdue && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold bg-[#FEECEB] border border-[#F8C8C6] text-[#C53030]">
                          <AlertTriangle className="w-3 h-3" /> OVERDUE
                        </span>
                      )}
                      {isDueNow && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold bg-[#FEF6E7] border border-[#F9E2B6] text-[#B4690E]">
                          <Clock className="w-3 h-3" /> DUE NOW
                        </span>
                      )}
                      {fup.status === 'COMPLETED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold bg-[#EAF7EE] border border-[#C3EBD0] text-[#16845B]">
                          <CheckCircle className="w-3 h-3" /> COMPLETED
                        </span>
                      )}
                      {fup.status === 'CANCELLED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-bold bg-[#F6F8FB] border border-[#DCE4EE] text-[#64748B]">
                          <XCircle className="w-3 h-3" /> CANCELLED
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[#172B4D] bg-[#F6F8FB] p-2.5 rounded-[8px] border border-[#DCE4EE]">
                      {fup.reason || fup.notes || 'Scheduled customer callback'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#64748B]">
                      <span className="flex items-center gap-1 font-mono text-[#1E4D8F]">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(fup.scheduled_at)}
                      </span>
                      <span>Relative: {formatRelativeTime(fup.scheduled_at)}</span>
                      <span className="flex items-center gap-1 font-mono text-[#64748B]">
                        <Globe className="w-3 h-3" /> {fup.timezone || displayTimezone}
                      </span>
                    </div>

                    {/* Reschedule History */}
                    {(fup.reschedule_count || 0) > 0 && (
                      <div className="flex items-center gap-1.5 text-[10px] text-[#B4690E] bg-[#FEF6E7] px-2.5 py-1 rounded-[6px] border border-[#F9E2B6] inline-flex">
                        <History className="w-3 h-3" />
                        <span>
                          Rescheduled {fup.reschedule_count} time(s). Last reason: &ldquo;{fup.reschedule_reason}&rdquo;
                        </span>
                      </div>
                    )}

                    {/* Outcome notes if completed */}
                    {fup.status === 'COMPLETED' && fup.outcome_notes && (
                      <div className="text-[11px] text-[#16845B] bg-[#EAF7EE] px-2.5 py-1 rounded-[6px] border border-[#C3EBD0]">
                        Outcome: <strong>{fup.outcome || 'Completed'}</strong> — {fup.outcome_notes}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                    {fup.status !== 'COMPLETED' && fup.status !== 'CANCELLED' && (
                      <>
                        <button
                          onClick={() => handleCallFromFollowUp(fup.lead_id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>Call Now</span>
                        </button>

                        <button
                          onClick={() => {
                            setCompletingFup(fup);
                            setCompletionNotes('');
                            setCompletionOutcome('COMPLETED');
                          }}
                          className="px-2.5 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#EAF7EE] hover:text-[#16845B] hover:border-[#C3EBD0] text-[#172B4D] text-xs font-medium rounded-[8px] transition-colors shadow-sm"
                        >
                          Complete
                        </button>

                        <button
                          onClick={() => {
                            setReschedulingFup(fup);
                            setRescheduleReason('');
                            setRescheduleError(null);
                          }}
                          className="px-2.5 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#EAF2FB] hover:text-[#1E4D8F] text-[#172B4D] text-xs font-medium rounded-[8px] transition-colors shadow-sm"
                        >
                          Reschedule
                        </button>

                        <button
                          onClick={() => {
                            setCancellingFup(fup);
                            setCancelReason('');
                            setCancelError(null);
                          }}
                          className="px-2.5 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#FEECEB] hover:text-[#C53030] text-[#64748B] text-xs font-medium rounded-[8px] transition-colors shadow-sm"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* SCHEDULE CALLBACK MODAL */}
      {isScheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B1F3A]">
                <Calendar className="w-4 h-4 text-[#1E4D8F]" />
                <span>Schedule Next Follow-Up</span>
              </div>
              <button
                onClick={() => setIsScheduleOpen(false)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            {scheduleError && (
              <div className="p-2.5 bg-[#FEECEB] border border-[#F8C8C6] text-[#C53030] text-xs rounded-[8px]">
                {scheduleError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Select Lead</label>
                <select
                  value={scheduleLeadId}
                  onChange={(e) => setScheduleLeadId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lead_code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Presets */}
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Quick Timing Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('1H', 'SCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    +1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('TOMORROW_10AM', 'SCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    Tomorrow 10 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('IN_2_DAYS', 'SCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    In 2 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('NEXT_MONDAY', 'SCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    Next Monday
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Time</label>
                  <input
                    type="time"
                    required
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Priority</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSchedulePriority(p)}
                      className={`py-1.5 rounded-[6px] text-xs font-semibold border transition-colors ${
                        schedulePriority === p
                          ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white'
                          : 'bg-white border-[#DCE4EE] text-[#64748B] hover:bg-[#F6F8FB]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Reason / Notes</label>
                <textarea
                  required
                  rows={2}
                  value={scheduleReason}
                  onChange={(e) => setScheduleReason(e.target.value)}
                  placeholder="Reason for scheduled callback..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>

              <div className="text-[11px] text-[#1E4D8F] bg-[#EAF2FB] p-2.5 rounded-[8px] flex items-center justify-between border border-[#C7DCF3]">
                <span>Scheduled for: {scheduleDate} at {scheduleTime}</span>
                <span className="font-mono text-[10px]">{displayTimezone}</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setIsScheduleOpen(false)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm"
                >
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESCHEDULE MODAL */}
      {reschedulingFup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B1F3A]">
                <RotateCcw className="w-4 h-4 text-[#1E4D8F]" />
                <span>Reschedule Follow-Up ({reschedulingFup.lead_code})</span>
              </div>
              <button
                onClick={() => setReschedulingFup(null)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            {rescheduleError && (
              <div className="p-2.5 bg-[#FEECEB] border border-[#F8C8C6] text-[#C53030] text-xs rounded-[8px]">
                {rescheduleError}
              </div>
            )}

            <form onSubmit={handleRescheduleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Quick Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('1H', 'RESCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    +1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('TOMORROW_10AM', 'RESCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    Tomorrow 10 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('IN_2_DAYS', 'RESCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    In 2 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('NEXT_MONDAY', 'RESCHEDULE')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE]"
                  >
                    Next Monday
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">New Date</label>
                  <input
                    type="date"
                    required
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">New Time</label>
                  <input
                    type="time"
                    required
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">
                  Reschedule Reason <span className="text-[#C53030]">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="Explain why this callback is being postponed (mandatory for audit)..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>

              <div className="text-[11px] text-[#1E4D8F] bg-[#EAF2FB] p-2.5 rounded-[8px] flex items-center justify-between border border-[#C7DCF3]">
                <span>New Time: {rescheduleDate} at {rescheduleTime}</span>
                <span className="font-mono text-[10px]">{displayTimezone}</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setReschedulingFup(null)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#1E4D8F] hover:bg-[#153a6f] text-white text-xs font-semibold rounded-[8px] shadow-sm"
                >
                  Confirm Reschedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMPLETE MODAL */}
      {completingFup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#16845B]">
                <CheckCircle className="w-4 h-4" />
                <span>Complete Follow-Up ({completingFup.lead_code})</span>
              </div>
              <button
                onClick={() => setCompletingFup(null)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCompleteSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Result Outcome</label>
                <select
                  value={completionOutcome}
                  onChange={(e) => setCompletionOutcome(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                >
                  <option value="COMPLETED">Completed Consultation</option>
                  <option value="POSITIVE">Positive / Interested</option>
                  <option value="CONVERTED">Enrolled / Converted</option>
                  <option value="FOLLOW_UP">Requires Another Follow-up</option>
                  <option value="NO_ANSWER">Customer Unreachable</option>
                  <option value="NEGATIVE">Not Interested</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Outcome Notes</label>
                <textarea
                  rows={3}
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                  placeholder="Summary of final discussion and customer decision..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#16845B]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setCompletingFup(null)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#16845B] hover:bg-[#116947] text-white text-xs font-semibold rounded-[8px] shadow-sm"
                >
                  Record Completion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CANCEL MODAL */}
      {cancellingFup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#C53030]">
                <XCircle className="w-4 h-4" />
                <span>Cancel Follow-Up ({cancellingFup.lead_code})</span>
              </div>
              <button
                onClick={() => setCancellingFup(null)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            {cancelError && (
              <div className="p-2.5 bg-[#FEECEB] border border-[#F8C8C6] text-[#C53030] text-xs rounded-[8px]">
                {cancelError}
              </div>
            )}

            <form onSubmit={handleCancelSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">
                  Cancellation Reason <span className="text-[#C53030]">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Mandatory reason for cancelling this scheduled callback..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#C53030]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setCancellingFup(null)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#C53030] hover:bg-[#9b2626] text-white text-xs font-semibold rounded-[8px] shadow-sm"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
