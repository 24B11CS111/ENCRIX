import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Profile, LeadStatus, LeadPriority } from '@/types';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { LeadAssignModal } from '@/features/leads/LeadAssignModal';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import {
  Users,
  UserCheck,
  Upload,
  Phone,
  Filter,
  CheckSquare,
  Square,
  Eye,
  Plus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatRelativeTime } from '@/lib/utils';

export const OwnerLeadsPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [assignmentFilter, setAssignmentFilter] = useState<string>('ALL');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  // Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modals & Drawers
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [completedCallId, setCompletedCallId] = useState<string | null>(null);
  const [isOutcomeOpen, setIsOutcomeOpen] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setTelecallers(db.getTelecallers(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEAD_CREATED' ||
        type === 'LEADS_IMPORTED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'CALL_OUTCOME_SAVED' ||
        type === 'CALL_RECORDED'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  // Filtering
  const filteredLeads = leads.filter((lead) => {
    // Search query
    const matchSearch =
      lead.lead_code.toLowerCase().includes(search.toLowerCase()) ||
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      lead.phone.includes(search) ||
      (lead.email && lead.email.toLowerCase().includes(search.toLowerCase())) ||
      lead.source.toLowerCase().includes(search.toLowerCase());

    // Status filter
    const matchStatus = statusFilter === 'ALL' || lead.status === statusFilter;

    // Priority filter
    const matchPriority = priorityFilter === 'ALL' || lead.priority === priorityFilter;

    // Assignment filter
    const matchAssignment =
      assignmentFilter === 'ALL'
        ? true
        : assignmentFilter === 'UNASSIGNED'
        ? !lead.assigned_to
        : lead.assigned_to === assignmentFilter;

    return matchSearch && matchStatus && matchPriority && matchAssignment;
  });

  // Pagination slice
  const totalPages = Math.ceil(filteredLeads.length / pageSize);
  const paginatedLeads = filteredLeads.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleSelectAll = () => {
    if (selectedIds.length === paginatedLeads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedLeads.map((l) => l.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const getTelecallerName = (tcId?: string | null) => {
    if (!tcId) return <span className="text-amber-400 font-mono text-[11px]">Unassigned</span>;
    const tc = telecallers.find((t) => t.id === tcId);
    return tc ? tc.full_name : 'Telecaller';
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Master Lead Vault</h1>
          <p className="text-xs text-slate-400 mt-1">
            Browse, search, assign and monitor customer leads across your organization.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {selectedIds.length > 0 && (
            <button
              onClick={() => setIsAssignModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Assign ({selectedIds.length})</span>
            </button>
          )}

          <button
            onClick={() => navigate('/owner/import')}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import CSV</span>
          </button>
        </div>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder="Search code, name, phone, source..."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="NEW">New</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="INTERESTED">Interested</option>
            <option value="FOLLOW_UP">Follow-Up</option>
            <option value="CONVERTED">Converted</option>
            <option value="NOT_INTERESTED">Not Interested</option>
          </select>

          {/* Priority Filter */}
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

          {/* Telecaller Assignment Filter */}
          <select
            value={assignmentFilter}
            onChange={(e) => {
              setAssignmentFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Telecallers</option>
            <option value="UNASSIGNED">Unassigned Only</option>
            {telecallers.map((tc) => (
              <option key={tc.id} value={tc.id}>
                {tc.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* LEADS DATA TABLE (Section 26 Columns) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-3.5 w-10 text-center">
                  <button onClick={handleSelectAll} className="text-slate-400 hover:text-white">
                    {selectedIds.length > 0 && selectedIds.length === paginatedLeads.length ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-3">Lead ID</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-3">Phone</th>
                <th className="py-3 px-3">Source</th>
                <th className="py-3 px-3">Assigned To</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Priority</th>
                <th className="py-3 px-3">Last Contact</th>
                <th className="py-3 px-3 text-center">Calls</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {paginatedLeads.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-500">
                    No leads found matching current search & filters.
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead) => {
                  const isSelected = selectedIds.includes(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isSelected ? 'bg-emerald-950/15' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5 text-center">
                        <button
                          onClick={() => handleToggleSelect(lead.id)}
                          className="text-slate-500 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setDrawerLead(lead)}
                          className="font-mono font-semibold text-emerald-400 hover:underline"
                        >
                          {lead.lead_code}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-white">{lead.name}</div>
                        {lead.email && <div className="text-[11px] text-slate-500">{lead.email}</div>}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">{lead.phone}</td>
                      <td className="py-3 px-3 text-slate-400">{lead.source}</td>
                      <td className="py-3 px-3 text-slate-300">{getTelecallerName(lead.assigned_to)}</td>
                      <td className="py-3 px-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="py-3 px-3">
                        <PriorityBadge priority={lead.priority} />
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {formatRelativeTime(lead.last_contacted_at || undefined)}
                      </td>
                      <td className="py-3 px-3 text-center text-slate-300 font-semibold">
                        {lead.calls_count || 0}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setCallingLead(lead)}
                            className="p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors"
                            title="Call Lead"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDrawerLead(lead)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
                            title="View Lead Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLeads.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      </div>

      {/* LEAD DETAILS DRAWER */}
      <LeadDrawer
        lead={drawerLead}
        isOpen={Boolean(drawerLead)}
        onClose={() => setDrawerLead(null)}
        onInitiateCall={(lead) => setCallingLead(lead)}
      />

      {/* ASSIGNMENT MODAL */}
      <LeadAssignModal
        selectedLeadIds={selectedIds}
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        onAssigned={() => {
          setSelectedIds([]);
          loadData();
        }}
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

      {/* CALL OUTCOME MODAL */}
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
