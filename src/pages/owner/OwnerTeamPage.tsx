import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Profile, Lead, Call, OrganizationInvitation } from '@/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  UserPlus,
  Headphones,
  CheckCircle,
  Ban,
  RotateCcw,
  Copy,
  Check,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { formatMaskedPhone } from '@/lib/phoneNormalization';
import { formatMaskedEmail } from '@/lib/emailNormalization';

export const OwnerTeamPage: React.FC = () => {
  const { profile, inviteTelecaller } = useAuth();
  const navigate = useNavigate();

  const [telecallers, setTelecallers] = useState<Profile[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);

  // Add / Invite telecaller form modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTcName, setNewTcName] = useState('');
  const [newTcPhone, setNewTcPhone] = useState('');
  const [newTcEmail, setNewTcEmail] = useState('');
  const [inviteResult, setInviteResult] = useState<OrganizationInvitation | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = () => {
    if (!profile) return;
    try {
      setTelecallers(db.getProfiles(profile).filter((p) => p.role === 'TELECALLER'));
      setInvitations(db.getInvitations(profile));
      setLeads(db.getLeads(profile));
      setCalls(db.getCalls(profile));
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (
        type === 'TEAM_UPDATED' ||
        type === 'CALL_RECORDED' ||
        type === 'LEADS_ASSIGNED' ||
        type === 'INVITATIONS_UPDATED'
      ) {
        loadData();
      }
    }, profile);

    return () => unsubscribe();
  }, [profile]);

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setFormError(null);
    setIsSubmitting(true);

    try {
      const res = await inviteTelecaller({
        fullName: newTcName.trim(),
        email: newTcEmail.trim(),
        phone: newTcPhone.trim() || undefined,
      });

      if (res.success && res.invitation) {
        setInviteResult(res.invitation);
        loadData();
      } else {
        setFormError(res.error || 'Failed to send invitation');
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to send invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = (tc: Profile) => {
    if (!profile) return;
    const nextStatus = tc.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    db.updateProfileStatus(tc.id, nextStatus, profile);
    loadData();
  };

  const handleRevokeInvitation = (invId: string) => {
    if (!profile) return;
    try {
      db.revokeInvitation(invId, profile);
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyLink = (token: string) => {
    const link = `${window.location.origin}/accept-invitation?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const resetModal = () => {
    setIsAddOpen(false);
    setInviteResult(null);
    setNewTcName('');
    setNewTcPhone('');
    setNewTcEmail('');
    setFormError(null);
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Telecaller Team Management</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Invite telecallers via OTP verification, monitor calling output, and enforce least-privilege tenant access.
          </p>
        </div>

        <button
          onClick={() => {
            resetModal();
            setIsAddOpen(true);
          }}
          className="flex items-center gap-2 px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Invite Telecaller</span>
        </button>
      </div>

      {/* TEAM TABLE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#0B1F3A]">Active Telecallers ({telecallers.length})</h2>
        </div>

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
                        title="No Active Telecallers"
                        description="Invite telecallers to start assigning leads and monitoring outbound calling performance."
                        actionText="Invite Telecaller"
                        onAction={() => {
                          resetModal();
                          setIsAddOpen(true);
                        }}
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
                              <div className="text-[11px] text-[#64748B] font-mono">
                                {tc.phone ? formatMaskedPhone(tc.phone) : '—'}
                              </div>
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
                              className="px-2.5 py-1 rounded-[8px] bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-[11px] font-medium transition-colors shadow-sm cursor-pointer"
                            >
                              Assign Leads
                            </button>

                            <button
                              onClick={() => handleToggleStatus(tc)}
                              className={`p-1.5 rounded-[8px] transition-colors cursor-pointer ${
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
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* PENDING INVITATIONS SECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#0B1F3A]">
            Pending Invitations ({invitations.filter((i) => i.status === 'PENDING').length})
          </h2>
        </div>

        <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
          {invitations.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#64748B]">
              No pending invitations. When you invite telecallers, their activation links and OTP verification states will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Invited Name</th>
                    <th className="py-3 px-3">Email (Masked)</th>
                    <th className="py-3 px-3">Role</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Expires At</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE4EE]">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                      <td className="py-3 px-4 font-semibold text-[#172B4D]">{inv.full_name}</td>
                      <td className="py-3 px-3 font-mono text-[#64748B]">
                        {inv.email ? formatMaskedEmail(inv.email) : inv.phone_number ? formatMaskedPhone(inv.phone_number) : '—'}
                      </td>
                      <td className="py-3 px-3 font-semibold text-[#1E4D8F]">TELECALLER</td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${
                            inv.status === 'PENDING'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : inv.status === 'ACCEPTED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[#64748B]">
                        {new Date(inv.expires_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {inv.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleCopyLink(inv.token)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-[11px] font-medium transition-colors shadow-sm cursor-pointer"
                              >
                                {copiedToken === inv.token ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span className="text-emerald-600 font-semibold">Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3 text-[#64748B]" />
                                    <span>Copy Link</span>
                                  </>
                                )}
                              </button>

                              <button
                                onClick={() => handleRevokeInvitation(inv.id)}
                                className="p-1.5 rounded-[8px] text-[#64748B] hover:text-[#C53030] hover:bg-rose-50 transition-colors cursor-pointer"
                                title="Revoke Invitation"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* INVITE TELECALLER MODAL */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1F3A]/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-[16px] border border-[#DCE4EE] bg-white shadow-xl p-6">
            <h2 className="text-base font-bold text-[#0B1F3A] mb-1">Invite Telecaller</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Send an invitation to a caller. The telecaller must verify ownership of their email address via OTP before workspace activation.
            </p>

            {inviteResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-[12px] text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <span>Invitation Created Successfully</span>
                  </div>
                  <p className="text-emerald-700 text-[11px]">
                    Share this verified onboarding link with <span className="font-semibold">{inviteResult.full_name}</span>:
                  </p>
                  <div className="p-2 bg-white rounded-[8px] border border-emerald-200 font-mono text-[11px] text-[#172B4D] break-all select-all">
                    {`${window.location.origin}/accept-invitation?token=${inviteResult.token}`}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handleCopyLink(inviteResult.token)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all cursor-pointer"
                  >
                    {copiedToken === inviteResult.token ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Link Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Onboarding Link</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={resetModal}
                    className="px-4 py-2.5 border border-[#DCE4EE] text-xs font-semibold text-[#172B4D] hover:bg-[#F6F8FB] rounded-[10px] transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendInvitation} className="space-y-3.5">
                {formError && (
                  <div className="p-3 bg-[#FEECEB] border border-[#F8C8C6] rounded-[8px] text-xs text-[#C53030]">
                    {formError}
                  </div>
                )}

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
                  <label className="text-xs text-[#172B4D] font-medium block mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={newTcEmail}
                    onChange={(e) => setNewTcEmail(e.target.value)}
                    placeholder="ramesh@vertex.com"
                    className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#172B4D] font-medium block mb-1">
                    Phone Number <span className="text-[#94A3B8] font-normal">(Optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={newTcPhone}
                    onChange={(e) => setNewTcPhone(e.target.value)}
                    placeholder="+91 98000 11223"
                    className="w-full px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#DCE4EE]">
                  <button
                    type="button"
                    onClick={resetModal}
                    className="px-4 py-2 text-xs text-[#64748B] hover:text-[#172B4D] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[10px] shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Sending Invitation...' : 'Send Invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
