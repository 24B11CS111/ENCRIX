import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead } from '@/types';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import { formatRelativeTime } from '@/lib/utils';
import {
  Users,
  Phone,
  Eye,
  Shield,
  Download,
  ShieldAlert,
} from 'lucide-react';

export const TelecallerLeadsPage: React.FC = () => {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);
  const [exportBlockedAlert, setExportBlockedAlert] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_RECORDED' ||
        type === 'CALL_OUTCOME_SAVED'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const filteredLeads = leads.filter((l) => {
    const matchSearch =
      l.lead_code.toLowerCase().includes(search.toLowerCase()) ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search) ||
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

  // Section 33: Telecaller Export Attempt Trap
  const handleExportAttempt = () => {
    if (!profile) return;

    // Record Security Event as mandated by Section 32 & 33!
    db.recordSecurityEvent(
      {
        event_type: 'TELECALLER_EXPORT_BLOCKED',
        severity: 'HIGH',
        description: `Telecaller ${profile.full_name} (${profile.id}) attempted to export assigned lead database. Blocked by LeadVault Export Guard.`,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">My Assigned Leads</h1>
          <p className="text-xs text-slate-400 mt-1">
            Browse and connect with customer leads assigned to your shift queue.
          </p>
        </div>

        {/* Export disabled button with security violation trigger */}
        <button
          onClick={handleExportAttempt}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/40 text-xs transition-colors"
          title="Data Export Policy"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export (Restricted)</span>
        </button>
      </div>

      {/* Security alert banner if export is attempted */}
      {exportBlockedAlert && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-3 animate-in fade-in duration-200">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-white text-sm">Security Policy Violation: Export Blocked</div>
            <p className="mt-0.5 text-rose-300">
              Telecallers are not authorized to download or export customer databases. This attempt has been logged to the security audit stream and reported to the organization owner.
            </p>
          </div>
        </div>
      )}

      {/* SEARCH & FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Lead Code</th>
                <th className="py-3 px-3">Customer (Masked)</th>
                <th className="py-3 px-3">Phone (Masked)</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Priority</th>
                <th className="py-3 px-3">Last Contact</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {paginatedLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No leads found in your queue.
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-emerald-400">
                      {lead.lead_code}
                    </td>

                    <td className="py-3 px-3 font-medium text-white">{lead.name}</td>

                    <td className="py-3 px-3 font-mono text-slate-300">{lead.phone}</td>

                    <td className="py-3 px-3">
                      <StatusBadge status={lead.status} />
                    </td>

                    <td className="py-3 px-3">
                      <PriorityBadge priority={lead.priority} />
                    </td>

                    <td className="py-3 px-3 text-slate-400">
                      {formatRelativeTime(lead.last_contacted_at || undefined)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setDrawerLead(lead)}
                          className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setCallingLead(lead)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
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

      {/* LEAD DRAWER */}
      <LeadDrawer
        lead={drawerLead}
        isOpen={Boolean(drawerLead)}
        onClose={() => setDrawerLead(null)}
        onInitiateCall={(lead) => setCallingLead(lead)}
      />

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
          lead={callingLead || drawerLead || paginatedLeads[0]}
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
