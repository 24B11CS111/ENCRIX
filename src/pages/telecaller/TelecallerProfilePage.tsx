import React from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ShieldCheck, ShieldAlert, Check, X, LogOut, Lock } from 'lucide-react';

export const TelecallerProfilePage: React.FC = () => {
  const { profile, organization, logout } = useAuth();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Agent Profile & Security Bounds</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Review your access credentials and organization data compliance terms.
        </p>
      </div>

      {/* User Card */}
      <div className="p-6 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm flex items-center gap-4">
        <UserAvatar name={profile?.full_name || 'Agent'} avatarUrl={profile?.avatar_url} size="lg" />
        <div className="space-y-1">
          <div className="text-lg font-bold text-[#0B1F3A]">{profile?.full_name}</div>
          <div className="text-xs text-[#1E4D8F] font-mono font-medium">{profile?.phone}</div>
          <div className="text-xs text-[#64748B]">
            {organization?.name} • Role: <strong className="text-[#172B4D]">{profile?.role}</strong>
          </div>
        </div>
      </div>

      {/* Role Boundaries Matrix */}
      <div className="p-6 rounded-[16px] bg-white border border-[#DCE4EE] shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-[#0B1F3A] font-semibold text-sm">
          <Lock className="w-4 h-4 text-[#16845B]" />
          <span>Least-Privilege Policy Summary</span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-[#16845B]">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to view assigned leads with masked contact details</span>
          </div>
          <div className="flex items-center gap-2 text-[#16845B]">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to dial customers via approved telephony gateway</span>
          </div>
          <div className="flex items-center gap-2 text-[#16845B]">
            <Check className="w-4 h-4 shrink-0" />
            <span>Authorized to record call outcomes, notes and schedule follow-ups</span>
          </div>
          <div className="flex items-center gap-2 text-[#C53030] pt-1">
            <X className="w-4 h-4 shrink-0" />
            <span>Strictly prohibited from downloading, copying or exporting raw leads</span>
          </div>
          <div className="flex items-center gap-2 text-[#C53030]">
            <X className="w-4 h-4 shrink-0" />
            <span>Blocked from viewing unassigned leads or other telecallers' leads</span>
          </div>
          <div className="flex items-center gap-2 text-[#C53030]">
            <X className="w-4 h-4 shrink-0" />
            <span>Blocked from administrative settings and billing records</span>
          </div>
        </div>
      </div>

      {/* Logout */}
      <button
        onClick={() => logout()}
        className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-rose-50 text-[#64748B] hover:text-[#C53030] border border-[#DCE4EE] hover:border-rose-300 font-semibold text-xs rounded-[10px] transition-all shadow-sm"
      >
        <LogOut className="w-4 h-4" />
        <span>Log Out of ENCRIX Workspace</span>
      </button>
    </div>
  );
};
