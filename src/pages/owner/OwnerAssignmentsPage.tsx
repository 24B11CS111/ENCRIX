import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Profile } from '@/types';
import { LeadAssignModal } from '@/features/leads/LeadAssignModal';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import {
  UserCheck,
  Shuffle,
  Users,
  CheckCircle,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

export const OwnerAssignmentsPage: React.FC = () => {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setLeads(db.getLeads(profile));
    setTelecallers(db.getTelecallers(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'LEADS_IMPORTED' ||
        type === 'LEAD_CREATED'
      ) {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const unassignedLeads = leads.filter((l) => !l.assigned_to);

  const handleSelectAllUnassigned = () => {
    if (selectedLeadIds.length === unassignedLeads.length) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(unassignedLeads.map((l) => l.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    if (selectedLeadIds.includes(id)) {
      setSelectedLeadIds(selectedLeadIds.filter((item) => item !== id));
    } else {
      setSelectedLeadIds([...selectedLeadIds, id]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Queue & Lead Assignments</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Evenly distribute incoming leads or assign batches to high-performing telecallers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={selectedLeadIds.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Distribute Selected ({selectedLeadIds.length})</span>
          </button>
        </div>
      </div>

      {/* TELECALLER QUEUE STATUS CARDS */}
      <div>
        <h2 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-3">
          Active Telecallers Workload ({telecallers.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {telecallers.map((tc) => {
            const count = leads.filter((l) => l.assigned_to === tc.id).length;
            const positive = leads.filter(
              (l) => l.assigned_to === tc.id && (l.status === 'INTERESTED' || l.status === 'CONVERTED')
            ).length;

            return (
              <div key={tc.id} className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#0B1F3A] truncate">{tc.full_name}</div>
                  <span className="w-2 h-2 rounded-full bg-[#16845B]" />
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-[11px] text-[#64748B]">Assigned Queue:</span>
                  <span className="text-base font-bold text-[#1E4D8F]">{count} leads</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                  <span>Positive outcomes:</span>
                  <span className="text-[#172B4D] font-medium">{positive}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* UNASSIGNED LEADS TABLE */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#DCE4EE] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
              Unassigned Leads Pool ({unassignedLeads.length})
            </h3>
            <p className="text-[11px] text-[#64748B]">
              Leads waiting in raw queue. Assign them to telecallers to initiate authorized calling.
            </p>
          </div>

          {unassignedLeads.length > 0 && (
            <button
              onClick={handleSelectAllUnassigned}
              className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold transition-colors"
            >
              {selectedLeadIds.length === unassignedLeads.length
                ? 'Deselect All'
                : `Select All ${unassignedLeads.length} Leads`}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] sticky top-0 font-medium">
              <tr>
                <th className="py-2.5 px-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.length > 0 && selectedLeadIds.length === unassignedLeads.length}
                    onChange={handleSelectAllUnassigned}
                    className="rounded bg-white border-[#DCE4EE] text-[#0B1F3A] focus:ring-0"
                  />
                </th>
                <th className="py-2.5 px-3">Lead Code</th>
                <th className="py-2.5 px-3">Customer Name</th>
                <th className="py-2.5 px-3">Phone</th>
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-3">Priority</th>
                <th className="py-2.5 px-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4EE]">
              {unassignedLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#64748B]">
                    <CheckCircle className="w-6 h-6 text-[#16845B] mx-auto mb-2" />
                    All leads are currently assigned! New imported leads will appear here.
                  </td>
                </tr>
              ) : (
                unassignedLeads.map((lead) => {
                  const isChecked = selectedLeadIds.includes(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => handleToggleSelect(lead.id)}
                      className={`hover:bg-[#F6F8FB]/60 cursor-pointer transition-colors ${
                        isChecked ? 'bg-[#EAF2FB]/50' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(lead.id)}
                          className="rounded bg-white border-[#DCE4EE] text-[#0B1F3A] focus:ring-0"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#1E4D8F]">
                        {lead.lead_code}
                      </td>
                      <td className="py-2.5 px-3 text-[#172B4D] font-medium">{lead.name}</td>
                      <td className="py-2.5 px-3 font-mono text-[#172B4D]">{lead.phone}</td>
                      <td className="py-2.5 px-3 text-[#64748B]">{lead.source}</td>
                      <td className="py-2.5 px-3">
                        <PriorityBadge priority={lead.priority} />
                      </td>
                      <td className="py-2.5 px-3 text-[#64748B]">{formatDate(lead.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* LEAD ASSIGN MODAL */}
      <LeadAssignModal
        selectedLeadIds={selectedLeadIds}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAssigned={() => {
          setSelectedLeadIds([]);
          loadData();
        }}
      />
    </div>
  );
};
