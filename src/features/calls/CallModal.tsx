import React, { useState, useEffect, useRef } from 'react';
import { Lead } from '@/types';
import { telephonyService } from '@/services/telephony';
import { db } from '@/services/supabase/db';
import { useAuth } from '@/features/auth/AuthContext';
import { formatDuration } from '@/lib/utils';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  ShieldCheck,
  AlertCircle,
  Radio,
} from 'lucide-react';

interface CallModalProps {
  lead: Lead;
  isOpen: boolean;
  onClose: () => void;
  onCallCompleted: (callId: string, durationSeconds: number, recordingUrl: string) => void;
}

export const CallModal: React.FC<CallModalProps> = ({
  lead,
  isOpen,
  onClose,
  onCallCompleted,
}) => {
  const { profile } = useAuth();
  const [callStatus, setCallStatus] = useState<'INITIATING' | 'RINGING' | 'CONNECTED' | 'ENDING'>('INITIATING');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callId, setCallId] = useState<string>('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen || !profile) return;

    let activeCallId = '';

    const startCall = async () => {
      try {
        setCallStatus('INITIATING');
        setDuration(0);
        setIsMuted(false);

        // Telecaller calls through secure gateway; actual phone retrieved securely server-side
        const secureNumber = db.getAuthorizedCallingNumber(lead.id, profile);

        const session = await telephonyService.initiateCall({
          leadId: lead.id,
          telecallerId: profile.id,
          phoneNumber: secureNumber,
        });

        activeCallId = session.callId;
        setCallId(session.callId);

        // Progress ringing -> connected
        setTimeout(() => {
          setCallStatus('RINGING');
        }, 1200);

        setTimeout(() => {
          setCallStatus('CONNECTED');
          timerRef.current = window.setInterval(() => {
            setDuration((prev) => prev + 1);
          }, 1000);
        }, 2800);
      } catch (err) {
        console.error('Telephony error:', err);
      }
    };

    startCall();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, lead.id, profile]);

  if (!isOpen) return null;

  const handleToggleMute = async () => {
    if (!callId) return;
    const next = !isMuted;
    await telephonyService.toggleMute(callId, next);
    setIsMuted(next);
  };

  const handleEndCall = async () => {
    setCallStatus('ENDING');
    if (timerRef.current) clearInterval(timerRef.current);

    const result = await telephonyService.endCall(callId);
    const finalDuration = Math.max(duration, 3); // Ensure at least 3 seconds counted

    // Persist call to LeadVault Database
    if (profile) {
      const recorded = db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: finalDuration,
          status: 'COMPLETED',
          recording_url: result.recordingUrl,
        },
        profile
      );

      onCallCompleted(recorded.id, finalDuration, result.recordingUrl);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 text-center">
        {/* Compliance security badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs mb-6">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Authorized Gateway Connection</span>
        </div>

        {/* Lead & Customer info */}
        <div className="space-y-1 mb-6">
          <span className="text-xs font-semibold text-emerald-400 tracking-wider">
            {lead.lead_code}
          </span>
          <h2 className="text-2xl font-bold text-white tracking-tight">{lead.name}</h2>
          <p className="text-sm font-mono text-slate-400">{lead.phone}</p>
        </div>

        {/* Call Animation / Live Status */}
        <div className="py-6 flex flex-col items-center justify-center">
          <div className="relative flex items-center justify-center">
            {callStatus === 'CONNECTED' && (
              <span className="absolute w-24 h-24 rounded-full bg-emerald-500/20 animate-ping" />
            )}
            {callStatus === 'RINGING' && (
              <span className="absolute w-20 h-20 rounded-full bg-amber-500/20 animate-pulse" />
            )}
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl shadow-xl transition-all ${
                callStatus === 'CONNECTED'
                  ? 'bg-emerald-600 text-white'
                  : callStatus === 'RINGING'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              <Phone className="w-9 h-9" />
            </div>
          </div>

          <div className="mt-4">
            {callStatus === 'INITIATING' && (
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                Connecting securely to gateway...
              </span>
            )}
            {callStatus === 'RINGING' && (
              <span className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                Ringing customer device...
              </span>
            )}
            {callStatus === 'CONNECTED' && (
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Call In Progress
                </span>
                <div className="text-3xl font-mono font-bold text-white tracking-wider">
                  {formatDuration(duration)}
                </div>
              </div>
            )}
            {callStatus === 'ENDING' && (
              <span className="text-xs text-slate-400">Wrapping call session...</span>
            )}
          </div>
        </div>

        {/* Call Controls */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-slate-800">
          <button
            onClick={handleToggleMute}
            disabled={callStatus !== 'CONNECTED'}
            className={`p-3.5 rounded-full border transition-all ${
              isMuted
                ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={handleEndCall}
            className="flex items-center gap-2 px-6 py-3.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-full shadow-lg hover:shadow-rose-900/30 transition-all"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm">End Call</span>
          </button>
        </div>

        {/* Legal Consent Notice */}
        <p className="mt-6 text-[11px] text-slate-500 flex items-center justify-center gap-1">
          <AlertCircle className="w-3 h-3 text-slate-500 shrink-0" />
          Call recording enabled per statutory compliance policy.
        </p>
      </div>
    </div>
  );
};
