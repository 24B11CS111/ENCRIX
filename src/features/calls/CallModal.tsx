import React, { useState, useEffect, useRef } from 'react';
import type { CallStatus, Lead } from '@/types';
import { callService } from '@/services/telephony';
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
  const [callStatus, setCallStatus] = useState<CallStatus | 'INITIATING' | 'ENDING'>('INITIATING');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [callId, setCallId] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen || !profile) return;

    const startCall = async () => {
      try {
        setCallStatus('INITIATING');
        setDuration(0);
        setIsMuted(false);
        setActionError(null);
        setStatusMessage(null);

        // Secure call placement: caller client only provides leadId and caller profile.
        // Raw customer phone is never retrieved into client component memory.
        const dispatchResult = await callService.dispatchCall({
          leadId: lead.id,
          callerProfile: profile,
        });

        setCallId(dispatchResult.session.callId);

        if (callService.isLiveMode()) {
          const modalStatus = dispatchResult.session.status === 'IN_PROGRESS'
            ? 'CONNECTED'
            : dispatchResult.session.status;
          setCallStatus(modalStatus);

          let polling = false;
          const pollStatus = async () => {
            if (polling) return;
            polling = true;
            try {
              const snapshot = await callService.getCallStatus(dispatchResult.session.callId);
              setActionError(null);
              const status = snapshot.status === 'IN_PROGRESS' ? 'CONNECTED' : snapshot.status;
              setCallStatus(status);
              if (['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED'].includes(status)) {
                if (timerRef.current) window.clearInterval(timerRef.current);
                timerRef.current = null;
                onCallCompleted(dispatchResult.session.callId, snapshot.durationSeconds, '');
              }
            } catch {
              setActionError('Call status is temporarily unavailable.');
            } finally {
              polling = false;
            }
          };

          void pollStatus();
          timerRef.current = window.setInterval(() => void pollStatus(), 2500);
          return;
        }

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
      } catch {
        setActionError('Call could not be started. Please try again or contact support.');
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
    setActionError(null);
    setStatusMessage(null);
    try {
      await callService.toggleMute(callId, next);
      setIsMuted(next);
    } catch {
      setActionError('Live call mute control is unavailable in this deployment.');
    }
  };

  const handleEndCall = async () => {
    if (!profile) return;

    const statusBeforeEnd = callStatus;
    setActionError(null);
    setStatusMessage(null);
    setCallStatus('ENDING');
    if (timerRef.current && !callService.isLiveMode()) clearInterval(timerRef.current);

    let result: Awaited<ReturnType<typeof callService.endCall>>;
    try {
      result = await callService.endCall(callId, profile);
    } catch {
      if (callService.isLiveMode()) {
        setCallStatus(statusBeforeEnd === 'ENDING' ? 'INITIATING' : statusBeforeEnd);
      } else {
        setCallStatus('CONNECTED');
      }
      setActionError('Could not confirm the end-call request. Call status remains authoritative.');
      return;
    }

    if (result.mode === 'live') {
      setCallStatus(result.status === 'IN_PROGRESS' ? 'CONNECTED' : result.status);
      setStatusMessage(result.accepted
        ? 'End request accepted. Waiting for provider status confirmation.'
        : 'The provider has already ended this call; waiting for persisted status.');
      return;
    }
    const finalDuration = Math.max(duration, result.durationSeconds, 1);

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
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-6 ${
          callService.isLiveMode()
            ? 'bg-[#EAF7EE] border border-[#C3EBD0] text-[#16845B]'
            : 'bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E]'
        }`}>
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>
            {callService.isLiveMode()
              ? '✓ Live Telephony Gateway'
              : '⚠️ Demo Mode • Simulated Call Session'}
          </span>
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
                  {callService.isLiveMode() ? 'CALL REQUEST ACCEPTED' : 'CALL INITIATED'}
                </span>
                <p className="text-xs text-[#64748B] flex items-center justify-center gap-1.5">
                  {!callService.isLiveMode() && <Radio className="w-3.5 h-3.5 text-[#1E4D8F] animate-spin" />}
                  {callService.isLiveMode()
                    ? 'Waiting for server call status. Live controls are not available.'
                    : 'Connecting securely...'}
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
                  {callService.isLiveMode() ? 'Live Connected' : 'Simulated Call Active'}
                </span>
                <div className="text-3xl font-mono font-bold text-[#0B1F3A] tracking-wider">
                  {callService.isLiveMode() ? 'In progress' : formatDuration(duration)}
                </div>
              </div>
            )}
            {['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'FAILED'].includes(callStatus) && (
              <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                Call {callStatus.replaceAll('_', ' ').toLowerCase()}
              </span>
            )}
            {callStatus === 'ENDING' && (
              <span className="text-xs text-[#64748B]">Wrapping call session...</span>
            )}
            {actionError && (
              <p role="alert" className="mt-3 text-xs text-[#C53030]">{actionError}</p>
            )}
            {statusMessage && (
              <p role="status" className="mt-3 text-xs text-[#64748B]">{statusMessage}</p>
            )}
          </div>
        </div>

        {/* Call Controls */}
        <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-[#DCE4EE]">
          <button
            onClick={handleToggleMute}
            disabled={callStatus !== 'CONNECTED' || callService.isLiveMode()}
            className={`p-3.5 rounded-full border transition-all ${
              isMuted
                ? 'bg-[#FEF6E7] border-[#FBDFA8] text-[#B7791F]'
                : 'bg-white border-[#DCE4EE] text-[#64748B] hover:text-[#0B1F3A] hover:bg-[#F6F8FB]'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={callService.isLiveMode()
              ? 'Mute is unsupported for the current direct-dial call architecture'
              : isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={handleEndCall}
            disabled={!callId || callStatus === 'ENDING'}
            className="flex items-center gap-2 px-6 py-3.5 bg-[#C53030] hover:bg-[#A82828] text-white font-semibold rounded-full shadow-subtle transition-all"
            title="End Call"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-sm">End Call</span>
          </button>
        </div>
        {callService.isLiveMode() && (
          <p className="mt-3 text-[11px] text-[#64748B]">
            Mute is unavailable for direct-dial calls. Status and end requests are confirmed by the server.
          </p>
        )}

        {/* Legal Consent Notice */}
        <p className="mt-6 text-[11px] text-[#64748B] flex items-center justify-center gap-1 font-medium">
          <AlertCircle className="w-3 h-3 text-[#64748B] shrink-0" />
          Call recording enabled per statutory compliance policy.
        </p>
      </div>
    </div>
  );
};
