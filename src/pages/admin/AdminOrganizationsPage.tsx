import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Organization } from '@/types';
import { Building2, Plus, Ban, CheckCircle, Shield } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export const AdminOrganizationsPage: React.FC = () => {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgIndustry, setNewOrgIndustry] = useState('Real Estate');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setOrgs(db.getOrganizations(profile));
  };

  useEffect(() => {
    loadData();
  }, [profile]);

  const handleCreateOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;

    db.createOrganization({
      name: newOrgName,
      industry: newOrgIndustry,
      company_size: '11-50',
      owner_id: `owner-auto-${Date.now()}`,
    });

    setNewOrgName('');
    setIsModalOpen(false);
    loadData();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Organization Tenants</h1>
          <p className="text-xs text-slate-400 mt-1">
            Create, suspend and configure customer enterprise tenant workspaces.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Provision Tenant</span>
        </button>
      </div>

      {/* Organizations Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Organization</th>
              <th className="py-3 px-3">Tenant ID / Slug</th>
              <th className="py-3 px-3">Industry</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Provisioned Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {orgs.map((org) => (
              <tr key={org.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-white text-sm">{org.name}</span>
                  </div>
                </td>
                <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">{org.slug}</td>
                <td className="py-3 px-3 text-slate-300">{org.industry}</td>
                <td className="py-3 px-3">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    {org.status}
                  </span>
                </td>
                <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{formatDate(org.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6">
            <h2 className="text-base font-bold text-white mb-1">Provision New Tenant</h2>
            <p className="text-xs text-slate-400 mb-4">
              Allocates an isolated database namespace with dedicated RLS barriers.
            </p>

            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div>
                <label className="text-xs text-slate-300 block mb-1">Company / Organization Name</label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. Nexus Capital & Real Estate"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">Industry</label>
                <input
                  type="text"
                  required
                  value={newOrgIndustry}
                  onChange={(e) => setNewOrgIndustry(e.target.value)}
                  placeholder="e.g. Insurance Agency"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  Provision Tenant
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
