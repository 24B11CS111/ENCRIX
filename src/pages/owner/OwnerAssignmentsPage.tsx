import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Lead, Profile, OrganizationDistributionConfig, LeadAssignment, DistributionMode } from '@/types';
import { LeadAssignModal } from '@/features/leads/LeadAssignModal';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import {
  UserCheck,
  Shuffle,
  Scale,
  Settings,
  History,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Check,
  Layers,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';

export const OwnerAssignmentsPage: React.FC = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'queue' | 'rules' | 'history'>('queue');

  // Core Data
  const [leads, setLeads] = useState<Lead[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignments, setAssignments] = useState<LeadAssignment[]>([]);

  // Config State (Tab 2)
  const [config, setConfig] = useState<OrganizationDistributionConfig | null>(null);
  const [configMode, setConfigMode] = useState<DistributionMode>('MANUAL');
  const [configAutoImport, setConfigAutoImport] = useState(false);
  const [configMaxWorkload, setConfigMaxWorkload] = useState<string>('');
  const [configEligibleIds, setConfigEligibleIds] = useState<string[]>([]);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState<string | null>(null);
  const [configErrorMsg, setConfigErrorMsg] = useState<string | null>(null);

  // Reassignment Modal State
  const [reassignLead, setReassignLead] = useState<Lead | null>(null);
  const [reassignTargetTcId, setReassignTargetTcId] = useState<string>('');
  const [reassignReason, setReassignReason] = useState<string>('');
  const [isReassigning, setIsReassigning] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);

  const loadData = () => {
    if (!profile) return;
    const allLeads = db.getLeads(profile);
    setLeads(allLeads);
    const allTc = db.getTelecallers(profile);
    setTelecallers(allTc);
    const asgns = db.getLeadAssignments(profile);
    setAssignments(asgns);

    try {
      const currentCfg = db.getDistributionConfig(profile);
      setConfig(currentCfg);
      setConfigMode(currentCfg.mode);
      setConfigAutoImport(currentCfg.enabled_for_import);
      setConfigMaxWorkload(currentCfg.max_workload !== null ? String(currentCfg.max_workload) : '');
      setConfigEligibleIds(currentCfg.eligible_telecaller_ids || []);
    } catch (err) {
      console.warn('Failed to load distribution config:', err);
    }
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'LEADS_ASSIGNED' ||
        type === 'LEADS_ASSIGNED_ROUND_ROBIN' ||
        type === 'LEADS_DISTRIBUTED' ||
        type === 'LEAD_REASSIGNED' ||
        type === 'LEADS_IMPORTED' ||
        type === 'LEAD_CREATED' ||
        type === 'DISTRIBUTION_CONFIG_UPDATED'
      ) {
        loadData();
      }
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  const unassignedLeads = leads.filter((l) => !l.assigned_to);
  const assignedLeads = leads.filter((l) => !!l.assigned_to);

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

  // Save Distribution Rules
  const handleSaveConfig = () => {
    if (!profile) return;
    setIsSavingConfig(true);
    setConfigSuccessMsg(null);
    setConfigErrorMsg(null);

    try {
      let maxW: number | null = null;
      if (configMaxWorkload.trim()) {
        const parsed = parseInt(configMaxWorkload.trim(), 10);
        if (isNaN(parsed) || parsed <= 0) {
          throw new Error('Maximum workload cap must be a positive whole number.');
        }
        maxW = parsed;
      }

      const updated = db.updateDistributionConfig(
        {
          mode: configMode,
          enabled_for_import: configAutoImport,
          max_workload: maxW,
          eligible_telecaller_ids: configEligibleIds,
        },
        profile
      );

      setConfig(updated);
      setConfigSuccessMsg('Distribution rules successfully updated.');
      setTimeout(() => setConfigSuccessMsg(null), 4000);
    } catch (err: any) {
      setConfigErrorMsg(err.message || 'Failed to update distribution rules.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleToggleEligible = (tcId: string) => {
    if (configEligibleIds.includes(tcId)) {
      setConfigEligibleIds(configEligibleIds.filter((id) => id !== tcId));
    } else {
      setConfigEligibleIds([...configEligibleIds, tcId]);
    }
  };

  // Reassignment Submission
  const handleExecuteReassignment = () => {
    if (!profile || !reassignLead) return;
    setIsReassigning(true);
    setReassignError(null);

    try {
      if (!reassignTargetTcId) {
        throw new Error('Please select a new telecaller.');
      }
      if (!reassignReason.trim()) {
        throw new Error('Reassignment reason is mandatory.');
      }

      db.reassignLead(reassignLead.id, reassignTargetTcId, reassignReason.trim(), profile);
      setReassignLead(null);
      setReassignTargetTcId('');
      setReassignReason('');
      loadData();
    } catch (err: any) {
      setReassignError(err.message || 'Failed to reassign lead.');
    } finally {
      setIsReassigning(false);
    }
  };

  const formatUnassignedReason = (reason?: string | null) => {
    switch (reason) {
      case 'CAPACITY_REACHED':
        return { label: 'Capacity Reached', color: 'bg-[#FEF6E7] text-[#B7791F] border-[#FBDFA8]' };
      case 'NO_ELIGIBLE_TELECALLERS':
        return { label: 'No Active Agents', color: 'bg-[#FEECEB] text-[#C53030] border-[#F8C8C6]' };
      case 'EXCLUDED_POOL':
        return { label: 'Excluded Pool', color: 'bg-[#F1F5F9] text-[#475569] border-[#DCE4EE]' };
      case 'EMPTY_TEAM':
        return { label: 'Empty Team', color: 'bg-[#FEECEB] text-[#C53030] border-[#F8C8C6]' };
      case 'MANUAL_UNASSIGNED':
      default:
        return { label: 'Manual Queue', color: 'bg-[#EAF2FB] text-[#1E4D8F] border-[#C7DCF3]' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Lead Distribution & Workload</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Automated round-robin, open-workload balancing, and unassigned queue management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Tabs */}
          <div className="flex p-1 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <button
              onClick={() => setActiveTab('queue')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all ${
                activeTab === 'queue'
                  ? 'bg-[#0B1F3A] text-white shadow-subtle'
                  : 'text-[#64748B] hover:text-[#0B1F3A]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Queue & Distribution</span>
            </button>
            <button
              onClick={() => setActiveTab('rules')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all ${
                activeTab === 'rules'
                  ? 'bg-[#0B1F3A] text-white shadow-subtle'
                  : 'text-[#64748B] hover:text-[#0B1F3A]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Smart Rules</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all ${
                activeTab === 'history'
                  ? 'bg-[#0B1F3A] text-white shadow-subtle'
                  : 'text-[#64748B] hover:text-[#0B1F3A]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Assignment History</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: QUEUE & WORKLOAD BALANCING                                         */}
      {/* ========================================================================= */}
      {activeTab === 'queue' && (
        <div className="space-y-6">
          {/* Active Telecallers Workload Summary */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                Active Telecaller Workloads ({telecallers.length})
              </h2>
              {config?.max_workload && (
                <span className="text-[11px] text-[#64748B] font-medium">
                  Max capacity cap:{' '}
                  <strong className="text-[#0B1F3A]">{config.max_workload} open leads</strong>
                </span>
              )}
            </div>

            {telecallers.length === 0 ? (
              <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] text-center text-xs text-[#64748B]">
                No telecallers registered yet. Add telecaller team members to distribute leads.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {telecallers.map((tc) => {
                  const openCount = db.getOpenLeadCount(tc.id, profile?.organization_id || '');
                  const maxCap = config?.max_workload;
                  const percent = maxCap ? Math.min(Math.round((openCount / maxCap) * 100), 100) : 0;
                  const isCapped = maxCap !== null && maxCap !== undefined && openCount >= maxCap;

                  return (
                    <div
                      key={tc.id}
                      className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-subtle space-y-2 relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-[#0B1F3A] truncate">{tc.full_name}</div>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tc.status === 'ACTIVE' ? 'bg-[#16845B]' : 'bg-[#94A3B8]'
                          }`}
                        />
                      </div>

                      <div className="flex items-baseline justify-between pt-1">
                        <span className="text-[11px] text-[#64748B]">Active Open:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-base font-bold text-[#1E4D8F]">{openCount}</span>
                          {maxCap && (
                            <span className="text-[11px] text-[#64748B]">/ {maxCap}</span>
                          )}
                        </div>
                      </div>

                      {/* Workload Capacity Bar */}
                      {maxCap && (
                        <div className="w-full bg-[#F6F8FB] h-1.5 rounded-full overflow-hidden border border-[#DCE4EE]">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isCapped
                                ? 'bg-[#C53030]'
                                : percent > 80
                                ? 'bg-[#B7791F]'
                                : 'bg-[#1E4D8F]'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}

                      {isCapped && (
                        <div className="text-[9px] font-bold text-[#C53030] uppercase tracking-wider text-right">
                          Capacity Reached
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Unassigned Leads Pool */}
          <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-subtle">
            <div className="p-4 border-b border-[#DCE4EE] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
                  Unassigned Leads Pool ({unassignedLeads.length})
                </h3>
                <p className="text-[11px] text-[#64748B]">
                  Awaiting telecaller assignment. Select leads to trigger automated smart distribution.
                </p>
              </div>

              <div className="flex items-center gap-3">
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
                <button
                  onClick={() => setIsAssignModalOpen(true)}
                  disabled={selectedLeadIds.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Distribute Selected ({selectedLeadIds.length})</span>
                </button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] sticky top-0 font-medium">
                  <tr>
                    <th className="py-2.5 px-3.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectedLeadIds.length > 0 &&
                          selectedLeadIds.length === unassignedLeads.length
                        }
                        onChange={handleSelectAllUnassigned}
                        className="rounded bg-white border-[#DCE4EE] text-[#0B1F3A] focus:ring-0"
                      />
                    </th>
                    <th className="py-2.5 px-3">Lead Code</th>
                    <th className="py-2.5 px-3">Customer Name</th>
                    <th className="py-2.5 px-3">Phone</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Priority</th>
                    <th className="py-2.5 px-3">Queue Reason</th>
                    <th className="py-2.5 px-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE4EE]">
                  {unassignedLeads.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center">
                        <EmptyState
                          icon={CheckCircle}
                          title={leads.length === 0 ? 'No Leads in Pool' : 'All Leads Assigned'}
                          description={
                            leads.length === 0
                              ? 'Import or create leads to start assigning them to telecallers.'
                              : 'All available leads have been distributed to telecallers.'
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    unassignedLeads.map((lead) => {
                      const isChecked = selectedLeadIds.includes(lead.id);
                      const badge = formatUnassignedReason(lead.unassigned_reason);
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => handleToggleSelect(lead.id)}
                          className={`hover:bg-[#F6F8FB]/60 cursor-pointer transition-colors ${
                            isChecked ? 'bg-[#EAF2FB]/50' : ''
                          }`}
                        >
                          <td
                            className="py-2.5 px-3.5 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
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

          {/* Assigned Leads Table with Reassignment */}
          <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-subtle">
            <div className="p-4 border-b border-[#DCE4EE] flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
                  Assigned Leads Active Queue ({assignedLeads.length})
                </h3>
                <p className="text-[11px] text-[#64748B]">
                  Active leads currently assigned to telecallers. Reassign leads with recorded reason.
                </p>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] sticky top-0 font-medium">
                  <tr>
                    <th className="py-2.5 px-3">Lead Code</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Assigned Telecaller</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Priority</th>
                    <th className="py-2.5 px-3">Last Reassigned</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE4EE]">
                  {assignedLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-xs text-[#64748B]">
                        No assigned leads in queue.
                      </td>
                    </tr>
                  ) : (
                    assignedLeads.map((lead) => {
                      const assignee = telecallers.find((t) => t.id === lead.assigned_to);
                      return (
                        <tr key={lead.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-semibold text-[#1E4D8F]">
                            {lead.lead_code}
                          </td>
                          <td className="py-2.5 px-3 text-[#172B4D] font-medium">{lead.name}</td>
                          <td className="py-2.5 px-3 text-[#0B1F3A] font-semibold">
                            {assignee ? assignee.full_name : lead.assigned_to}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={lead.status} />
                          </td>
                          <td className="py-2.5 px-3">
                            <PriorityBadge priority={lead.priority} />
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-[#64748B]">
                            {lead.reassigned_at ? (
                              <span title={`Reason: ${lead.reassign_reason}`}>
                                {formatDate(lead.reassigned_at)} (Reassigned)
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => {
                                setReassignLead(lead);
                                setReassignTargetTcId('');
                                setReassignReason('');
                                setReassignError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#1E4D8F] hover:bg-[#EAF2FB] rounded-[6px] border border-[#C7DCF3] transition-colors"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reassign</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: SMART DISTRIBUTION RULES CONFIGURATION                             */}
      {/* ========================================================================= */}
      {activeTab === 'rules' && (
        <div className="max-w-2xl bg-white border border-[#DCE4EE] rounded-[12px] p-6 shadow-subtle space-y-6">
          <div className="border-b border-[#DCE4EE] pb-4">
            <h2 className="text-base font-bold text-[#0B1F3A]">Smart Distribution Rules</h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Configure how inbound leads and CSV imports are distributed across your telecaller team.
            </p>
          </div>

          {configSuccessMsg && (
            <div className="p-3 rounded-[8px] bg-[#EAF7EE] border border-[#C3EBD0] text-xs text-[#16845B] flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{configSuccessMsg}</span>
            </div>
          )}

          {configErrorMsg && (
            <div className="p-3 rounded-[8px] bg-[#FEECEB] border border-[#F8C8C6] text-xs text-[#C53030] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{configErrorMsg}</span>
            </div>
          )}

          {/* Mode Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider block">
              Organization Distribution Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'MANUAL',
                  title: 'Manual Assignment',
                  desc: 'Leads arrive in unassigned queue for manual allocation.',
                  icon: UserCheck,
                },
                {
                  id: 'ROUND_ROBIN',
                  title: 'Round-Robin',
                  desc: 'Rotates sequentially across all eligible telecallers.',
                  icon: Shuffle,
                },
                {
                  id: 'WORKLOAD_BALANCED',
                  title: 'Workload-Balanced',
                  desc: 'Prioritizes telecallers with lowest active open leads.',
                  icon: Scale,
                },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = configMode === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => setConfigMode(item.id as DistributionMode)}
                    className={`p-3.5 rounded-[10px] border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#EAF2FB] border-[#1E4D8F] shadow-subtle'
                        : 'bg-white border-[#DCE4EE] hover:border-[#C7DCF3]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon
                        className={`w-4 h-4 ${isSelected ? 'text-[#1E4D8F]' : 'text-[#64748B]'}`}
                      />
                      <span className="text-xs font-bold text-[#0B1F3A]">{item.title}</span>
                    </div>
                    <p className="text-[11px] text-[#64748B] leading-relaxed">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auto-distribute on import */}
          <div className="flex items-start gap-3 p-4 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
            <input
              type="checkbox"
              id="autoImportToggle"
              checked={configAutoImport}
              onChange={(e) => setConfigAutoImport(e.target.checked)}
              className="mt-0.5 rounded bg-white border-[#DCE4EE] text-[#0B1F3A] focus:ring-0"
            />
            <label htmlFor="autoImportToggle" className="cursor-pointer">
              <span className="text-xs font-bold text-[#0B1F3A] block">
                Auto-Distribute on CSV / Spreadsheet Import
              </span>
              <span className="text-[11px] text-[#64748B] block mt-0.5">
                Automatically execute selected distribution rule as soon as new leads are ingested.
              </span>
            </label>
          </div>

          {/* Maximum Workload Cap */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider block">
              Maximum Open-Lead Workload Cap (Optional)
            </label>
            <p className="text-[11px] text-[#64748B]">
              Prevents assigning leads to telecallers who already exceed this number of open leads.
              Overflow leads remain in unassigned queue. Leave blank for unlimited capacity.
            </p>
            <input
              type="number"
              min="1"
              value={configMaxWorkload}
              onChange={(e) => setConfigMaxWorkload(e.target.value)}
              placeholder="e.g. 50 (leaves blank for unlimited)"
              className="w-full sm:w-64 px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
            />
          </div>

          {/* Eligible Telecaller Pool */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider block">
                Eligible Telecaller Pool
              </label>
              <span className="text-[11px] text-[#64748B]">
                {configEligibleIds.length === 0
                  ? 'All active telecallers are eligible'
                  : `${configEligibleIds.length} telecallers selected`}
              </span>
            </div>
            <p className="text-[11px] text-[#64748B]">
              Select specific telecallers who participate in automatic distribution. Unchecked
              telecallers are excluded from automated assignment.
            </p>

            <div className="max-h-48 overflow-y-auto space-y-1.5 border border-[#DCE4EE] rounded-[10px] p-2 bg-[#F6F8FB]">
              {telecallers.map((tc) => {
                const isChecked = configEligibleIds.includes(tc.id);
                return (
                  <div
                    key={tc.id}
                    onClick={() => handleToggleEligible(tc.id)}
                    className={`flex items-center justify-between p-2.5 rounded-[8px] border text-xs cursor-pointer transition-colors ${
                      isChecked
                        ? 'bg-[#EAF2FB] border-[#C7DCF3] text-[#0B1F3A]'
                        : 'bg-white border-[#DCE4EE] text-[#64748B]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] ${
                          isChecked
                            ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white'
                            : 'border-[#DCE4EE] bg-white'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3" />}
                      </div>
                      <span className="font-semibold text-[#0B1F3A]">{tc.full_name}</span>
                    </div>
                    <span className="text-[11px] text-[#64748B]">
                      {db.getOpenLeadCount(tc.id, profile?.organization_id || '')} open leads
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4 border-t border-[#DCE4EE] flex justify-end">
            <button
              onClick={handleSaveConfig}
              disabled={isSavingConfig}
              className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
            >
              {isSavingConfig ? 'Saving Settings...' : 'Save Distribution Rules'}
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ASSIGNMENT HISTORY & AUDIT TRAIL                                    */}
      {/* ========================================================================= */}
      {activeTab === 'history' && (
        <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-subtle">
          <div className="p-4 border-b border-[#DCE4EE]">
            <h2 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
              Lead Assignment & Reassignment Audit Trail ({assignments.length})
            </h2>
            <p className="text-[11px] text-[#64748B]">
              Immutable audit history of all lead distributions, automated assignments, and recorded
              reassignment reasons.
            </p>
          </div>

          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] sticky top-0 font-medium">
                <tr>
                  <th className="py-2.5 px-3">Lead Code</th>
                  <th className="py-2.5 px-3">Mode / Type</th>
                  <th className="py-2.5 px-3">Assigned To</th>
                  <th className="py-2.5 px-3">Assigned By</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Previous Agent</th>
                  <th className="py-2.5 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE4EE]">
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-[#64748B]">
                      No assignment records yet.
                    </td>
                  </tr>
                ) : (
                  [...assignments].reverse().map((asgn) => {
                    const lead = leads.find((l) => l.id === asgn.lead_id);
                    const user = telecallers.find((t) => t.id === asgn.user_id);
                    const prevUser = telecallers.find((t) => t.id === asgn.previous_user_id);

                    return (
                      <tr key={asgn.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#1E4D8F]">
                          {lead ? lead.lead_code : asgn.lead_id}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              asgn.reassign_reason
                                ? 'bg-[#FEF6E7] text-[#B7791F] border-[#FBDFA8]'
                                : asgn.mode === 'WORKLOAD_BALANCED'
                                ? 'bg-[#EAF2FB] text-[#1E4D8F] border-[#C7DCF3]'
                                : asgn.mode === 'ROUND_ROBIN'
                                ? 'bg-[#EAF7EE] text-[#16845B] border-[#C3EBD0]'
                                : 'bg-[#F1F5F9] text-[#475569] border-[#DCE4EE]'
                            }`}
                          >
                            {asgn.reassign_reason
                              ? 'REASSIGNED'
                              : asgn.mode || 'MANUAL'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#0B1F3A]">
                          {user ? user.full_name : asgn.user_id}
                        </td>
                        <td className="py-2.5 px-3 text-[#64748B]">
                          {asgn.assigned_by === profile?.id ? 'You (Owner)' : asgn.assigned_by}
                        </td>
                        <td className="py-2.5 px-3 text-[#64748B]">
                          {formatDate(asgn.assigned_at)}
                        </td>
                        <td className="py-2.5 px-3 text-[#64748B]">
                          {prevUser ? prevUser.full_name : asgn.previous_user_id || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[#172B4D] max-w-xs truncate" title={asgn.reassign_reason || ''}>
                          {asgn.reassign_reason || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LEAD ASSIGN MODAL */}
      <LeadAssignModal
        selectedLeadIds={selectedLeadIds}
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        onAssigned={() => {
          setSelectedLeadIds([]);
          loadData();
        }}
      />

      {/* REASSIGNMENT MODAL */}
      {reassignLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-deep/20 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[12px] border border-[#DCE4EE] bg-white shadow-dropdown p-6 space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#DCE4EE]">
              <div className="p-2 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F]">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0B1F3A]">Reassign Lead</h2>
                <p className="text-xs text-[#64748B]">
                  Lead <strong className="text-[#0B1F3A] font-mono">{reassignLead.lead_code}</strong> ({reassignLead.name})
                </p>
              </div>
            </div>

            {reassignError && (
              <div className="p-3 rounded-[8px] bg-[#FEECEB] border border-[#F8C8C6] text-xs text-[#C53030] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{reassignError}</span>
              </div>
            )}

            {/* Target Telecaller Selector */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0B1F3A] block">
                Assign to New Telecaller <span className="text-[#C53030]">*</span>
              </label>
              <select
                value={reassignTargetTcId}
                onChange={(e) => setReassignTargetTcId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
              >
                <option value="">-- Choose New Telecaller --</option>
                {telecallers
                  .filter((tc) => tc.id !== reassignLead.assigned_to)
                  .map((tc) => {
                    const openCount = db.getOpenLeadCount(tc.id, profile?.organization_id || '');
                    const isCapped = config?.max_workload !== null && config?.max_workload !== undefined && openCount >= config.max_workload;
                    return (
                      <option key={tc.id} value={tc.id} disabled={isCapped}>
                        {tc.full_name} ({openCount} open leads{isCapped ? ' - AT CAPACITY' : ''})
                      </option>
                    );
                  })}
              </select>
            </div>

            {/* Mandatory Reason */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#0B1F3A] block">
                Reason for Reassignment <span className="text-[#C53030]">* (Mandatory)</span>
              </label>
              <textarea
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                rows={3}
                placeholder="e.g. Telecaller on medical leave; Customer requested regional language speaker; Workload redistribution"
                className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#1E4D8F]"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#DCE4EE]">
              <button
                type="button"
                onClick={() => setReassignLead(null)}
                className="px-4 py-2 rounded-[8px] text-xs font-medium text-[#64748B] hover:text-[#0B1F3A] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReassignment}
                disabled={isReassigning || !reassignTargetTcId || !reassignReason.trim()}
                className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
              >
                {isReassigning ? 'Reassigning...' : 'Confirm Reassignment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
