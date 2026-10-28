import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { followUpService } from '@/services/followUps/followUpService';
import { FollowUp, Profile, Lead } from '@/types';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  User,
  Users,
  Search,
  ArrowRightLeft,
  XCircle,
  FileQuestion,
} from 'lucide-react';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { EmptyState } from '@/components/common/EmptyState';

export const OwnerFollowUpsPage: React.FC = () => {
  const { profile } = useAuth();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [leadsWithoutAction, setLeadsWithoutAction] = useState<Lead[]>([]);

  // Navigation Filter Tabs
  const [activeTab, setActiveTab] = useState<
    'TODAY' | 'OVERDUE' | 'UPCOMING' | 'COMPLETED' | 'WITHOUT_ACTION' | 'ALL'
  >('TODAY');

  // Secondary Filters
  const [selectedTelecaller, setSelectedTelecaller] = useState<string>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Escalation / Reassignment Modal
  const [escalatingFup, setEscalatingFup] = useState<FollowUp | null>(null);
  const [targetTelecallerId, setTargetTelecallerId] = useState<string>('');
  const [escalationReason, setEscalationReason] = useState<string>('');
  const [escalationError, setEscalationError] = useState<string | null>(null);
  const [isEscalating, setIsEscalating] = useState(false);

  // Quick Schedule Modal for Leads Without Action
  const [schedulingLead, setSchedulingLead] = useState<Lead | null>(null);
  const [quickScheduleDate, setQuickScheduleDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [quickScheduleTime, setQuickScheduleTime] = useState('11:00');
  const [quickScheduleTelecaller, setQuickScheduleTelecaller] = useState('');
  const [quickScheduleReason, setQuickScheduleReason] = useState('');

  const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const loadData = async () => {
    if (!profile) return;
    try {
      const serverFollowUps = await followUpService.getFollowUps(profile);
      setFollowUps(serverFollowUps);
    } catch {
      setFollowUps(db.getFollowUps(profile));
    }
    setTelecallers(db.getEligibleTelecallers(profile));
    setLeadsWithoutAction(db.getLeadsWithoutNextAction(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'FOLLOWUP_CREATED' ||
        type === 'FOLLOWUP_UPDATED' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'NOTIFICATION_READ'
      ) {
        loadData();
      }
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  // Derived Metrics
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  const todayFollowUps = followUps.filter((f) => {
    if (f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED') return false;
    const time = new Date(f.scheduled_at).getTime();
    return f.status === 'DUE' || (time >= startOfToday && time <= endOfToday && f.status !== 'OVERDUE');
  });

  const overdueFollowUps = followUps.filter((f) => f.status === 'OVERDUE');

  const upcomingFollowUps = followUps.filter((f) => {
    if (f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED') return false;
    const time = new Date(f.scheduled_at).getTime();
    return time > endOfToday && f.status !== 'OVERDUE';
  });

  const completedFollowUps = followUps.filter((f) => f.status === 'COMPLETED');

  // Multi-Filter Application
  const filteredFollowUps = followUps.filter((f) => {
    // 1. Tab filter
    if (activeTab === 'TODAY') {
      const time = new Date(f.scheduled_at).getTime();
      const isDueToday = f.status === 'DUE' || (time >= startOfToday && time <= endOfToday && f.status !== 'OVERDUE');
      if (!isDueToday || f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED') {
        return false;
      }
    } else if (activeTab === 'OVERDUE') {
      if (f.status !== 'OVERDUE') return false;
    } else if (activeTab === 'UPCOMING') {
      const time = new Date(f.scheduled_at).getTime();
      if (time <= endOfToday || f.status === 'COMPLETED' || f.status === 'CANCELLED' || f.status === 'RESCHEDULED' || f.status === 'OVERDUE') {
        return false;
      }
    } else if (activeTab === 'COMPLETED') {
      if (f.status !== 'COMPLETED') return false;
    }

    // 2. Telecaller filter
    if (selectedTelecaller !== 'ALL' && f.assigned_to !== selectedTelecaller) {
      return false;
    }

    // 3. Priority filter
    if (selectedPriority !== 'ALL' && f.priority !== selectedPriority) {
      return false;
    }

    // 4. Search Query (Lead code or name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const codeMatch = f.lead_code?.toLowerCase().includes(q);
      const nameMatch = f.lead_name?.toLowerCase().includes(q);
      const notesMatch = f.notes?.toLowerCase().includes(q) || f.reason?.toLowerCase().includes(q);
      if (!codeMatch && !nameMatch && !notesMatch) return false;
    }

    return true;
  });

  // Telecaller Workload Breakdown
  const telecallerBreakdown = telecallers.map((tc) => {
    const tcFollowUps = followUps.filter((f) => f.assigned_to === tc.id);
    const tcOverdue = tcFollowUps.filter((f) => f.status === 'OVERDUE').length;
    const tcScheduled = tcFollowUps.filter(
      (f) => f.status === 'SCHEDULED' || f.status === 'PENDING' || f.status === 'DUE'
    ).length;
    const tcCompleted = tcFollowUps.filter((f) => f.status === 'COMPLETED').length;
    const openLeads = db.getOpenLeadCount(tc.id, profile?.organization_id || '');

    return {
      id: tc.id,
      name: tc.full_name,
      openLeads,
      scheduled: tcScheduled,
      overdue: tcOverdue,
      completed: tcCompleted,
    };
  });

  // Handle Mark Complete
  const handleMarkComplete = async (id: string) => {
    if (!profile) return;
    try {
      await followUpService.completeFollowUp(id, 'Marked complete by Owner in dashboard', undefined, profile);
    } catch {
      db.completeFollowUp(id, profile, 'Marked complete by Owner in dashboard');
    }
    loadData();
  };

  // Handle Escalation / Reassignment
  const handleEscalateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !escalatingFup) return;
    setEscalationError(null);

    if (!targetTelecallerId) {
      setEscalationError('Please select a target telecaller.');
      return;
    }

    if (!escalationReason.trim()) {
      setEscalationError('Escalation reason is mandatory for audit logging.');
      return;
    }

    setIsEscalating(true);
    try {
      db.escalateFollowUp(
        escalatingFup.id,
        targetTelecallerId,
        escalationReason,
        profile
      );
      setEscalatingFup(null);
      setEscalationReason('');
      setTargetTelecallerId('');
      loadData();
    } catch (err: any) {
      setEscalationError(err.message || 'Failed to escalate follow-up');
    } finally {
      setIsEscalating(false);
    }
  };

  // Handle Quick Schedule from Leads Without Next Action
  const handleQuickScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !schedulingLead) return;

    try {
      await followUpService.createFollowUp(
        {
          leadId: schedulingLead.id,
          scheduledAt: `${quickScheduleDate}T${quickScheduleTime}:00Z`,
          assignedTo: quickScheduleTelecaller || schedulingLead.assigned_to || undefined,
          priority: 'HIGH',
          notes: quickScheduleReason || 'Follow-up created from Leads Without Action queue',
        },
        profile
      );
      setSchedulingLead(null);
      setQuickScheduleReason('');
      loadData();
    } catch (err: any) {
      console.error('Failed to create follow-up:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Organization Follow-Up & Escalation</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Monitor callback SLAs across agents, escalate overdue consultations, and prevent lead pipeline leakage.
          </p>
        </div>
      </div>

      {/* METRIC CARDS / QUEUE TABS */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          onClick={() => setActiveTab('TODAY')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'TODAY'
              ? 'bg-white border-[#16845B] ring-1 ring-[#16845B] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Due Today</span>
            <Clock className="w-4 h-4 text-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#16845B]">{todayFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('OVERDUE')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'OVERDUE'
              ? 'bg-white border-[#C53030] ring-1 ring-[#C53030] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#C53030]">Overdue</span>
            <AlertTriangle className="w-4 h-4 text-[#C53030]" />
          </div>
          <div className="text-2xl font-bold text-[#C53030]">{overdueFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('UPCOMING')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'UPCOMING'
              ? 'bg-white border-[#1E4D8F] ring-1 ring-[#1E4D8F] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Upcoming</span>
            <Calendar className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#1E4D8F]">{upcomingFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('COMPLETED')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'COMPLETED'
              ? 'bg-white border-[#64748B] ring-1 ring-[#64748B] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Completed</span>
            <CheckCircle className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="text-2xl font-bold text-[#64748B]">{completedFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('WITHOUT_ACTION')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'WITHOUT_ACTION'
              ? 'bg-white border-[#B4690E] ring-1 ring-[#B4690E] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#B4690E]">No Next Action</span>
            <FileQuestion className="w-4 h-4 text-[#B4690E]" />
          </div>
          <div className="text-2xl font-bold text-[#B4690E]">{leadsWithoutAction.length}</div>
        </button>
      </div>

      {/* TELECALLER WORKLOAD & OVERDUE BREAKDOWN */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1E4D8F]" />
            <h2 className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
              Telecaller Follow-Up & Overdue Workload Breakdown
            </h2>
          </div>
          <span className="text-[11px] text-[#64748B]">{telecallers.length} Active Agents</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {telecallerBreakdown.map((tc) => (
            <div
              key={tc.id}
              onClick={() => setSelectedTelecaller(selectedTelecaller === tc.id ? 'ALL' : tc.id)}
              className={`p-3.5 rounded-[10px] border cursor-pointer transition-all ${
                selectedTelecaller === tc.id
                  ? 'bg-[#EAF2FB]/50 border-[#1E4D8F] ring-1 ring-[#1E4D8F]'
                  : 'bg-[#F6F8FB]/60 border-[#DCE4EE] hover:border-[#CBD5E1]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#0B1F3A]">{tc.name}</span>
                {tc.overdue > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#C53030] bg-[#FEECEB] px-2 py-0.5 rounded-[6px] border border-[#F8C8C6]">
                    <AlertTriangle className="w-3 h-3" /> {tc.overdue} Overdue
                  </span>
                ) : (
                  <span className="text-[10px] text-[#16845B] font-semibold bg-[#EAF7EE] px-2 py-0.5 rounded-[6px] border border-[#C3EBD0]">
                    On Track
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="bg-white p-1.5 rounded-[6px] border border-[#DCE4EE]">
                  <div className="text-[10px] text-[#64748B]">Open Leads</div>
                  <div className="font-bold text-[#172B4D]">{tc.openLeads}</div>
                </div>
                <div className="bg-white p-1.5 rounded-[6px] border border-[#DCE4EE]">
                  <div className="text-[10px] text-[#64748B]">Scheduled</div>
                  <div className="font-bold text-[#1E4D8F]">{tc.scheduled}</div>
                </div>
                <div className="bg-white p-1.5 rounded-[6px] border border-[#DCE4EE]">
                  <div className="text-[10px] text-[#64748B]">Completed</div>
                  <div className="font-bold text-[#16845B]">{tc.completed}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MULTI-FILTER BAR (Only active for regular follow-up views) */}
      {activeTab !== 'WITHOUT_ACTION' && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-white p-3.5 rounded-[12px] border border-[#DCE4EE] shadow-sm">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Lead Code, Student Name, or Notes..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedTelecaller}
              onChange={(e) => setSelectedTelecaller(e.target.value)}
              className="px-3 py-1.5 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
            >
              <option value="ALL">All Agents</option>
              {telecallers.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.full_name}
                </option>
              ))}
            </select>

            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="px-3 py-1.5 bg-[#F6F8FB] border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
            >
              <option value="ALL">All Priorities</option>
              <option value="URGENT">Urgent</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>

            {(selectedTelecaller !== 'ALL' || selectedPriority !== 'ALL' || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedTelecaller('ALL');
                  setSelectedPriority('ALL');
                  setSearchQuery('');
                }}
                className="text-xs text-[#C53030] hover:underline px-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* VIEW 1: REGULAR FOLLOW-UPS LIST */}
      {activeTab !== 'WITHOUT_ACTION' ? (
        <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
          <div className="divide-y divide-[#DCE4EE]">
            {filteredFollowUps.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Calendar}
                  title="No Follow-Up Consultations Found"
                  description="No tasks match your active filter criteria."
                />
              </div>
            ) : (
              filteredFollowUps.map((fup) => {
                const isOverdue = fup.status === 'OVERDUE';
                const isDueNow = fup.status === 'DUE';
                const assignedProfile = telecallers.find((t) => t.id === fup.assigned_to);

                return (
                  <div
                    key={fup.id}
                    className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                      isOverdue ? 'bg-[#FEECEB]/25' : isDueNow ? 'bg-[#FEF6E7]/25' : 'hover:bg-[#F6F8FB]/60'
                    }`}
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#1E4D8F]">
                          {fup.lead_code || 'ENC-Lead'}
                        </span>
                        <span className="text-sm font-semibold text-[#172B4D]">{fup.lead_name}</span>
                        <PriorityBadge priority={fup.priority} />

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

                      <p className="text-xs text-[#172B4D] bg-[#F6F8FB] px-3 py-1.5 rounded-[8px] border border-[#DCE4EE]">
                        {fup.reason || fup.notes || 'Scheduled customer consultation'}
                      </p>

                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#64748B]">
                        <span className="flex items-center gap-1 font-mono text-[#1E4D8F]">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(fup.scheduled_at)}
                        </span>
                        <span>Relative: {formatRelativeTime(fup.scheduled_at)}</span>
                        <span className="flex items-center gap-1 text-[#0B1F3A] font-semibold">
                          <User className="w-3 h-3 text-[#1E4D8F]" />
                          Agent: {assignedProfile?.full_name || fup.assigned_to}
                        </span>
                      </div>

                      {/* Escalation history if present */}
                      {fup.escalated_at && (
                        <div className="text-[10px] text-[#B4690E] bg-[#FEF6E7] px-2.5 py-1 rounded-[6px] border border-[#F9E2B6] inline-flex items-center gap-1">
                          <ArrowRightLeft className="w-3 h-3" />
                          <span>
                            Escalated at {formatDateTime(fup.escalated_at)}. Reason: &ldquo;{fup.escalation_reason}&rdquo;
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
                      {fup.status !== 'COMPLETED' && fup.status !== 'CANCELLED' && (
                        <>
                          <button
                            onClick={() => {
                              setEscalatingFup(fup);
                              setTargetTelecallerId('');
                              setEscalationReason('');
                              setEscalationError(null);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>Escalate / Reassign</span>
                          </button>

                          <button
                            onClick={() => handleMarkComplete(fup.id)}
                            className="px-2.5 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#EAF7EE] hover:text-[#16845B] text-[#172B4D] text-xs font-medium rounded-[8px] transition-colors shadow-sm"
                          >
                            Mark Complete
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
      ) : (
        /* VIEW 2: LEADS WITHOUT NEXT ACTION QUEUE */
        <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
          <div className="p-4 bg-[#FEF6E7] border-b border-[#F9E2B6] flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#B4690E]">
              <AlertTriangle className="w-4 h-4" />
              <span>
                These active leads do not have any scheduled follow-up or callback queued. Schedule an action to prevent pipeline stagnation.
              </span>
            </div>
            <span className="text-xs font-bold text-[#B4690E]">{leadsWithoutAction.length} Leads</span>
          </div>

          <div className="divide-y divide-[#DCE4EE]">
            {leadsWithoutAction.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={CheckCircle}
                  title="All Active Leads Have Follow-Ups Queued"
                  description="Every active customer in your pipeline has a scheduled next action."
                />
              </div>
            ) : (
              leadsWithoutAction.map((lead) => {
                const assignedTc = telecallers.find((t) => t.id === lead.assigned_to);

                return (
                  <div
                    key={lead.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F8FB]/60 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#1E4D8F]">
                          {lead.lead_code}
                        </span>
                        <span className="text-sm font-semibold text-[#172B4D]">{lead.name}</span>
                        <PriorityBadge priority={lead.priority} />
                        <span className="text-[10px] px-2 py-0.5 rounded-[6px] font-semibold bg-[#F6F8FB] border border-[#DCE4EE] text-[#64748B]">
                          {lead.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] text-[#64748B]">
                        <span>Assigned Agent: {assignedTc?.full_name || 'Unassigned'}</span>
                        <span>Created: {formatDateTime(lead.created_at)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setSchedulingLead(lead);
                        setQuickScheduleTelecaller(lead.assigned_to || (telecallers[0]?.id || ''));
                        setQuickScheduleReason('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all self-start sm:self-auto"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Schedule Next Action</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* OVERDUE ESCALATION / REASSIGNMENT MODAL */}
      {escalatingFup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B1F3A]">
                <ArrowRightLeft className="w-4 h-4 text-[#1E4D8F]" />
                <span>Escalate / Reassign Follow-Up</span>
              </div>
              <button
                onClick={() => setEscalatingFup(null)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#F6F8FB] rounded-[8px] border border-[#DCE4EE] text-xs space-y-1">
              <div>
                Lead: <strong className="text-[#0B1F3A]">{escalatingFup.lead_code}</strong> ({escalatingFup.lead_name})
              </div>
              <div>
                Scheduled Time: <span className="font-mono">{formatDateTime(escalatingFup.scheduled_at)}</span>
              </div>
              <div>
                Current Agent: <span className="text-[#1E4D8F] font-semibold">{escalatingFup.assigned_to}</span>
              </div>
            </div>

            {escalationError && (
              <div className="p-2.5 bg-[#FEECEB] border border-[#F8C8C6] text-[#C53030] text-xs rounded-[8px]">
                {escalationError}
              </div>
            )}

            <form onSubmit={handleEscalateSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">
                  Assign to New Telecaller <span className="text-[#C53030]">*</span>
                </label>
                <select
                  required
                  value={targetTelecallerId}
                  onChange={(e) => setTargetTelecallerId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                >
                  <option value="">Select an active telecaller...</option>
                  {telecallers
                    .filter((tc) => tc.id !== escalatingFup.assigned_to)
                    .map((tc) => (
                      <option key={tc.id} value={tc.id}>
                        {tc.full_name} ({db.getOpenLeadCount(tc.id, profile?.organization_id || '')} open leads)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">
                  Mandatory Escalation Reason <span className="text-[#C53030]">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  placeholder="State the business rationale for reassigning this follow-up (recorded in audit log)..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setEscalatingFup(null)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEscalating}
                  className="px-4 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-50 text-white text-xs font-semibold rounded-[8px] shadow-sm transition-all"
                >
                  {isEscalating ? 'Escalating...' : 'Confirm Escalation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK SCHEDULE MODAL FOR LEADS WITHOUT NEXT ACTION */}
      {schedulingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[12px] bg-white border border-[#DCE4EE] shadow-dropdown p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B1F3A]">
                <Calendar className="w-4 h-4 text-[#1E4D8F]" />
                <span>Schedule Next Action for {schedulingLead.lead_code}</span>
              </div>
              <button
                onClick={() => setSchedulingLead(null)}
                className="text-[#64748B] hover:text-[#0B1F3A] text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleQuickScheduleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Assigned Telecaller</label>
                <select
                  value={quickScheduleTelecaller}
                  onChange={(e) => setQuickScheduleTelecaller(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                >
                  {telecallers.map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={quickScheduleDate}
                    onChange={(e) => setQuickScheduleDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Time</label>
                  <input
                    type="time"
                    required
                    value={quickScheduleTime}
                    onChange={(e) => setQuickScheduleTime(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Reason / Notes</label>
                <textarea
                  rows={2}
                  value={quickScheduleReason}
                  onChange={(e) => setQuickScheduleReason(e.target.value)}
                  placeholder="Consultation notes, intake checklist, callback agenda..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setSchedulingLead(null)}
                  className="px-3.5 py-1.5 rounded-[8px] text-xs font-medium text-[#64748B] hover:bg-[#F6F8FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-sm"
                >
                  Schedule Callback
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
