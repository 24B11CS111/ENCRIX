import React, { useState } from 'react';
import { Lead, CallOutcomeType, NegativeReason, LeadPriority } from '@/types';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import {
  CheckCircle,
  XCircle,
  Sparkles,
  Calendar,
  Clock,
  Globe,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface OutcomeModalProps {
  lead: Lead;
  callId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const OutcomeModal: React.FC<OutcomeModalProps> = ({
  lead,
  callId,
  isOpen,
  onClose,
  onSaved,
}) => {
  const { profile } = useAuth();
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcomeType | null>(null);

  // Positive Flow Fields
  const [interestLevel, setInterestLevel] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [requirement, setRequirement] = useState('');
  const [positiveNotes, setPositiveNotes] = useState('');

  // Follow-Up Scheduling Fields
  const [scheduleFollowUp, setScheduleFollowUp] = useState(true);
  const [followUpDate, setFollowUpDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [followUpTime, setFollowUpTime] = useState('11:00');
  const [followUpPriority, setFollowUpPriority] = useState<LeadPriority>('MEDIUM');
  const [followUpReason, setFollowUpReason] = useState('');

  // Negative Flow Fields
  const [negativeReason, setNegativeReason] = useState<NegativeReason>('Not Interested');
  const [negativeNotes, setNegativeNotes] = useState('');

  // General Notes for other outcomes
  const [generalNotes, setGeneralNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const applyPreset = (preset: '1H' | 'TOMORROW_10AM' | 'IN_2_DAYS' | 'NEXT_MONDAY') => {
    const d = new Date();
    if (preset === '1H') {
      d.setHours(d.getHours() + 1);
      setFollowUpDate(d.toISOString().split('T')[0]);
      setFollowUpTime(d.toTimeString().slice(0, 5));
    } else if (preset === 'TOMORROW_10AM') {
      d.setDate(d.getDate() + 1);
      setFollowUpDate(d.toISOString().split('T')[0]);
      setFollowUpTime('10:00');
    } else if (preset === 'IN_2_DAYS') {
      d.setDate(d.getDate() + 2);
      setFollowUpDate(d.toISOString().split('T')[0]);
      setFollowUpTime('11:00');
    } else if (preset === 'NEXT_MONDAY') {
      const daysUntilMonday = ((1 + 7 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMonday);
      setFollowUpDate(d.toISOString().split('T')[0]);
      setFollowUpTime('11:00');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedOutcome) return;

    setIsSubmitting(true);
    try {
      const shouldIncludeFollowUp =
        selectedOutcome === 'POSITIVE' ||
        selectedOutcome === 'CONVERTED' ||
        selectedOutcome === 'FOLLOW_UP' ||
        selectedOutcome === 'CALL_BACK' ||
        (scheduleFollowUp && (selectedOutcome === 'NO_ANSWER' || selectedOutcome === 'BUSY'));

      if (selectedOutcome === 'POSITIVE' || selectedOutcome === 'CONVERTED') {
        db.recordCallOutcome(
          {
            call_id: callId,
            lead_id: lead.id,
            outcome: selectedOutcome,
            interest_level: interestLevel,
            requirement,
            notes: positiveNotes,
            followUpDate: shouldIncludeFollowUp ? followUpDate : undefined,
            followUpTime: shouldIncludeFollowUp ? followUpTime : undefined,
            followUpPriority,
            followUpReason: followUpReason || requirement || positiveNotes,
            timezone: displayTimezone,
          },
          profile
        );

        // Confetti celebration for positive / converted leads
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {
          // ignore
        }
      } else if (selectedOutcome === 'NEGATIVE') {
        db.recordCallOutcome(
          {
            call_id: callId,
            lead_id: lead.id,
            outcome: 'NEGATIVE',
            reason: negativeReason,
            notes: negativeNotes,
          },
          profile
        );
      } else {
        db.recordCallOutcome(
          {
            call_id: callId,
            lead_id: lead.id,
            outcome: selectedOutcome,
            notes: generalNotes,
            followUpDate: shouldIncludeFollowUp ? followUpDate : undefined,
            followUpTime: shouldIncludeFollowUp ? followUpTime : undefined,
            followUpPriority,
            followUpReason: followUpReason || generalNotes || `Callback for ${selectedOutcome}`,
            timezone: displayTimezone,
          },
          profile
        );
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error('Failed to save outcome:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const otherOutcomes: { type: CallOutcomeType; label: string }[] = [
    { type: 'NO_ANSWER', label: 'No Answer' },
    { type: 'BUSY', label: 'Busy' },
    { type: 'CALL_BACK', label: 'Call Back' },
    { type: 'FOLLOW_UP', label: 'Follow-up' },
    { type: 'CONVERTED', label: 'Converted' },
    { type: 'WRONG_NUMBER', label: 'Wrong Number' },
    { type: 'DO_NOT_CONTACT', label: 'Do Not Contact' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-deep/20 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-[12px] border border-[#DCE4EE] bg-white shadow-dropdown p-6 my-8">
        <div className="flex items-center justify-between pb-4 border-b border-[#DCE4EE]">
          <div>
            <span className="text-xs font-mono font-bold text-[#1E4D8F]">{lead.lead_code}</span>
            <h2 className="text-lg font-bold text-[#0B1F3A]">Log Call Outcome</h2>
            <p className="text-xs text-[#64748B]">Interaction with {lead.name}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* PRIMARY BUTTONS: POSITIVE & NEGATIVE */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedOutcome('POSITIVE')}
              className={`flex items-center justify-center gap-2.5 p-3.5 rounded-[10px] border font-semibold text-sm transition-all ${
                selectedOutcome === 'POSITIVE'
                  ? 'bg-[#16845B] border-[#16845B] text-white shadow-subtle'
                  : 'bg-[#EAF7EE] border-[#C3EBD0] text-[#16845B] hover:bg-[#DDF2E3]'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              <span>POSITIVE</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedOutcome('NEGATIVE')}
              className={`flex items-center justify-center gap-2.5 p-3.5 rounded-[10px] border font-semibold text-sm transition-all ${
                selectedOutcome === 'NEGATIVE'
                  ? 'bg-[#C53030] border-[#C53030] text-white shadow-subtle'
                  : 'bg-[#FEECEB] border-[#F8C8C6] text-[#C53030] hover:bg-[#FCD8D6]'
              }`}
            >
              <XCircle className="w-5 h-5" />
              <span>NEGATIVE</span>
            </button>
          </div>

          {/* OTHER OUTCOMES CHIPS */}
          <div>
            <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-2">
              Other Outcomes
            </label>
            <div className="flex flex-wrap gap-1.5">
              {otherOutcomes.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setSelectedOutcome(item.type)}
                  className={`px-3 py-1.5 rounded-[8px] border text-xs font-semibold transition-all ${
                    selectedOutcome === item.type
                      ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white shadow-subtle'
                      : 'bg-white border-[#DCE4EE] text-[#172B4D] hover:bg-[#F6F8FB]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* DYNAMIC WORKFLOW SECTION ACCORDING TO SELECTION */}

          {/* 1. POSITIVE FLOW */}
          {selectedOutcome === 'POSITIVE' && (
            <div className="p-4 rounded-[10px] bg-[#EAF7EE] border border-[#C3EBD0] space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-[#16845B] text-xs font-bold">
                <Sparkles className="w-4 h-4" />
                <span>Positive Interaction Workflow</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Interest Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setInterestLevel(lvl)}
                      className={`py-1.5 rounded-[8px] text-xs font-semibold border transition-colors ${
                        interestLevel === lvl
                          ? 'bg-[#16845B] border-[#16845B] text-white'
                          : 'bg-white border-[#DCE4EE] text-[#172B4D] hover:bg-[#F6F8FB]'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Requirement / Need</label>
                <input
                  type="text"
                  required
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  placeholder="e.g. Master of Data Science, Consultation requested"
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>

              {/* Follow-up Scheduling Section with Quick Presets */}
              <div className="p-3 bg-white rounded-[8px] border border-[#C3EBD0] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#16845B] flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Next Action / Callback
                  </span>
                  <span className="text-[10px] text-[#64748B] flex items-center gap-1 font-mono">
                    <Globe className="w-3 h-3" /> {displayTimezone}
                  </span>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('1H')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                  >
                    +1 Hour
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('TOMORROW_10AM')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                  >
                    Tomorrow 10 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('IN_2_DAYS')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                  >
                    In 2 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('NEXT_MONDAY')}
                    className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                  >
                    Next Monday
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-[#172B4D] block mb-1">Date</label>
                    <input
                      type="date"
                      required
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#172B4D] block mb-1">Time</label>
                    <input
                      type="time"
                      required
                      value={followUpTime}
                      onChange={(e) => setFollowUpTime(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-[#172B4D] block mb-1">Priority</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFollowUpPriority(p)}
                        className={`py-1 rounded-[6px] text-[11px] font-semibold border transition-colors ${
                          followUpPriority === p
                            ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white'
                            : 'bg-white border-[#DCE4EE] text-[#64748B] hover:bg-[#F6F8FB]'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-[11px] text-[#1E4D8F] bg-[#EAF2FB] p-2 rounded-[6px] flex items-center justify-between">
                  <span>Exact Scheduled: {followUpDate} at {followUpTime}</span>
                  <span className="font-mono text-[10px]">{displayTimezone}</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Detailed Discussion Notes</label>
                <textarea
                  required
                  rows={3}
                  value={positiveNotes}
                  onChange={(e) => setPositiveNotes(e.target.value)}
                  placeholder="Key discussion points, requirements, next action..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>
            </div>
          )}

          {/* 2. NEGATIVE FLOW */}
          {selectedOutcome === 'NEGATIVE' && (
            <div className="p-4 rounded-[10px] bg-[#FEECEB] border border-[#F8C8C6] space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-[#C53030] text-xs font-bold">
                <XCircle className="w-4 h-4" />
                <span>Negative Interaction Workflow</span>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Reason for Negative</label>
                <select
                  value={negativeReason}
                  onChange={(e) => setNegativeReason(e.target.value as NegativeReason)}
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#C53030]"
                >
                  <option value="Not Interested">Not Interested</option>
                  <option value="Price">Price / Budget Constraint</option>
                  <option value="Competitor">Went with Competitor</option>
                  <option value="Already Purchased">Already Purchased / Enrolled</option>
                  <option value="Not Eligible">Not Eligible</option>
                  <option value="Wrong Requirement">Wrong Requirement</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Notes</label>
                <textarea
                  required
                  rows={3}
                  value={negativeNotes}
                  onChange={(e) => setNegativeNotes(e.target.value)}
                  placeholder="Customer stated reasons..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#C53030]"
                />
              </div>
            </div>
          )}

          {/* 3. OTHER OUTCOMES (FOLLOW-UP, NO ANSWER, CALL_BACK, ETC.) */}
          {selectedOutcome && selectedOutcome !== 'POSITIVE' && selectedOutcome !== 'NEGATIVE' && (
            <div className="p-4 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE] space-y-3">
              {(selectedOutcome === 'FOLLOW_UP' || selectedOutcome === 'CALL_BACK') ? (
                <div className="space-y-3 p-3 bg-white rounded-[8px] border border-[#DCE4EE]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#1E4D8F] flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> Schedule Callback
                    </span>
                    <span className="text-[10px] text-[#64748B] flex items-center gap-1 font-mono">
                      <Globe className="w-3 h-3" /> {displayTimezone}
                    </span>
                  </div>

                  {/* Quick Presets */}
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyPreset('1H')}
                      className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                    >
                      +1 Hour
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('TOMORROW_10AM')}
                      className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                    >
                      Tomorrow 10 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('IN_2_DAYS')}
                      className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                    >
                      In 2 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('NEXT_MONDAY')}
                      className="px-2 py-1 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded-[6px] border border-[#DCE4EE] transition-colors"
                    >
                      Next Monday
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-[#172B4D] block mb-1">Date</label>
                      <input
                        type="date"
                        required
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-[#172B4D] block mb-1">Time</label>
                      <input
                        type="time"
                        required
                        value={followUpTime}
                        onChange={(e) => setFollowUpTime(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D]"
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-[#1E4D8F] bg-[#EAF2FB] p-2 rounded-[6px] flex items-center justify-between">
                    <span>Scheduled for: {followUpDate} at {followUpTime}</span>
                    <span className="font-mono text-[10px]">{displayTimezone}</span>
                  </div>
                </div>
              ) : (selectedOutcome === 'NO_ANSWER' || selectedOutcome === 'BUSY') && (
                <div className="p-3 bg-white rounded-[8px] border border-[#DCE4EE] space-y-2.5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[#172B4D]">
                    <input
                      type="checkbox"
                      checked={scheduleFollowUp}
                      onChange={(e) => setScheduleFollowUp(e.target.checked)}
                      className="rounded border-[#DCE4EE] text-[#1E4D8F] focus:ring-[#1E4D8F]"
                    />
                    <span>Schedule Next Attempt Callback</span>
                  </label>

                  {scheduleFollowUp && (
                    <div className="space-y-2 pt-2 border-t border-[#DCE4EE]">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => applyPreset('1H')}
                          className="px-2 py-0.5 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded border border-[#DCE4EE]"
                        >
                          +1 Hour
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPreset('TOMORROW_10AM')}
                          className="px-2 py-0.5 text-[11px] font-medium bg-[#F6F8FB] hover:bg-[#EAF2FB] text-[#1E4D8F] rounded border border-[#DCE4EE]"
                        >
                          Tomorrow 10 AM
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="w-full px-2.5 py-1 bg-white border border-[#DCE4EE] rounded-[6px] text-xs"
                        />
                        <input
                          type="time"
                          value={followUpTime}
                          onChange={(e) => setFollowUpTime(e.target.value)}
                          className="w-full px-2.5 py-1 bg-white border border-[#DCE4EE] rounded-[6px] text-xs"
                        />
                      </div>
                      <div className="text-[10px] text-[#64748B]">
                        Next attempt: {followUpDate} at {followUpTime} ({displayTimezone})
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-[#172B4D] block mb-1">Call Notes</label>
                <textarea
                  rows={2}
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  placeholder="Brief note about the call..."
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[8px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
                />
              </div>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#DCE4EE]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[8px] text-xs font-medium text-[#64748B] hover:text-[#0B1F3A] transition-colors"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={!selectedOutcome || isSubmitting}
              className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              {isSubmitting ? 'Saving...' : 'Save Call Outcome'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
