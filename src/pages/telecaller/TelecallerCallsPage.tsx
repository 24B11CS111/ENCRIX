import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Call } from '@/types';
import { formatDuration, formatDateTime } from '@/lib/utils';
import { PhoneCall, Play, Volume2 } from 'lucide-react';

export const TelecallerCallsPage: React.FC = () => {
  const { profile } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setCalls(db.getCalls(profile));

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'CALL_RECORDED' || type === 'CALL_OUTCOME_SAVED') {
        setCalls(db.getCalls(profile));
      }
    });

    return () => unsubscribe();
  }, [profile]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white tracking-tight">My Call History</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review your logged calls, durations, recorded interaction sessions and outcomes.
        </p>
      </div>

      {/* CALLS LIST */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Lead</th>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3 text-center">Duration</th>
                <th className="py-3 px-3">Outcome</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-right">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No calls recorded yet for your account.
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-emerald-400">{call.lead_code}</div>
                      <div className="text-white font-medium">{call.lead_name}</div>
                    </td>

                    <td className="py-3 px-3 text-slate-300 font-mono text-[11px]">
                      {formatDateTime(call.started_at)}
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
                      {call.recording_url && (
                        <button
                          onClick={() => setPlayingId(playingId === call.id ? null : call.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                            playingId === call.id
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                          }`}
                        >
                          {playingId === call.id ? (
                            <>
                              <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                              <span>Playing</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 text-emerald-400" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
