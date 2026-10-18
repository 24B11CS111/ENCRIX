import React, { useState, useMemo } from 'react';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import { DistributionMode } from '@/types';
import { UserCheck, Shuffle, Scale, AlertTriangle, Layers } from 'lucide-react';

interface LeadAssignModalProps {
  selectedLeadIds: string[];
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
}

export const LeadAssignModal: React.FC<LeadAssignModalProps> = ({
  selectedLeadIds,
  isOpen,
  onClose,
  onAssigned,
}) => {
  const { profile } = useAuth();
  const [method, setMethod] = useState<DistributionMode>('ROUND_ROBIN');
  const [targetTelecallerId, setTargetTelecallerId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute live distribution preview
  const preview = useMemo(() => {
    if (!isOpen || !profile || method === 'MANUAL') return null;
    try {
      return db.previewDistribution(selectedLeadIds, method, profile);
    } catch {
      return null;
    }
  }, [isOpen, selectedLeadIds, method, profile]);

  if (!isOpen || !profile) return null;

  const telecallers = db.getTelecallers(profile).filter((t) => t.status === 'ACTIVE');
  const orgConfig = db.getDistributionConfig(profile);

  const handleAssign = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (method === 'MANUAL') {
        if (!targetTelecallerId) {
          setErrorMsg('Please select a target telecaller.');
          setIsSubmitting(false);
          return;
        }
        db.distributeLeads(
          {
            leadIds: selectedLeadIds,
            mode: 'MANUAL',
            targetTelecallerId,
          },
          profile
        );
      } else {
        db.distributeLeads(
          {
            leadIds: selectedLeadIds,
            mode: method,
          },
          profile
        );
      }
      onAssigned();
      onClose();
    } catch (err: any) {
      console.error('Assignment error:', err);
      setErrorMsg(err.message || 'Failed to distribute leads.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-deep/20 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-[12px] border border-[#DCE4EE] bg-white shadow-dropdown p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2.5 pb-4 border-b border-[#DCE4EE]">
          <div className="p-2 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-[#1E4D8F]">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1F3A]">Smart Lead Distribution</h2>
            <p className="text-xs text-[#64748B]">
              Distribute <strong className="text-[#0B1F3A]">{selectedLeadIds.length}</strong> selected leads to telecallers
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-[8px] bg-[#FEECEB] border border-[#F8C8C6] text-xs text-[#C53030] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Method Toggle */}
        <div className="grid grid-cols-3 gap-1.5 mt-4 p-1 rounded-[10px] bg-[#F6F8FB] border border-[#DCE4EE]">
          <button
            type="button"
            onClick={() => setMethod('ROUND_ROBIN')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-[8px] text-xs font-semibold transition-all ${
              method === 'ROUND_ROBIN'
                ? 'bg-[#0B1F3A] text-white shadow-subtle'
                : 'text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Round-Robin</span>
          </button>

          <button
            type="button"
            onClick={() => setMethod('WORKLOAD_BALANCED')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-[8px] text-xs font-semibold transition-all ${
              method === 'WORKLOAD_BALANCED'
                ? 'bg-[#0B1F3A] text-white shadow-subtle'
                : 'text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Workload</span>
          </button>

          <button
            type="button"
            onClick={() => setMethod('MANUAL')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-[8px] text-xs font-semibold transition-all ${
              method === 'MANUAL'
                ? 'bg-[#0B1F3A] text-white shadow-subtle'
                : 'text-[#64748B] hover:text-[#0B1F3A]'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Specific Caller</span>
          </button>
        </div>

        {/* Live Distribution Preview (for automated modes) */}
        {preview && method !== 'MANUAL' && (
          <div className="mt-4 space-y-3">
            <div className="p-3 rounded-[8px] bg-[#EAF2FB] border border-[#C7DCF3] text-xs space-y-1">
              <div className="flex items-center justify-between text-[#0B1F3A] font-semibold">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#1E4D8F]" />
                  Projected Distribution
                </span>
                <span>
                  {preview.assignable_count} of {preview.total_leads} assignable
                </span>
              </div>
              {preview.unassigned_count > 0 && (
                <div className="text-[11px] text-[#B7791F] flex items-center gap-1 pt-1 border-t border-[#C7DCF3]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {preview.unassigned_count} leads will remain unassigned (
                    {preview.unassigned_reason === 'CAPACITY_REACHED'
                      ? 'Telecaller max workload cap reached'
                      : preview.unassigned_reason || 'No eligible telecaller'}
                    ).
                  </span>
                </div>
              )}
            </div>

            {/* Per-Telecaller Breakdown */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                Telecaller Projected Workload
              </span>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {preview.telecaller_breakdown.map((item) => (
                  <div
                    key={item.telecaller_id}
                    className="flex items-center justify-between p-2.5 rounded-[8px] border border-[#DCE4EE] bg-[#F6F8FB] text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#16845B]" />
                      <span className="font-semibold text-[#0B1F3A]">{item.telecaller_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#64748B]">
                        {item.current_open_leads} open
                      </span>
                      {item.leads_to_assign > 0 && (
                        <span className="text-[11px] font-bold text-[#16845B]">
                          +{item.leads_to_assign}
                        </span>
                      )}
                      <span className="font-mono font-semibold text-[#1E4D8F]">
                        &rarr; {item.projected_open_leads}
                      </span>
                      {item.at_capacity && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#FEF6E7] text-[#B7791F] border border-[#FBDFA8]">
                          MAX
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Manual Single Caller Selection */}
        {method === 'MANUAL' && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-[#172B4D] block mb-1">
                Select Telecaller
              </label>
              <select
                value={targetTelecallerId}
                onChange={(e) => setTargetTelecallerId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] shadow-subtle focus:outline-none focus:border-[#1E4D8F]"
              >
                <option value="">-- Choose Telecaller --</option>
                {telecallers.map((tc) => {
                  const openCount = db.getOpenLeadCount(tc.id, profile.organization_id);
                  const isCapped = orgConfig.max_workload !== null && openCount >= orgConfig.max_workload;
                  return (
                    <option key={tc.id} value={tc.id} disabled={isCapped}>
                      {tc.full_name} ({openCount} open leads{isCapped ? ' - AT CAPACITY' : ''})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#DCE4EE]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] text-xs font-medium text-[#64748B] hover:text-[#0B1F3A] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={
              isSubmitting ||
              (method === 'MANUAL' && !targetTelecallerId) ||
              (method !== 'MANUAL' && telecallers.length === 0)
            }
            className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] disabled:opacity-40 text-white text-xs font-semibold rounded-[10px] shadow-subtle transition-all"
          >
            {isSubmitting ? 'Distributing...' : 'Confirm Assignment'}
          </button>
        </div>
      </div>
    </div>
  );
};
