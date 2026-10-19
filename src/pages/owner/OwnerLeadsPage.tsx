import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Profile } from '@/types';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { LeadDrawer } from '@/features/leads/LeadDrawer';
import { LeadAssignModal } from '@/features/leads/LeadAssignModal';
import { CallModal } from '@/features/calls/CallModal';
import { OutcomeModal } from '@/features/calls/OutcomeModal';
import {
  UserCheck,
  Upload,
  Download,
  Phone,
  CheckSquare,
  Square,
  Eye,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatRelativeTime } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import { Users } from 'lucide-react';

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
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  // Export Leads (Owner only, audit logged)
  const handleExport = () => {
    if (!profile) return;
    try {
      const exportedLeads = db.exportLeads(profile);
      const csvContent =
        'LeadCode,Name,Phone,Email,Status,Source,CreatedAt\n' +
        exportedLeads
          .map(
            (l) =>
              `"${l.lead_code}","${l.name}","${l.phone}","${l.email || ''}","${l.status}","${l.source}","${l.created_at}"`
          )
          .join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `encrix_leads_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(err.message || 'Export failed');
    }
  };

  // Filtering
  const filteredLeads = leads.filter((lead) => {
    const matchSearch =
      lead.lead_code.toLowerCase().includes(search.toLowerCase()) ||
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      (lead.phone && lead.phone.includes(search)) ||
      (lead.email && lead.email.toLowerCase().includes(search.toLowerCase())) ||
      lead.source.toLowerCase().includes(search.toLowerCase());

    const matchStatus = statusFilter === 'ALL' || lead.status === statusFilter;
    const matchPriority = priorityFilter === 'ALL' || lead.priority === priorityFilter;
    const matchAssignment =
      assignmentFilter === 'ALL'
        ? true
        : assignmentFilter === 'UNASSIGNED'
        ? !lead.assigned_to
        : lead.assigned_to === assignmentFilter;

    return matchSearch && matchStatus && matchPriority && matchAssignment;
  });

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
    if (!tcId) return <span className="text-[#B7791F] font-medium text-[11px]">Unassigned</span>;
    const tc = telecallers.find((t) => t.id === tcId);
    return tc ? tc.full_name : 'Telecaller';
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">Leads</h1>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Manage and control your organization's lead pipeline.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {selectedIds.length > 0 && (
            <button
              onClick={() => setIsAssignModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Assign ({selectedIds.length})</span>
            </button>
          )}

          <button
            onClick={() => navigate('/owner/import')}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-[#F6F8FB] text-[#0B1F3A] text-xs font-medium rounded-[10px] border border-[#DCE4EE] shadow-subtle transition-colors"
            title="Export CSV (Permission Restricted)"
          >
            <Download className="w-3.5 h-3.5 text-[#1E4D8F]" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3.5 rounded-[12px] border border-[#DCE4EE] shadow-subtle">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder="Search leads by code, customer name, source..."
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
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
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
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
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
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
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

      {/* LEADS DATA TABLE */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-3.5 w-10 text-center">
                  <button onClick={handleSelectAll} className="text-[#64748B] hover:text-[#0B1F3A]">
                    {selectedIds.length > 0 && selectedIds.length === paginatedLeads.length ? (
                      <CheckSquare className="w-4 h-4 text-[#1E4D8F]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-3">Lead</th>
                <th className="py-3 px-3">Company / Source</th>
                <th className="py-3 px-3">Phone</th>
                <th className="py-3 px-3">Assigned To</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Priority</th>
                <th className="py-3 px-3">Last Contact</th>
                <th className="py-3 px-3 text-center">Calls</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4EE]">
              {paginatedLeads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center">
                    <EmptyState
                      icon={Users}
                      title="No leads yet"
                      description={
                        leads.length === 0
                          ? 'Import your first lead list or create leads to get started.'
                          : 'No leads found matching current search & filters.'
                      }
                      actionText={leads.length === 0 ? 'Import Leads' : undefined}
                      onAction={leads.length === 0 ? () => navigate('/owner/import') : undefined}
                      className="border-none shadow-none"
                    />
                  </td>
                </tr>
              ) : (
                paginatedLeads.map((lead) => {
                  const isSelected = selectedIds.includes(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-[#F6F8FB] transition-colors ${
                        isSelected ? 'bg-[#EAF2FB]/50' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5 text-center">
                        <button
                          onClick={() => handleToggleSelect(lead.id)}
                          className="text-[#94A3B8] hover:text-[#0B1F3A]"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#1E4D8F]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => setDrawerLead(lead)}
                          className="font-medium text-[#0B1F3A] hover:text-[#1E4D8F] hover:underline flex flex-col text-left"
                        >
                          <span className="font-semibold text-[#0B1F3A]">{lead.name}</span>
                          <span className="font-mono text-[11px] text-[#64748B]">{lead.lead_code}</span>
                        </button>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#172B4D]">{(lead.metadata as any)?.company_name || lead.source || 'Individual'}</div>
                        <div className="text-[11px] text-[#64748B]">{lead.source}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-[#172B4D]">{lead.phone}</td>
                      <td className="py-3 px-3 text-[#172B4D]">{getTelecallerName(lead.assigned_to)}</td>
                      <td className="py-3 px-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="py-3 px-3">
                        <PriorityBadge priority={lead.priority} />
                      </td>
                      <td className="py-3 px-3 text-[#64748B]">
                        {formatRelativeTime(lead.last_contacted_at || undefined)}
                      </td>
                      <td className="py-3 px-3 text-center text-[#172B4D] font-semibold">
                        {lead.calls_count || 0}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setCallingLead(lead)}
                            className="p-1.5 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F] hover:bg-[#0B1F3A] hover:text-white transition-colors"
                            title="Call Lead"
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDrawerLead(lead)}
                            className="p-1.5 rounded-[8px] bg-white border border-[#DCE4EE] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB] transition-colors"
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
