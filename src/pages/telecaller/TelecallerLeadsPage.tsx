import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { Lead, LeadStatus } from '@/types';
import { leadService } from '@/services/leads/leadService';
import { db } from '@/services/supabase/db';
import { isRealSupabaseConfigured } from '@/services/supabase/client';
import { IS_DEMO_MODE } from '@/lib/config';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { StudentDetailModal } from '@/features/leads/StudentDetailModal';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import { formatRelativeTime } from '@/lib/utils';
import {
  Phone,
  Eye,
  Download,
  ShieldAlert,
  ShieldCheck,
  Users,
  Pencil,
  Loader2,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const TelecallerLeadsPage: React.FC = () => {
  const { profile } = useAuth();
  const sessionIdentityRef = useRef(profile?.user_id || null);
  sessionIdentityRef.current = profile?.user_id || null;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [exportBlockedAlert, setExportBlockedAlert] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editStatus, setEditStatus] = useState<LeadStatus>('ASSIGNED');
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!profile || profile.role !== 'TELECALLER' || profile.status !== 'ACTIVE') {
      setLeads([]);
      setLoadError(profile ? 'An active telecaller profile is required.' : null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      setLeads(await leadService.getAssignedTelecallerLeads(profile));
    } catch {
      setLeads([]);
      setLoadError('Assigned leads could not be loaded. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    let current = true;
    setLeads([]);
    setSelectedLeadId(null);
    setCallingLead(null);
    setEditingLead(null);
    setIsDetailOpen(false);
    setIsOutcomeOpen(false);
    setCompletedCallId(null);

    const refresh = async () => {
      if (!profile || profile.role !== 'TELECALLER' || profile.status !== 'ACTIVE') {
        setLeads([]);
        setLoadError(profile ? 'An active telecaller profile is required.' : null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setLoadError(null);
      try {
        const nextLeads = await leadService.getAssignedTelecallerLeads(profile);
        if (current) setLeads(nextLeads);
      } catch {
        if (current) {
          setLeads([]);
          setLoadError('Assigned leads could not be loaded. Please try again.');
        }
      } finally {
        if (current) setIsLoading(false);
      }
    };
    void refresh();

    const unsubscribe = (!isRealSupabaseConfigured() && IS_DEMO_MODE) ? db.subscribe(({ type }) => {
      if (
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_RECORDED' ||
        type === 'CALL_OUTCOME_SAVED'
      ) {
        void loadData();
      }
    }, profile) : undefined;

    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [profile, loadData]);

  const openEdit = (lead: Lead) => {
    setEditingLead(lead);
    setEditStatus(lead.status);
    setEditNotes(lead.notes || '');
    setSaveError(null);
  };

  const saveLead = async () => {
    if (!editingLead || !profile || isSaving) return;
    const submittingIdentity = profile.user_id;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await leadService.updateAssignedTelecallerLead(
        editingLead.id, editStatus, editNotes, profile
      );
      if (sessionIdentityRef.current !== submittingIdentity) return;
      setLeads((current) => current.map((lead) => lead.id === updated.id ? updated : lead));
      setEditingLead(null);
    } catch {
      if (sessionIdentityRef.current !== submittingIdentity) return;
      setSaveError('The lead could not be updated. Check your assignment and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const filteredLeads = leads.filter((l) => {
    // Zero phone exposure: Telecallers search exclusively by code, name, and source
    const matchSearch =
      l.lead_code.toLowerCase().includes(search.toLowerCase()) ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.source.toLowerCase().includes(search.toLowerCase());

    const matchStatus = statusFilter === 'ALL' || l.status === statusFilter;
    const matchPriority = priorityFilter === 'ALL' || l.priority === priorityFilter;

    return matchSearch && matchStatus && matchPriority;
  });

  const totalPages = Math.ceil(filteredLeads.length / pageSize);
  const paginatedLeads = filteredLeads.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Telecaller Export Attempt Trap
  const handleExportAttempt = () => {
    if (!profile) return;

    db.recordSecurityEvent(
      {
        event_type: 'TELECALLER_EXPORT_BLOCKED',
        severity: 'HIGH',
        description: `Telecaller ${profile.full_name} (${profile.id}) attempted to export assigned lead database. Blocked by ENCRIX Export Guard.`,
        metadata: { agent: profile.full_name, totalLeadsInView: leads.length },
      },
      profile
    );

    setExportBlockedAlert(true);
    setTimeout(() => setExportBlockedAlert(false), 5000);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">My Assigned Leads</h1>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Browse and connect with customer leads assigned to your shift queue.
          </p>
        </div>

        {/* Export disabled button with security violation trigger */}
        <button
          onClick={handleExportAttempt}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-white border border-[#DCE4EE] text-[#64748B] hover:text-[#C53030] hover:border-[#F8C8C6] text-xs shadow-subtle transition-colors"
          title="Data Export Policy"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export (Restricted)</span>
        </button>
      </div>

      {/* Security alert banner if export is attempted */}
      {exportBlockedAlert && (
        <div className="p-4 rounded-[12px] bg-[#FEECEB] border border-[#F8C8C6] text-xs text-[#C53030] flex items-start gap-3 shadow-subtle animate-in fade-in duration-200">
          <ShieldAlert className="w-5 h-5 text-[#C53030] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#C53030] text-sm">Security Policy Violation: Export Blocked</div>
            <p className="mt-0.5 text-[#172B4D]">
              Telecallers are not authorized to download or export customer databases. This attempt has been logged to the security audit stream and reported to the organization owner.
            </p>
          </div>
        </div>
      )}

      {/* SEARCH & FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-[12px] border border-[#DCE4EE] shadow-subtle">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder="Search my leads..."
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
          >
            <option value="ALL">All Statuses</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="CONTACTED">Contacted</option>
            <option value="INTERESTED">Interested</option>
            <option value="FOLLOW_UP">Follow-Up</option>
            <option value="CONVERTED">Converted</option>
            <option value="NOT_INTERESTED">Not Interested</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
          >
            <option value="ALL">All Priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </div>

      {/* LEADS LIST / TABLE */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Lead</th>
                <th className="py-3 px-3">Voice Gateway</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Priority</th>
                <th className="py-3 px-3">Last Contact</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4EE]">
              {isLoading ? (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-[#64748B]">Loading assigned leads…</td></tr>
              ) : loadError ? (
                <tr><td colSpan={6} className="py-12 text-center"><div role="alert" className="text-sm text-[#C53030]">{loadError}</div><button onClick={() => void loadData()} className="mt-3 rounded border border-[#DCE4EE] px-3 py-1.5 text-xs">Retry</button></td></tr>
              ) : paginatedLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <EmptyState
                      icon={Users}
                      title={leads.length === 0 ? "No Leads Assigned Yet" : "No Leads Found"}
                      description={
                        leads.length === 0
                          ? "When leads are assigned to your shift, they will immediately appear here with contact actions ready."
                          : "Try adjusting your search criteria or filters."
                      }
                    />
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-[#F6F8FB] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#0B1F3A]">{lead.name}</div>
                      <div className="font-mono text-[11px] text-[#1E4D8F]">{lead.lead_code}</div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#EAF2FB] border border-[#C7DCF3] text-[11px] font-medium text-[#1E4D8F]">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#1E4D8F]" />
                        <span>Encrix Voice Bridge</span>
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <StatusBadge status={lead.status} />
                    </td>

                    <td className="py-3 px-3">
                      <PriorityBadge priority={lead.priority} />
                    </td>

                    <td className="py-3 px-3 text-[#64748B]">
                      {formatRelativeTime(lead.last_contacted_at || undefined)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(lead)}
                          className="p-1.5 rounded-[8px] bg-white border border-[#DCE4EE] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB] transition-colors shadow-subtle"
                          title="Update lead status and notes"
                          aria-label={`Edit ${lead.lead_code}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setIsDetailOpen(true);
                          }}
                          className="p-1.5 rounded-[8px] bg-white border border-[#DCE4EE] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB] transition-colors shadow-subtle"
                          title="View Student Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setCallingLead(lead)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-subtle transition-all"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>Call</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLeads.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      </div>

      {/* SECURE STUDENT DETAIL MODAL */}
      <StudentDetailModal
        leadId={selectedLeadId}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedLeadId(null);
        }}
        onInitiateCall={(leadId) => {
          const target = leads.find((l) => l.id === leadId);
          if (target) {
            setCallingLead(target);
          }
        }}
      />

      {editingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="telecaller-edit-title" className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h2 id="telecaller-edit-title" className="text-lg font-semibold text-[#0B1F3A]">Update lead</h2>
            <p className="mt-1 text-xs text-[#64748B]">{editingLead.lead_code} · {editingLead.name}</p>
            <label className="mt-4 block text-xs font-medium text-[#172B4D]" htmlFor="telecaller-lead-status">Status</label>
            <select id="telecaller-lead-status" value={editStatus} disabled={isSaving} onChange={(event) => setEditStatus(event.target.value as LeadStatus)} className="mt-1 w-full rounded border border-[#DCE4EE] p-2 text-sm">
              {(['ASSIGNED', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'NOT_INTERESTED', 'INVALID', 'DO_NOT_CONTACT'] as LeadStatus[]).map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
            </select>
            <label className="mt-4 block text-xs font-medium text-[#172B4D]" htmlFor="telecaller-lead-notes">Notes</label>
            <textarea id="telecaller-lead-notes" value={editNotes} disabled={isSaving} onChange={(event) => setEditNotes(event.target.value)} rows={4} maxLength={4000} className="mt-1 w-full rounded border border-[#DCE4EE] p-2 text-sm" />
            {saveError && <p role="alert" className="mt-3 text-sm text-[#C53030]">{saveError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={isSaving} onClick={() => setEditingLead(null)} className="rounded border border-[#DCE4EE] px-3 py-2 text-xs">Cancel</button>
              <button disabled={isSaving} onClick={() => void saveLead()} className="inline-flex items-center gap-2 rounded bg-[#0B1F3A] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save</button>
            </div>
          </section>
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
          lead={callingLead || paginatedLeads[0]}
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
