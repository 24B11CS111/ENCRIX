import React, { useState } from 'react';
import { Lead, CallOutcomeType, NegativeReason } from '@/types';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import {
  CheckCircle,
  XCircle,
  PhoneForwarded,
  Clock,
  Sparkles,
  Calendar,
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
  const [followUpDate, setFollowUpDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split('T')[0]
  );
  const [followUpTime, setFollowUpTime] = useState('11:00');
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('HIGH');

  // Negative Flow Fields
  const [negativeReason, setNegativeReason] = useState<NegativeReason>('Not Interested');
  const [negativeNotes, setNegativeNotes] = useState('');

  // General Notes for other outcomes
  const [generalNotes, setGeneralNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedOutcome) return;

    setIsSubmitting(true);
    try {
      if (selectedOutcome === 'POSITIVE' || selectedOutcome === 'CONVERTED') {
        db.recordCallOutcome(
          {
            call_id: callId,
            lead_id: lead.id,
            outcome: selectedOutcome,
            interest_level: interestLevel,
            requirement,
            notes: positiveNotes,
            followUpDate,
            followUpTime,
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
            followUpDate: selectedOutcome === 'FOLLOW_UP' || selectedOutcome === 'CALL_BACK' ? followUpDate : undefined,
            followUpTime: selectedOutcome === 'FOLLOW_UP' || selectedOutcome === 'CALL_BACK' ? followUpTime : undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 my-8">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs font-semibold text-emerald-400">{lead.lead_code}</span>
            <h2 className="text-lg font-bold text-white">How did the call go?</h2>
            <p className="text-xs text-slate-400">Interaction with {lead.name}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* PRIMARY BUTTONS: POSITIVE & NEGATIVE */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedOutcome('POSITIVE')}
              className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border font-semibold text-sm transition-all ${
                selectedOutcome === 'POSITIVE'
                  ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-950/50 scale-[1.02]'
                  : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400 hover:bg-emerald-950/60'
              }`}
            >
              <CheckCircle className="w-5 h-5" />
              <span>POSITIVE</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedOutcome('NEGATIVE')}
              className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border font-semibold text-sm transition-all ${
                selectedOutcome === 'NEGATIVE'
                  ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-950/50 scale-[1.02]'
                  : 'bg-rose-950/30 border-rose-500/30 text-rose-400 hover:bg-rose-950/60'
              }`}
            >
              <XCircle className="w-5 h-5" />
              <span>NEGATIVE</span>
            </button>
          </div>

          {/* OTHER OUTCOMES CHIPS */}
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Other Outcomes
            </label>
            <div className="flex flex-wrap gap-1.5">
              {otherOutcomes.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setSelectedOutcome(item.type)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    selectedOutcome === item.type
                      ? 'bg-slate-700 border-slate-500 text-white'
                      : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
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
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Sparkles className="w-4 h-4" />
                <span>Positive Interaction Workflow</span>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Interest Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setInterestLevel(lvl)}
                      className={`py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        interestLevel === lvl
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Requirement / Need</label>
                <input
                  type="text"
                  required
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  placeholder="e.g. Master of Data Science Germany, IELTS ready"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 block mb-1">Follow-up Date</label>
                  <input
                    type="date"
                    required
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-300 block mb-1">Follow-up Time</label>
                  <input
                    type="time"
                    required
                    value={followUpTime}
                    onChange={(e) => setFollowUpTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Detailed Discussion Notes</label>
                <textarea
                  required
                  rows={3}
                  value={positiveNotes}
                  onChange={(e) => setPositiveNotes(e.target.value)}
                  placeholder="Key discussion points, budget, documents required..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          {/* 2. NEGATIVE FLOW */}
          {selectedOutcome === 'NEGATIVE' && (
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/30 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold">
                <XCircle className="w-4 h-4" />
                <span>Negative Interaction Workflow</span>
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Reason for Negative</label>
                <select
                  value={negativeReason}
                  onChange={(e) => setNegativeReason(e.target.value as NegativeReason)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-rose-500"
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
                <label className="text-xs text-slate-300 block mb-1">Notes</label>
                <textarea
                  required
                  rows={3}
                  value={negativeNotes}
                  onChange={(e) => setNegativeNotes(e.target.value)}
                  placeholder="Customer stated reasons..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
          )}

          {/* 3. OTHER OUTCOMES (FOLLOW-UP, NO ANSWER, ETC.) */}
          {selectedOutcome && selectedOutcome !== 'POSITIVE' && selectedOutcome !== 'NEGATIVE' && (
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/80 space-y-3">
              {(selectedOutcome === 'FOLLOW_UP' || selectedOutcome === 'CALL_BACK') && (
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">Schedule Date</label>
                    <input
                      type="date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">Schedule Time</label>
                    <input
                      type="time"
                      value={followUpTime}
                      onChange={(e) => setFollowUpTime(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-slate-300 block mb-1">Call Notes</label>
                <textarea
                  rows={2}
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  placeholder="Brief note about the call..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Skip for now
            </button>
            <button
              type="submit"
              disabled={!selectedOutcome || isSubmitting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              {isSubmitting ? 'Saving...' : 'Save Call Outcome'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
