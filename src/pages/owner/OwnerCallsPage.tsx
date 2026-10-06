import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Call, Profile } from '@/types';
import { SearchBar } from '@/components/common/SearchBar';
import { Pagination } from '@/components/common/Pagination';
import { formatDuration, formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  PhoneCall,
  Play,
  Volume2,
  Calendar,
  Clock,
  ShieldCheck,
  Headphones,
} from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

export const OwnerCallsPage: React.FC = () => {
  const { profile } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [telecallers, setTelecallers] = useState<Profile[]>([]);

  const [search, setSearch] = useState('');
  const [telecallerFilter, setTelecallerFilter] = useState('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 12;

  const loadData = () => {
    if (!profile) return;
    setCalls(db.getCalls(profile));
    setTelecallers(db.getTelecallers(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'CALL_RECORDED' || type === 'CALL_OUTCOME_SAVED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const filteredCalls = calls.filter((call) => {
    const matchSearch =
      (call.lead_code && call.lead_code.toLowerCase().includes(search.toLowerCase())) ||
      (call.lead_name && call.lead_name.toLowerCase().includes(search.toLowerCase())) ||
      (call.telecaller_name && call.telecaller_name.toLowerCase().includes(search.toLowerCase())) ||
      (call.notes && call.notes.toLowerCase().includes(search.toLowerCase()));

    const matchTc = telecallerFilter === 'ALL' || call.telecaller_id === telecallerFilter;
    const matchOutcome = outcomeFilter === 'ALL' || call.outcome === outcomeFilter;

    return matchSearch && matchTc && matchOutcome;
  });

  const totalPages = Math.ceil(filteredCalls.length / pageSize);
  const paginatedCalls = filteredCalls.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Telephony Call Intelligence</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Audit calling logs, inspect durations, listen to compliance recordings & review caller outcomes.
          </p>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 rounded-[12px] border border-[#DCE4EE] shadow-sm">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={(val) => {
              setSearch(val);
              setCurrentPage(1);
            }}
            placeholder="Search lead code, caller name, notes..."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={telecallerFilter}
            onChange={(e) => {
              setTelecallerFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
          >
            <option value="ALL">All Telecallers</option>
            {telecallers.map((tc) => (
              <option key={tc.id} value={tc.id}>
                {tc.full_name}
              </option>
            ))}
          </select>

          <select
            value={outcomeFilter}
            onChange={(e) => {
              setOutcomeFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 bg-white border border-[#DCE4EE] rounded-[10px] text-xs text-[#172B4D] focus:outline-none focus:border-[#0B1F3A]"
          >
            <option value="ALL">All Outcomes</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEGATIVE">Negative</option>
            <option value="FOLLOW_UP">Follow-Up</option>
            <option value="CONVERTED">Converted</option>
            <option value="NO_ANSWER">No Answer</option>
            <option value="BUSY">Busy</option>
          </select>
        </div>
      </div>

      {/* CALLS TABLE */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Lead</th>
                <th className="py-3 px-3">Telecaller</th>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3 text-center">Duration</th>
                <th className="py-3 px-3">Outcome</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-right">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4EE]">
              {paginatedCalls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <EmptyState
                      icon={PhoneCall}
                      title={calls.length === 0 ? 'No call records yet' : 'No calls matching filters'}
                      description={
                        calls.length === 0
                          ? 'Calls placed by telecallers will appear here in real-time with durations, outcomes, and audit logs.'
                          : 'Try adjusting your search criteria or telecaller and outcome filters.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                paginatedCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-[#1E4D8F]">
                        {call.lead_code || 'ENC-Lead'}
                      </div>
                      <div className="text-[#172B4D] font-medium">{call.lead_name || 'Customer'}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="text-[#172B4D] font-medium">{call.telecaller_name}</div>
                      <div className="text-[10px] text-[#64748B]">Gateway: {call.provider}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="text-[#172B4D]">{formatDateTime(call.started_at)}</div>
                      <div className="text-[10px] text-[#64748B]">{formatRelativeTime(call.created_at)}</div>
                    </td>

                    <td className="py-3 px-3 text-center font-mono font-bold text-[#0B1F3A]">
                      {formatDuration(call.duration_seconds)}
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          call.outcome === 'POSITIVE' || call.outcome === 'CONVERTED'
                            ? 'bg-emerald-50 text-[#16845B] border-emerald-200'
                            : call.outcome === 'NEGATIVE'
                            ? 'bg-rose-50 text-[#C53030] border-rose-200'
                            : call.outcome === 'FOLLOW_UP'
                            ? 'bg-blue-50 text-[#1E4D8F] border-blue-200'
                            : 'bg-[#F6F8FB] text-[#64748B] border-[#DCE4EE]'
                        }`}
                      >
                        {call.outcome || 'COMPLETED'}
                      </span>
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate text-[#64748B]">
                      {call.notes || '—'}
                    </td>

                    <td className="py-3 px-4 text-right">
                      {call.recording_url ? (
                        <button
                          onClick={() =>
                            setPlayingCallId(playingCallId === call.id ? null : call.id)
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11px] font-medium border transition-colors ${
                            playingCallId === call.id
                              ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white'
                              : 'bg-white border-[#DCE4EE] text-[#172B4D] hover:bg-[#F6F8FB]'
                          }`}
                        >
                          {playingCallId === call.id ? (
                            <>
                              <Volume2 className="w-3.5 h-3.5 text-white animate-bounce" />
                              <span>Playing...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 text-[#1E4D8F]" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#94A3B8]">Not recorded</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredCalls.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      </div>
    </div>
  );
};
