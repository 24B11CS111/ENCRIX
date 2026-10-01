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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Telephony Call Intelligence</h1>
          <p className="text-xs text-slate-400 mt-1">
            Audit calling logs, inspect durations, listen to compliance recordings & review caller outcomes.
          </p>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
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
            className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
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
            <tbody className="divide-y divide-slate-800/60">
              {paginatedCalls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No call records found matching criteria.
                  </td>
                </tr>
              ) : (
                paginatedCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-emerald-400">
                        {call.lead_code || 'LV-Lead'}
                      </div>
                      <div className="text-white font-medium">{call.lead_name || 'Customer'}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="text-slate-200 font-medium">{call.telecaller_name}</div>
                      <div className="text-[10px] text-slate-500">Gateway: {call.provider}</div>
                    </td>

                    <td className="py-3 px-3">
                      <div className="text-slate-300">{formatDateTime(call.started_at)}</div>
                      <div className="text-[10px] text-slate-500">{formatRelativeTime(call.created_at)}</div>
                    </td>

                    <td className="py-3 px-3 text-center font-mono font-bold text-white">
                      {formatDuration(call.duration_seconds)}
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                          call.outcome === 'POSITIVE' || call.outcome === 'CONVERTED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : call.outcome === 'NEGATIVE'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}
                      >
                        {call.outcome || 'COMPLETED'}
                      </span>
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate text-slate-400">
                      {call.notes || '—'}
                    </td>

                    <td className="py-3 px-4 text-right">
                      {call.recording_url ? (
                        <button
                          onClick={() =>
                            setPlayingCallId(playingCallId === call.id ? null : call.id)
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                            playingCallId === call.id
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                          }`}
                        >
                          {playingCallId === call.id ? (
                            <>
                              <Volume2 className="w-3.5 h-3.5 text-white animate-bounce" />
                              <span>Playing...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 text-emerald-400" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">Not recorded</span>
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
