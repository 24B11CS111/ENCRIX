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
  FileText,
  Shield,
  Check,
  Headphones,
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
    <div className="fixed inset-0 z-50 flex justify-end bg-navy-deep/20 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white border-l border-[#DCE4EE] h-full flex flex-col shadow-dropdown overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-[#DCE4EE] bg-[#F6F8FB]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#1E4D8F] px-2.5 py-0.5 rounded-[6px] bg-[#EAF2FB] border border-[#C7DCF3]">
                {lead.lead_code}
              </span>
              <PriorityBadge priority={lead.priority} />
              <StatusBadge status={lead.status} />
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-[8px] text-[#64748B] hover:text-[#0B1F3A] hover:bg-white border border-transparent hover:border-[#DCE4EE] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-xl font-bold text-[#0B1F3A] tracking-tight">{lead.name}</h2>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-[#64748B]">
            {profile?.role === 'TELECALLER' ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-[#1E4D8F]">
                <Shield className="w-3.5 h-3.5 text-[#1E4D8F]" />
                Zero-Exposure Gateway
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono font-medium text-[#172B4D]">
                <Phone className="w-3.5 h-3.5 text-[#1E4D8F]" />
                {lead.phone}
              </span>
            )}
            {lead.email && <span>{lead.email}</span>}
            <span>Source: <strong className="text-[#172B4D]">{lead.source}</strong></span>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2.5 mt-5">
            <button
              onClick={() => {
                onClose();
                onInitiateCall(lead);
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              <Phone className="w-4 h-4" />
              <span>Call via Gateway</span>
            </button>

            <button
              onClick={() => setActiveTab('notes')}
              className="flex items-center gap-1.5 py-2.5 px-3.5 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] text-xs font-medium rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-colors"
            >
              <FileText className="w-4 h-4 text-[#1E4D8F]" />
              <span>Add Note</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-[#DCE4EE] bg-white px-6">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-[#0B1F3A] text-[#0B1F3A]'
                : 'border-transparent text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            Details & Notes
          </button>
          <button
            onClick={() => setActiveTab('calls')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'calls'
                ? 'border-[#0B1F3A] text-[#0B1F3A]'
                : 'border-transparent text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            Call History ({calls.length})
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-[#0B1F3A] text-[#0B1F3A]'
                : 'border-transparent text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            Activity Timeline
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'details' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* LEFT: 2 columns */}
              <div className="md:col-span-2 space-y-5">
                {/* Lead Information */}
                <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-4 space-y-3 shadow-subtle">
                  <h3 className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                    Lead Information
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[#64748B] block text-[11px]">Lead Source</span>
                      <span className="text-[#172B4D] font-semibold">{lead.source}</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[11px]">Created On</span>
                      <span className="text-[#172B4D] font-semibold">{formatDateTime(lead.created_at)}</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[11px]">Total Calls</span>
                      <span className="text-[#172B4D] font-semibold">{lead.calls_count || calls.length}</span>
                    </div>
                    <div>
                      <span className="text-[#64748B] block text-[11px]">Last Contact</span>
                      <span className="text-[#172B4D] font-semibold">{formatRelativeTime(lead.last_contacted_at || undefined)}</span>
                    </div>
                  </div>
                </div>

                {/* Requirement & Notes */}
                <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-4 space-y-3 shadow-subtle">
                  <h3 className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                    Notes & Discussion Points
                  </h3>
                  <p className="text-xs text-[#172B4D] leading-relaxed whitespace-pre-line bg-[#F6F8FB] p-3 rounded-[8px] border border-[#DCE4EE]">
                    {lead.notes || 'No notes added yet for this lead.'}
                  </p>

                  {/* Add quick note form */}
                  <form onSubmit={handleAddNote} className="mt-3 space-y-2">
                    <textarea
                      rows={2}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Type an internal note..."
                      className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] placeholder-[#94A3B8] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
                    />
                    <button
                      type="submit"
                      disabled={!newNote.trim() || isAddingNote}
                      className="px-3.5 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 text-xs text-white font-medium rounded-[8px] shadow-subtle transition-colors"
                    >
                      Save Note
                    </button>
                  </form>
                </div>

                {/* Follow-up reminder */}
                {followUps.length > 0 && (
                  <div className="rounded-[12px] border border-[#FBDFA8] bg-[#FEF6E7] p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#B7791F] mb-2">
                      <Calendar className="w-4 h-4" />
                      <span>Scheduled Follow-ups</span>
                    </div>
                    {followUps.map((fup) => (
                      <div key={fup.id} className="text-xs text-[#172B4D] py-1.5 border-b border-[#FBDFA8]/60 last:border-0">
                        <div className="font-semibold text-[#0B1F3A]">{formatDateTime(fup.scheduled_at)}</div>
                        <div className="text-[#64748B] text-[11px]">{fup.notes}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT: Security Panel (Section 8 of spec) */}
              <div className="md:col-span-1 space-y-4">
                <div className="rounded-[12px] border border-[#DCE4EE] bg-[#F6F8FB] p-4 space-y-3.5 shadow-subtle">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                    <Shield className="w-4 h-4 text-[#1E4D8F]" />
                    <span>SECURITY</span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center gap-2 text-[#172B4D]">
                      <Check className="w-4 h-4 text-[#16845B] shrink-0" />
                      <div>
                        <span className="font-semibold block">Assigned access</span>
                        <span className="text-[10px] text-[#64748B]">Restricted to authorized callers</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[#172B4D]">
                      <Check className="w-4 h-4 text-[#16845B] shrink-0" />
                      <div>
                        <span className="font-semibold block">Phone protected</span>
                        <span className="text-[10px] text-[#64748B]">Data masked on client layer</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[#172B4D]">
                      <Check className="w-4 h-4 text-[#16845B] shrink-0" />
                      <div>
                        <span className="font-semibold block">Activity tracked</span>
                        <span className="text-[10px] text-[#64748B]">All actions audit logged</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[#172B4D]">
                      <Check className="w-4 h-4 text-[#16845B] shrink-0" />
                      <div>
                        <span className="font-semibold block">Export restricted</span>
                        <span className="text-[10px] text-[#64748B]">Database policy enforced</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'calls' && (
            <div className="space-y-3">
              {calls.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#94A3B8]">
                  No calls recorded yet for this lead.
                </div>
              ) : (
                calls.map((call) => (
                  <div
                    key={call.id}
                    className="p-3.5 rounded-[12px] border border-[#DCE4EE] bg-white space-y-2 shadow-subtle"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Headphones className="w-4 h-4 text-[#1E4D8F]" />
                        <span className="text-xs font-semibold text-[#0B1F3A]">{call.telecaller_name || 'Telecaller'}</span>
                      </div>
                      <span className="text-[11px] text-[#64748B]">{formatRelativeTime(call.created_at)}</span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[#64748B]">
                      <span>Duration: <strong className="text-[#172B4D]">{formatDuration(call.duration_seconds)}</strong></span>
                      {call.outcome && (
                        <span>Outcome: <strong className="text-[#16845B]">{call.outcome}</strong></span>
                      )}
                    </div>

                    {call.notes && (
                      <p className="text-[11px] text-[#172B4D] bg-[#F6F8FB] p-2 rounded-[6px] border border-[#DCE4EE]">
                        {call.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#DCE4EE]">
              {/* Default Lead creation milestone */}
              <div className="relative">
                <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-[#16845B] ring-4 ring-white" />
                <div className="text-xs font-semibold text-[#0B1F3A]">Lead Ingested into ENCRIX</div>
                <div className="text-[11px] text-[#64748B]">{formatDateTime(lead.created_at)}</div>
              </div>

              {timeline.map((item) => (
                <div key={item.id} className="relative">
                  <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-[#1E4D8F] ring-4 ring-white" />
                  <div className="text-xs font-semibold text-[#0B1F3A]">
                    {item.action.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-[#64748B]">
                    By {item.user_name || 'User'}
                    {item.metadata?.duration ? ` • ${item.metadata.duration}` : ''}
                    {item.metadata?.outcome ? ` • ${item.metadata.outcome}` : ''}
                  </div>
                  <div className="text-[10px] text-[#94A3B8] mt-0.5">{formatRelativeTime(item.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
