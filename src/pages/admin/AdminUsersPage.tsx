import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Profile, Organization } from '@/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { SearchBar } from '@/components/common/SearchBar';
import { formatDate } from '@/lib/utils';
import { Users, Ban, RotateCcw, Building } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const AdminUsersPage: React.FC = () => {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');

  const loadData = () => {
    if (!profile) return;
    setUsers(db.getProfiles(profile));
    setOrgs(db.getOrganizations(profile));
  };

  useEffect(() => {
    loadData();
  }, [profile]);

  const handleToggleStatus = (target: Profile) => {
    if (!profile) return;
    const next = target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    db.updateProfileStatus(target.id, next, profile);
    loadData();
  };

  const filteredUsers = users.filter((u) => {
    const matchSearch =
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (u.phone && u.phone.includes(search)) ||
      u.id.toLowerCase().includes(search.toLowerCase());

    const matchOrg = orgFilter === 'ALL' || u.organization_id === orgFilter;
    const matchRole = roleFilter === 'ALL' || u.role === roleFilter;

    return matchSearch && matchOrg && matchRole;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Platform User Governance</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Supervise user accounts, role allocations and account access statuses across all customer organizations.
        </p>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-[12px] border border-[#DCE4EE] shadow-sm">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => setSearch(val)}
            placeholder="Search user name, ID, phone..."
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
          >
            <option value="ALL">All Organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OWNER">OWNER</option>
            <option value="TELECALLER">TELECALLER</option>
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-3">Role</th>
              <th className="py-3 px-3">Organization</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Registered</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DCE4EE]">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <EmptyState
                    icon={Users}
                    title="No Users Found"
                    description={
                      users.length === 0
                        ? "Registered system users and telecallers will appear here."
                        : "No users matched your search and filter criteria."
                    }
                  />
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
              const org = orgs.find((o) => o.id === u.organization_id);
              return (
                <tr key={u.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size="sm" />
                      <div>
                        <div className="font-semibold text-[#172B4D]">{u.full_name}</div>
                        <div className="text-[11px] text-[#64748B] font-mono">{u.phone || '—'}</div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                        u.role === 'ADMIN'
                          ? 'bg-[#EAF2FB] text-[#1E4D8F] border-blue-200'
                          : u.role === 'OWNER'
                          ? 'bg-[#0B1F3A]/5 text-[#0B1F3A] border-[#0B1F3A]/20'
                          : 'bg-emerald-50 text-[#16845B] border-emerald-200'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-[#172B4D]">{org?.name || 'Platform'}</td>

                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        u.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-[#16845B] border-emerald-200'
                          : 'bg-rose-50 text-[#C53030] border-rose-200'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-[#64748B] font-mono text-[11px]">{formatDate(u.created_at)}</td>

                  <td className="py-3 px-4 text-right">
                    {u.role !== 'ADMIN' && (
                      <button
                        onClick={() => handleToggleStatus(u)}
                        className={`p-1.5 rounded-[8px] transition-colors ${
                          u.status === 'ACTIVE'
                            ? 'text-[#64748B] hover:text-[#C53030] hover:bg-rose-50'
                            : 'text-[#16845B] hover:bg-emerald-50'
                        }`}
                        title={u.status === 'ACTIVE' ? 'Disable Account' : 'Activate Account'}
                      >
                        {u.status === 'ACTIVE' ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
