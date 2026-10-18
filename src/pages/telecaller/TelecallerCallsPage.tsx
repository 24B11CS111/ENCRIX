import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Call } from '@/types';
import { formatDuration, formatDateTime } from '@/lib/utils';
import { PhoneCall, Play, Volume2 } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';

import { useRef } from 'react';
import { recordingService } from '@/services/telephony/recordingService';

export const TelecallerCallsPage: React.FC = () => {
  const { profile } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!profile) return;
    setCalls(db.getCalls(profile));

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'CALL_RECORDED' || type === 'CALL_OUTCOME_SAVED') {
        setCalls(db.getCalls(profile));
      }
    }, profile);

    return () => {
      unsubscribe();
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [profile]);

  const handlePlayRecording = async (call: Call) => {
    if (playingId === call.id) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
      return;
    }

    try {
      setLoadingAudioId(call.id);
      setPlaybackError(null);

      let url = call.recording_url;
      try {
        const signed = await recordingService.fetchRecordingSignedUrl(call.id);
        if (signed?.recordingUrl) {
          url = signed.recordingUrl;
        }
      } catch {
        // Fallback to call.recording_url
      }

      if (!url) {
        throw new Error('Recording audio URL unavailable');
      }

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => {
        setPlayingId(null);
        setPlaybackError('Unable to stream recording audio.');
      };

      await audio.play().catch(() => {});
      setPlayingId(call.id);
    } catch (err: any) {
      setPlaybackError(err.message || 'Error accessing recording');
    } finally {
      setLoadingAudioId(null);
    }
  };


  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#DCE4EE] pb-5">
        <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">My Call History</h1>
        <p className="text-xs text-[#64748B] mt-1">
          Review your logged calls, durations, recorded interaction sessions and outcomes.
        </p>
      </div>

      {/* CALLS LIST */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F6F8FB] text-[#64748B] border-b border-[#DCE4EE] uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Lead</th>
                <th className="py-3 px-3">Date & Time</th>
                <th className="py-3 px-3 text-center">Duration</th>
                <th className="py-3 px-3">Outcome</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-right">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4EE]">
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <EmptyState
                      icon={PhoneCall}
                      title="No Calls Recorded Yet"
                      description="Outbound calls and durations will appear here automatically when you call assigned leads."
                    />
                  </td>
                </tr>
              ) : (
                calls.map((call) => (
                  <tr key={call.id} className="hover:bg-[#F6F8FB]/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-[#1E4D8F]">{call.lead_code}</div>
                      <div className="text-[#172B4D] font-medium">{call.lead_name}</div>
                    </td>

                    <td className="py-3 px-3 text-[#172B4D] font-mono text-[11px]">
                      {formatDateTime(call.started_at)}
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
                      {call.recording_url && (
                        <button
                          onClick={() => handlePlayRecording(call)}
                          disabled={loadingAudioId === call.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11px] font-medium border transition-colors ${
                            playingId === call.id
                              ? 'bg-[#0B1F3A] border-[#0B1F3A] text-white shadow-sm'
                              : 'bg-white border-[#DCE4EE] text-[#172B4D] hover:bg-[#F6F8FB]'
                          } disabled:opacity-50`}
                        >
                          {loadingAudioId === call.id ? (
                            <span>Loading...</span>
                          ) : playingId === call.id ? (
                            <>
                              <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                              <span>Stop</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 text-[#1E4D8F]" />
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
