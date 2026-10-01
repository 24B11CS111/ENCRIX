import React from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ShieldCheck, ShieldAlert, Check, X, LogOut, Lock } from 'lucide-react';

export const TelecallerProfilePage: React.FC = () => {
  const { profile, organization, logout } = useAuth();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Agent Profile & Security Bounds</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review your access credentials and organization data compliance terms.
        </p>
      </div>

      {/* User Card */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-4">
        <UserAvatar name={profile?.full_name || 'Agent'} avatarUrl={profile?.avatar_url} size="lg" />
        <div className="space-y-1">
          <div className="text-lg font-bold text-white">{profile?.full_name}</div>
          <div className="text-xs text-emerald-400 font-mono font-medium">{profile?.phone}</div>
          <div className="text-xs text-slate-400">
            {organization?.name} • Role: <strong className="text-white">{profile?.role}</strong>
          </div>
        </div>
      </div>

      {/* Role Boundaries Matrix */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-white font-semibold text-sm">
          <Lock className="w-4 h-4 text-emerald-400" />
          <span>Least-Privilege Policy Summary</span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-400">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to view assigned leads with masked contact details</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-400">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to dial customers via approved telephony gateway</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-400">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to record call outcomes, notes and schedule follow-ups</span>
          </div>
          <div className="flex items-center gap-2 text-rose-400 pt-1">
            <X className="w-4 h-4 shrink-0" />
            <span>Strictly prohibited from downloading, copying or exporting raw leads</span>
          </div>
          <div className="flex items-center gap-2 text-rose-400">
            <X className="w-4 h-4 shrink-0" />
            <span>Blocked from viewing unassigned leads or other telecallers' leads</span>
          </div>
          <div className="flex items-center gap-2 text-rose-400">
            <X className="w-4 h-4 shrink-0" />
            <span>Blocked from administrative settings and billing records</span>
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={() => logout()}
        className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 border border-slate-800 hover:border-rose-500/40 font-semibold text-xs rounded-xl transition-all"
      >
        <LogOut className="w-4 h-4" />
        <span>Log Out of LeadVault Workspace</span>
      </button>
    </div>
  );
};
