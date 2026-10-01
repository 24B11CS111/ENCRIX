import React, { useState } from 'react';
import { Profile } from '@/types';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import { UserCheck, Shuffle, Check, AlertCircle } from 'lucide-react';

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
  const [method, setMethod] = useState<'MANUAL' | 'ROUND_ROBIN'>('ROUND_ROBIN');
  const [targetTelecallerId, setTargetTelecallerId] = useState<string>('');
  const [selectedTcIds, setSelectedTcIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !profile) return null;

  const telecallers = db.getTelecallers(profile);

  // Initialize selectedTcIds with all active telecallers if empty
  const activeTcIds = selectedTcIds.length > 0 ? selectedTcIds : telecallers.map((t) => t.id);

  const handleToggleTc = (id: string) => {
    if (activeTcIds.includes(id)) {
      if (activeTcIds.length > 1) {
        setSelectedTcIds(activeTcIds.filter((t) => t !== id));
      }
    } else {
      setSelectedTcIds([...activeTcIds, id]);
    }
  };

  const handleAssign = async () => {
    setIsSubmitting(true);
    try {
      if (method === 'MANUAL') {
        if (!targetTelecallerId) return;
        db.assignLeads(selectedLeadIds, targetTelecallerId, profile);
      } else {
        db.assignRoundRobin(selectedLeadIds, activeTcIds, profile);
      }
      onAssigned();
      onClose();
    } catch (err) {
      console.error('Assignment error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const perCaller = Math.floor(selectedLeadIds.length / Math.max(activeTcIds.length, 1));
  const remainder = selectedLeadIds.length % Math.max(activeTcIds.length, 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6">
        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-800">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Assign Leads to Telecallers</h2>
            <p className="text-xs text-slate-400">
              Distribute <strong className="text-emerald-400">{selectedLeadIds.length}</strong> selected leads
            </p>
          </div>
        </div>

        {/* Method Toggle */}
        <div className="grid grid-cols-2 gap-2 mt-4 p-1 rounded-xl bg-slate-950/80 border border-slate-800">
          <button
            type="button"
            onClick={() => setMethod('ROUND_ROBIN')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
              method === 'ROUND_ROBIN'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>Round-Robin</span>
          </button>

          <button
            type="button"
            onClick={() => setMethod('MANUAL')}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
              method === 'MANUAL'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Specific Caller</span>
          </button>
        </div>

        {/* Round-Robin Distribution Setup */}
        {method === 'ROUND_ROBIN' && (
          <div className="mt-4 space-y-3">
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-xs text-emerald-300">
              Each selected telecaller will receive approx. <strong>{perCaller} leads</strong>
              {remainder > 0 ? ` (+1 for ${remainder} callers)` : ''}.
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Active Telecallers in Pool ({activeTcIds.length})
              </span>
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {telecallers.map((tc) => {
                  const isChecked = activeTcIds.includes(tc.id);
                  return (
                    <div
                      key={tc.id}
                      onClick={() => handleToggleTc(tc.id)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-slate-800 border-emerald-500/40 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] ${
                            isChecked
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'border-slate-700 bg-slate-800'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-medium">{tc.full_name}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {tc.assigned_count || 0} existing leads
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Manual Single Caller Selection */}
        {method === 'MANUAL' && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-slate-300 block mb-1">Select Telecaller</label>
              <select
                value={targetTelecallerId}
                onChange={(e) => setTargetTelecallerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">-- Choose Telecaller --</option>
                {telecallers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.full_name} ({tc.phone})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={
              isSubmitting ||
              (method === 'MANUAL' && !targetTelecallerId) ||
              (method === 'ROUND_ROBIN' && activeTcIds.length === 0)
            }
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
          >
            {isSubmitting ? 'Distributing...' : 'Confirm Assignment'}
          </button>
        </div>
      </div>
    </div>
  );
};
