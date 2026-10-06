import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { ActivityLog } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';

export const AdminActivityPage: React.FC = () => {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    if (!profile) return;
    setLogs(db.getActivityLogs(profile));
  }, [profile]);

  const filteredLogs = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      (l.user_name && l.user_name.toLowerCase().includes(search.toLowerCase())) ||
      (l.organization_id && l.organization_id.toLowerCase().includes(search.toLowerCase()))
  );

  const totalPages = Math.ceil(filteredLogs.length / pageSize);
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Platform-Wide Activity Stream</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Complete cross-organization activity and audit record log.
        </p>
      </div>

      <div className="max-w-md">
        <SearchBar value={search} onChange={(v) => setSearch(v)} placeholder="Filter platform activity..." />
      </div>

      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] font-semibold uppercase">
            <tr>
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-3">Organization</th>
              <th className="py-3 px-3">Actor</th>
              <th className="py-3 px-3">Action</th>
              <th className="py-3 px-4">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DCE4EE]">
            {paginatedLogs.map((log) => (
              <tr key={log.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                <td className="py-3 px-4 text-[#64748B] font-mono text-[11px] whitespace-nowrap">
                  {formatDateTime(log.created_at)}
                </td>
                <td className="py-3 px-3 font-mono text-[#172B4D]">{log.organization_id}</td>
                <td className="py-3 px-3 text-[#172B4D] font-medium">{log.user_name || 'System'}</td>
                <td className="py-3 px-3 font-mono text-[#1E4D8F] font-semibold">{log.action}</td>
                <td className="py-3 px-4 font-mono text-[#64748B] text-[11px] max-w-sm truncate">
                  {JSON.stringify(log.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredLogs.length}
          pageSize={pageSize}
          onPageChange={(p) => setCurrentPage(p)}
        />
      </div>
    </div>
  );
};
