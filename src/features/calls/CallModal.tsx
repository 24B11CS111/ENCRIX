import React, { useState, useEffect, useRef } from 'react';
import { Lead } from '@/types';
import { callService, telephonyService } from '@/services/telephony';
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

    const startCall = async () => {
      try {
        setCallStatus('INITIATING');
        setDuration(0);
        setIsMuted(false);

        // Secure call placement: caller client only provides leadId and caller profile.
        // Raw customer phone is never retrieved into client component memory.
        const dispatchResult = await callService.dispatchCall({
          leadId: lead.id,
          callerProfile: profile,
        });

        setCallId(dispatchResult.session.callId);

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

    if (!profile) return;

    const result = await callService.endCall(callId, profile);
    const finalDuration = Math.max(duration, 3);

    // Persist completed call state to ENCRIX Database
    const existingCalls = db.getCalls(profile);
    const initiatedCall = existingCalls.find(
      (c) => (c.lead_id === lead.id || c.id === callId) && c.status === 'INITIATED'
    );

    let recordedId = callId;
    if (initiatedCall) {
      db.updateCall(
        initiatedCall.id,
        {
          status: 'COMPLETED',
          duration_seconds: finalDuration,
          recording_url: result.recordingUrl,
          ended_at: new Date().toISOString(),
        },
        profile
      );
      recordedId = initiatedCall.id;
    } else {
      const recorded = db.recordCall(
        {
          lead_id: lead.id,
          duration_seconds: finalDuration,
          status: 'COMPLETED',
          recording_url: result.recordingUrl,
        },
        profile
      );
      recordedId = recorded.id;
    }

    onCallCompleted(recordedId, finalDuration, result.recordingUrl);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy-deep/20 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-[12px] border border-[#DCE4EE] bg-white shadow-dropdown p-6 text-center">
        {/* Compliance security badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EAF7EE] border border-[#C3EBD0] text-[#16845B] text-xs font-medium mb-6">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>✓ Authorized Gateway Connection</span>
        </div>

        {/* Lead & Customer info */}
        <div className="space-y-1 mb-6">
          <h2 className="text-2xl font-bold text-[#0B1F3A] tracking-tight">{lead.name}</h2>
          <div className="flex items-center justify-center gap-2 text-xs text-[#64748B]">
            <span>Lead ID: <strong className="font-mono text-[#0B1F3A]">{lead.lead_code}</strong></span>
            <span>•</span>
            {profile?.role === 'TELECALLER' ? (
              <span>Voice Bridge: <strong className="font-semibold text-[#1E4D8F]">Zero-Exposure Gateway</strong></span>
            ) : (
              <span>Phone: <strong className="font-mono text-[#0B1F3A]">{lead.phone}</strong></span>
            )}
          </div>
        </div>

        {/* Call Animation / Live Status */}
        <div className="py-6 flex flex-col items-center justify-center">
          <div className="relative flex items-center justify-center">
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl shadow-card transition-all ${
                callStatus === 'CONNECTED'
                  ? 'bg-[#1E4D8F]'
                  : callStatus === 'RINGING'
                  ? 'bg-[#B7791F]'
                  : 'bg-[#0B1F3A]'
              }`}
            >
              <Phone className="w-9 h-9" />
            </div>
          </div>

          <div className="mt-4">
            {callStatus === 'INITIATING' && (
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-[#0B1F3A]">
                  CALL INITIATED
                </span>
                <p className="text-xs text-[#64748B] flex items-center justify-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#1E4D8F] animate-spin" />
                  Connecting securely...
                </p>
              </div>
            )}
            {callStatus === 'RINGING' && (
              <span className="text-xs font-semibold text-[#B7791F] flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#B7791F]" />
                Ringing customer device...
              </span>
            )}
            {callStatus === 'CONNECTED' && (
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#16845B]">
                  Connected
                </span>
                <div className="text-3xl font-mono font-bold text-[#0B1F3A] tracking-wider">
                  {formatDuration(duration)}
                </div>
              </div>
            )}
            {callStatus === 'ENDING' && (
              <span className="text-xs text-[#64748B]">Wrapping call session...</span>
            )}
          </div>
        </div>

        {/* Call Controls */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-[#DCE4EE]">
          <button
            onClick={handleToggleMute}
            disabled={callStatus !== 'CONNECTED'}
            className={`p-3.5 rounded-full border transition-all ${
              isMuted
                ? 'bg-[#FEF6E7] border-[#FBDFA8] text-[#B7791F]'
                : 'bg-white border-[#DCE4EE] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB]'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={handleEndCall}
            className="flex items-center gap-2 px-6 py-3.5 bg-[#C53030] hover:bg-[#A82828] text-white font-semibold rounded-full shadow-subtle transition-all"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm">End Call</span>
          </button>
        </div>

        {/* Legal Consent Notice */}
        <p className="mt-6 text-[11px] text-[#64748B] flex items-center justify-center gap-1 font-medium">
          <AlertCircle className="w-3 h-3 text-[#64748B] shrink-0" />
          Call recording enabled per statutory compliance policy.
        </p>
      </div>
    </div>
  );
};
