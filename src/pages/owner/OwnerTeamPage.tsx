import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Profile, Lead, Call } from '@/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Users,
  UserPlus,
  Headphones,
  CheckCircle,
  PhoneCall,
  TrendingUp,
  Shield,
  Ban,
  RotateCcw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const OwnerTeamPage: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);

  // Add telecaller form modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTcName, setNewTcName] = useState('');
  const [newTcPhone, setNewTcPhone] = useState('');
  const [newTcEmail, setNewTcEmail] = useState('');

  const loadData = () => {
    if (!profile) return;
    setTelecallers(db.getProfiles(profile).filter((p) => p.role === 'TELECALLER'));
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'TEAM_UPDATED' || type === 'CALL_RECORDED' || type === 'LEADS_ASSIGNED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const handleCreateTelecaller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    try {
      db.createTelecaller(
        {
          full_name: newTcName,
          phone: newTcPhone,
          email: newTcEmail,
        },
        profile
      );

      setNewTcName('');
      setNewTcPhone('');
      setNewTcEmail('');
      setIsAddOpen(false);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleStatus = (tc: Profile) => {
    if (!profile) return;
    const nextStatus = tc.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    db.updateProfileStatus(tc.id, nextStatus, profile);
    loadData();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Telecaller Team Management</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage caller credentials, monitor calling output, and enforce least-privilege access rules.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Add New Telecaller</span>
        </button>
      </div>

      {/* TEAM TABLE (Section 28 Columns) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Telecaller</th>
                <th className="py-3 px-3">Agent ID</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-center">Assigned Leads</th>
                <th className="py-3 px-3 text-center">Calls Logged</th>
                <th className="py-3 px-3 text-center">Positive Outcomes</th>
                <th className="py-3 px-3 text-center">Conversion</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {telecallers.map((tc) => {
                const assigned = leads.filter((l) => l.assigned_to === tc.id).length;
                const tcCalls = calls.filter((c) => c.telecaller_id === tc.id).length;
                const positive = leads.filter(
                  (l) => l.assigned_to === tc.id && (l.status === 'INTERESTED' || l.status === 'CONVERTED')
                ).length;
                const convRate = assigned > 0 ? Math.round((positive / assigned) * 100) : 0;

                return (
                  <tr key={tc.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={tc.full_name} avatarUrl={tc.avatar_url} size="sm" />
                        <div>
                          <div className="font-semibold text-white">{tc.full_name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{tc.phone}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">{tc.id}</td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                          tc.status === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}
                      >
                        {tc.status}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center font-bold text-white">{assigned}</td>

                    <td className="py-3 px-3 text-center text-slate-300 font-medium">{tcCalls}</td>

                    <td className="py-3 px-3 text-center text-emerald-400 font-semibold">{positive}</td>

                    <td className="py-3 px-3 text-center">
                      <span className="text-white font-medium">{convRate}%</span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate('/owner/assignments')}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
                        >
                          Assign Leads
                        </button>

                        <button
                          onClick={() => handleToggleStatus(tc)}
                          className={`p-1.5 rounded transition-colors ${
                            tc.status === 'ACTIVE'
                              ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-950/40'
                              : 'text-emerald-400 hover:bg-emerald-950/40'
                          }`}
                          title={tc.status === 'ACTIVE' ? 'Disable Account' : 'Re-enable Account'}
                        >
                          {tc.status === 'ACTIVE' ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD TELECALLER MODAL */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6">
            <h2 className="text-base font-bold text-white mb-1">Add New Telecaller</h2>
            <p className="text-xs text-slate-400 mb-4">
              Create restricted credentials for calling workspace. LeadVault RLS will automatically isolate lead views.
            </p>

            <form onSubmit={handleCreateTelecaller} className="space-y-3.5">
              <div>
                <label className="text-xs text-slate-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newTcName}
                  onChange={(e) => setNewTcName(e.target.value)}
                  placeholder="e.g. Ramesh Chandra"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  value={newTcPhone}
                  onChange={(e) => setNewTcPhone(e.target.value)}
                  placeholder="+91 98000 11223"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  value={newTcEmail}
                  onChange={(e) => setNewTcEmail(e.target.value)}
                  placeholder="ramesh@vertex.com"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
                >
                  Create Telecaller
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
