import React, { useState, useEffect } from 'react';
import { Lead, Call, FollowUp, ActivityLog } from '@/types';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { formatDateTime, formatDuration, formatRelativeTime } from '@/lib/utils';
import {
  X,
  Phone,
  Calendar,
  MessageSquare,
  FileText,
  Clock,
  Shield,
  Activity,
  Headphones,
  CheckCircle2,
} from 'lucide-react';

interface LeadDrawerProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onInitiateCall: (lead: Lead) => void;
}

export const LeadDrawer: React.FC<LeadDrawerProps> = ({
  lead,
  isOpen,
  onClose,
  onInitiateCall,
}) => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'details' | 'calls' | 'timeline' | 'notes'>('details');
  const [calls, setCalls] = useState<Call[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [timeline, setTimeline] = useState<ActivityLog[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  useEffect(() => {
    if (!lead || !profile || !isOpen) return;

    // Load related lead data
    const allCalls = db.getCalls(profile);
    setCalls(allCalls.filter((c) => c.lead_id === lead.id));

    const allFollowUps = db.getFollowUps(profile);
    setFollowUps(allFollowUps.filter((f) => f.lead_id === lead.id));

    const logs = db.getActivityLogs(profile);
    setTimeline(logs.filter((l) => l.entity_id === lead.id || l.metadata?.leadCode === lead.lead_code));
  }, [lead, profile, isOpen]);

  if (!isOpen || !lead) return null;

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !profile) return;

    setIsAddingNote(true);
    try {
      db.updateLead(
        lead.id,
        {
          notes: lead.notes ? `${lead.notes}\n[${new Date().toLocaleDateString()}] ${newNote}` : newNote,
        },
        profile
      );
      setNewNote('');
      // Reload logs
      const logs = db.getActivityLogs(profile);
      setTimeline(logs.filter((l) => l.entity_id === lead.id || l.metadata?.leadCode === lead.lead_code));
    } finally {
      setIsAddingNote(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                {lead.lead_code}
              </span>
              <PriorityBadge priority={lead.priority} />
              <StatusBadge status={lead.status} />
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight">{lead.name}</h2>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1 font-mono text-slate-300">
              <Phone className="w-3.5 h-3.5 text-slate-500" />
              {lead.phone}
            </span>
            {lead.email && <span>{lead.email}</span>}
            <span className="text-slate-500">Source: {lead.source}</span>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2.5 mt-5">
            <button
              onClick={() => {
                onClose();
                onInitiateCall(lead);
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              <Phone className="w-4 h-4" />
              <span>Call via Gateway</span>
            </button>

            <button
              onClick={() => setActiveTab('notes')}
              className="flex items-center gap-1.5 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
            >
              <FileText className="w-4 h-4" />
              <span>Add Note</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-slate-800 bg-slate-900/60 px-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Details & Notes
          </button>
          <button
            onClick={() => setActiveTab('calls')}
            className={`py-3 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'calls'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Call History ({calls.length})
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Activity Timeline
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'details' && (
            <>
              {/* Customer Information */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Lead Information
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Lead Source</span>
                    <span className="text-slate-200 font-medium">{lead.source}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Created On</span>
                    <span className="text-slate-200 font-medium">{formatDateTime(lead.created_at)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Total Calls</span>
                    <span className="text-slate-200 font-medium">{lead.calls_count || calls.length}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Last Contact</span>
                    <span className="text-slate-200 font-medium">{formatRelativeTime(lead.last_contacted_at || undefined)}</span>
                  </div>
                </div>
              </div>

              {/* Requirement & Notes */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Notes & Discussion Points
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  {lead.notes || 'No notes added yet for this lead.'}
                </p>

                {/* Add quick note form */}
                <form onSubmit={handleAddNote} className="mt-3 space-y-2">
                  <textarea
                    rows={2}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Type an internal note..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={!newNote.trim() || isAddingNote}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs text-white rounded-lg transition-colors"
                  >
                    Save Note
                  </button>
                </form>
              </div>

              {/* Follow-up reminder */}
              {followUps.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 mb-2">
                    <Calendar className="w-4 h-4" />
                    <span>Scheduled Follow-ups</span>
                  </div>
                  {followUps.map((fup) => (
                    <div key={fup.id} className="text-xs text-slate-300 py-1.5 border-b border-amber-500/10 last:border-0">
                      <div className="font-medium text-white">{formatDateTime(fup.scheduled_at)}</div>
                      <div className="text-slate-400 text-[11px]">{fup.notes}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'calls' && (
            <div className="space-y-3">
              {calls.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  No calls recorded yet for this lead.
                </div>
              ) : (
                calls.map((call) => (
                  <div
                    key={call.id}
                    className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Headphones className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-medium text-white">{call.telecaller_name || 'Telecaller'}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">{formatRelativeTime(call.created_at)}</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span>Duration: <strong className="text-slate-200">{formatDuration(call.duration_seconds)}</strong></span>
                      {call.outcome && (
                        <span>Outcome: <strong className="text-emerald-400">{call.outcome}</strong></span>
                      )}
                    </div>

                    {call.notes && (
                      <p className="text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/80">
                        {call.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
              {/* Default Lead creation milestone */}
              <div className="relative">
                <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                <div className="text-xs font-semibold text-white">Lead Ingested into LeadVault</div>
                <div className="text-[11px] text-slate-500">{formatDateTime(lead.created_at)}</div>
              </div>

              {timeline.map((item) => (
                <div key={item.id} className="relative">
                  <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ring-slate-900" />
                  <div className="text-xs font-semibold text-white">
                    {item.action.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-slate-400">
                    By {item.user_name || 'User'}
                    {item.metadata?.duration ? ` • ${item.metadata.duration}` : ''}
                    {item.metadata?.outcome ? ` • ${item.metadata.outcome}` : ''}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{formatRelativeTime(item.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
