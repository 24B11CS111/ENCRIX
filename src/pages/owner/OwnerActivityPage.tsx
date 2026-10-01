import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { ActivityLog } from '@/types';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import { Activity, Shield, User, FileText, Phone, Key } from 'lucide-react';

export const OwnerActivityPage: React.FC = () => {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const loadData = () => {
    if (!profile) return;
    setLogs(db.getActivityLogs(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'ACTIVITY_LOGGED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const filteredLogs = logs.filter((log) => {
    const matchSearch =
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      (log.user_name && log.user_name.toLowerCase().includes(search.toLowerCase())) ||
      (log.entity_type && log.entity_type.toLowerCase().includes(search.toLowerCase()));

    const matchAction = actionFilter === 'ALL' || log.action === actionFilter;

    return matchSearch && matchAction;
  });

  const totalPages = Math.ceil(filteredLogs.length / pageSize);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">Organization Audit Trail</h1>
        <p className="text-xs text-slate-400 mt-1">
          Immutable event log of user logins, lead creations, queue assignments, calls, and security events.
        </p>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder="Search action, user name..."
          />
        </div>

        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
        >
          <option value="ALL">All Actions</option>
          <option value="CALL_COMPLETED">CALL_COMPLETED</option>
          <option value="LEAD_ASSIGNED">LEAD_ASSIGNED</option>
          <option value="LEAD_CREATED">LEAD_CREATED</option>
          <option value="OUTCOME_CHANGED">OUTCOME_CHANGED</option>
          <option value="FOLLOWUP_CREATED">FOLLOWUP_CREATED</option>
          <option value="LOGIN">LOGIN</option>
          <option value="EXPORT_ATTEMPT">EXPORT_ATTEMPT</option>
        </select>
      </div>

      {/* LOGS TABLE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-3">Action</th>
                <th className="py-3 px-3">Actor</th>
                <th className="py-3 px-3">Role</th>
                <th className="py-3 px-3">Entity</th>
                <th className="py-3 px-4">Audit Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                    {formatDateTime(log.created_at)}
                  </td>

                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                        log.action.includes('EXPORT') || log.action.includes('SECURITY')
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                          : log.action.includes('CALL')
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                          : log.action.includes('ASSIGN')
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/25'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {log.action}
                    </span>
                  </td>

                  <td className="py-3 px-3 font-medium text-white">{log.user_name || 'System'}</td>

                  <td className="py-3 px-3">
                    <span className="text-slate-400 text-[11px]">{log.user_role || 'SYSTEM'}</span>
                  </td>

                  <td className="py-3 px-3 capitalize text-slate-300">{log.entity_type}</td>

                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400 max-w-sm truncate">
                    {log.metadata ? JSON.stringify(log.metadata) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLogs.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      </div>
    </div>
  );
};
