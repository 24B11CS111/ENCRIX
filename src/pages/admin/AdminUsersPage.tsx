import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Profile, Organization } from '@/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { SearchBar } from '@/components/common/SearchBar';
import { Users, Ban, RotateCcw, Building } from 'lucide-react';
import { formatDate } from '@/lib/utils';

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
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Platform User Governance</h1>
        <p className="text-xs text-slate-400 mt-1">
          Supervise user accounts, role allocations and account access statuses across all customer organizations.
        </p>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="OWNER">OWNER</option>
            <option value="TELECALLER">TELECALLER</option>
          </select>
        </div>
      </div>

      {/* TABLE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-3">Role</th>
              <th className="py-3 px-3">Organization</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Registered</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filteredUsers.map((u) => {
              const org = orgs.find((o) => o.id === u.organization_id);
              return (
                <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size="sm" />
                      <div>
                        <div className="font-semibold text-white">{u.full_name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{u.phone || '—'}</div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                        u.role === 'ADMIN'
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                          : u.role === 'OWNER'
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-slate-300">{org?.name || 'Platform'}</td>

                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        u.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>

                  <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{formatDate(u.created_at)}</td>

                  <td className="py-3 px-4 text-right">
                    {u.role !== 'ADMIN' && (
                      <button
                        onClick={() => handleToggleStatus(u)}
                        className={`p-1.5 rounded transition-colors ${
                          u.status === 'ACTIVE'
                            ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-950/40'
                            : 'text-emerald-400 hover:bg-emerald-950/40'
                        }`}
                        title={u.status === 'ACTIVE' ? 'Disable Account' : 'Activate Account'}
                      >
                        {u.status === 'ACTIVE' ? <Ban className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
