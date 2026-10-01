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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Queue & Lead Assignments</h1>
          <p className="text-xs text-slate-400 mt-1">
            Evenly distribute incoming leads or assign batches to high-performing telecallers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={selectedLeadIds.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Distribute Selected ({selectedLeadIds.length})</span>
          </button>
        </div>
      </div>

      {/* TELECALLER QUEUE STATUS CARDS */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Active Telecallers Workload ({telecallers.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {telecallers.map((tc) => {
            const count = leads.filter((l) => l.assigned_to === tc.id).length;
            const positive = leads.filter(
              (l) => l.assigned_to === tc.id && (l.status === 'INTERESTED' || l.status === 'CONVERTED')
            ).length;

            return (
              <div key={tc.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white truncate">{tc.full_name}</div>
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-[11px] text-slate-400">Assigned Queue:</span>
                  <span className="text-base font-bold text-emerald-400">{count} leads</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Positive outcomes:</span>
                  <span className="text-slate-300 font-medium">{positive}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* UNASSIGNED LEADS TABLE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
              Unassigned Leads Pool ({unassignedLeads.length})
            </h3>
            <p className="text-[11px] text-slate-400">
              Leads waiting in raw queue. Assign them to telecallers to initiate authorized calling.
            </p>
          </div>

          {unassignedLeads.length > 0 && (
            <button
              onClick={handleSelectAllUnassigned}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              {selectedLeadIds.length === unassignedLeads.length
                ? 'Deselect All'
                : `Select All ${unassignedLeads.length} Leads`}
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800 sticky top-0 font-medium">
              <tr>
                <th className="py-2.5 px-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedLeadIds.length > 0 && selectedLeadIds.length === unassignedLeads.length}
                    onChange={handleSelectAllUnassigned}
                    className="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0"
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
            <tbody className="divide-y divide-slate-800/60">
              {unassignedLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
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
                      className={`hover:bg-slate-800/40 cursor-pointer transition-colors ${
                        isChecked ? 'bg-emerald-950/15' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelect(lead.id)}
                          className="rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-0"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-emerald-400">
                        {lead.lead_code}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200 font-medium">{lead.name}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{lead.phone}</td>
                      <td className="py-2.5 px-3 text-slate-400">{lead.source}</td>
                      <td className="py-2.5 px-3">
                        <PriorityBadge priority={lead.priority} />
                      </td>
                      <td className="py-2.5 px-3 text-slate-500">{formatDate(lead.created_at)}</td>
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
