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
import { EmptyState } from '@/components/common/EmptyState';

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Telecaller Team Management</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Manage caller credentials, monitor calling output, and enforce least-privilege access rules.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Add New Telecaller</span>
        </button>
      </div>

      {/* TEAM TABLE (Section 28 Columns) */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
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
            <tbody className="divide-y divide-[#DCE4EE]">
              {telecallers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <EmptyState
                      icon={Headphones}
                      title="No Telecallers Added Yet"
                      description="Create telecaller accounts to start assigning leads and monitoring outbound calling performance."
                      actionText="Add Telecaller"
                      onAction={() => setIsAddOpen(true)}
                    />
                  </td>
                </tr>
              ) : (
                telecallers.map((tc) => {
                const assigned = leads.filter((l) => l.assigned_to === tc.id).length;
                const tcCalls = calls.filter((c) => c.telecaller_id === tc.id).length;
                const positive = leads.filter(
                  (l) => l.assigned_to === tc.id && (l.status === 'INTERESTED' || l.status === 'CONVERTED')
                ).length;
                const convRate = assigned > 0 ? Math.round((positive / assigned) * 100) : 0;

                return (
                  <tr key={tc.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={tc.full_name} avatarUrl={tc.avatar_url} size="sm" />
                        <div>
                          <div className="font-semibold text-[#172B4D]">{tc.full_name}</div>
                          <div className="text-[11px] text-[#64748B] font-mono">{tc.phone}</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 font-mono text-[#64748B] text-[11px]">{tc.id}</td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                          tc.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-[#16845B] border-emerald-200'
                            : 'bg-rose-50 text-[#C53030] border-rose-200'
                        }`}
                      >
                        {tc.status}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center font-bold text-[#0B1F3A]">{assigned}</td>

                    <td className="py-3 px-3 text-center text-[#172B4D] font-medium">{tcCalls}</td>

                    <td className="py-3 px-3 text-center text-[#16845B] font-semibold">{positive}</td>

                    <td className="py-3 px-3 text-center">
                      <span className="text-[#0B1F3A] font-semibold">{convRate}%</span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate('/owner/assignments')}
                          className="px-2.5 py-1 rounded-[8px] bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-[11px] font-medium transition-colors shadow-sm"
                        >
                          Assign Leads
                        </button>

                        <button
                          onClick={() => handleToggleStatus(tc)}
                          className={`p-1.5 rounded-[8px] transition-colors ${
                            tc.status === 'ACTIVE'
                              ? 'text-[#64748B] hover:text-[#C53030] hover:bg-rose-50'
                              : 'text-[#16845B] hover:bg-emerald-50'
                          }`}
                          title={tc.status === 'ACTIVE' ? 'Disable Account' : 'Re-enable Account'}
                        >
                          {tc.status === 'ACTIVE' ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD TELECALLER MODAL */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1F3A]/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[16px] border border-[#DCE4EE] bg-white shadow-xl p-6">
            <h2 className="text-base font-bold text-[#0B1F3A] mb-1">Add New Telecaller</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Create restricted credentials for calling workspace. ENCRIX RLS will automatically isolate lead views.
            </p>

            <form onSubmit={handleCreateTelecaller} className="space-y-3.5">
              <div>
                <label className="text-xs text-[#172B4D] font-medium block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newTcName}
                  onChange={(e) => setNewTcName(e.target.value)}
                  placeholder="e.g. Ramesh Chandra"
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
                />
              </div>

              <div>
                <label className="text-xs text-[#172B4D] font-medium block mb-1">Phone Number</label>
                <input
                  type="text"
                  required
                  value={newTcPhone}
                  onChange={(e) => setNewTcPhone(e.target.value)}
                  placeholder="+91 98000 11223"
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
                />
              </div>

              <div>
                <label className="text-xs text-[#172B4D] font-medium block mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  value={newTcEmail}
                  onChange={(e) => setNewTcEmail(e.target.value)}
                  placeholder="ramesh@vertex.com"
                  className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#DCE4EE]">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-xs text-[#64748B] hover:text-[#172B4D]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all"
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
