import React, { useRef, useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  onResend?: () => void;
  cooldownSeconds?: number;
  expiresAt?: string | number;
  resendAvailableAt?: string | number;
  isLoading?: boolean;
  error?: string | null;
  disabled?: boolean;
}

export const OtpInput: React.FC<OtpInputProps> = ({
  value,
  onChange,
  onComplete,
  onResend,
  cooldownSeconds = 60,
  expiresAt,
  resendAvailableAt,
  isLoading = false,
  error = null,
  disabled = false,
}) => {
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Calculate authoritative remaining seconds against Date.now()
  const computeTimes = () => {
    const now = Date.now();
    let resendRem = 0;
    let expiresRem = Infinity;

    if (resendAvailableAt) {
      const ts = typeof resendAvailableAt === 'string' ? new Date(resendAvailableAt).getTime() : resendAvailableAt;
      resendRem = Math.max(0, Math.ceil((ts - now) / 1000));
    } else {
      resendRem = cooldownSeconds;
    }

    if (expiresAt) {
      const ts = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt;
      expiresRem = Math.max(0, Math.ceil((ts - now) / 1000));
    }

    return { resendRem, expiresRem };
  };

  const initial = computeTimes();
  const [resendCountdown, setResendCountdown] = useState<number>(initial.resendRem);
  const [expiresCountdown, setExpiresCountdown] = useState<number>(initial.expiresRem);

  const isExpired = expiresAt !== undefined && expiresCountdown <= 0;

  useEffect(() => {
    const update = () => {
      const { resendRem, expiresRem } = computeTimes();
      setResendCountdown(resendRem);
      setExpiresCountdown(expiresRem);
    };

    update();
    const interval = setInterval(update, 1000);

    const handleSync = () => {
      update();
    };

    window.addEventListener('visibilitychange', handleSync);
    window.addEventListener('focus', handleSync);

    return () => {
      clearInterval(interval);
      window.removeEventListener('visibilitychange', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, [resendAvailableAt, expiresAt, cooldownSeconds]);

  // Auto-focus first input on mount
  useEffect(() => {
    if (!disabled && !isExpired && inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, [disabled, isExpired]);

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const char = e.target.value.slice(-1);
    if (char && !/^\d$/.test(char)) return;

    const newDigits = [...digits];
    newDigits[index] = char;
    const combined = newDigits.join('');
    onChange(combined);

    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (combined.length === 6 && onComplete) {
      onComplete(combined);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        onChange(newDigits.join(''));
      } else {
        const newDigits = [...digits];
        newDigits[index] = '';
        onChange(newDigits.join(''));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    onChange(pasted);
    const targetIdx = Math.min(pasted.length, 5);
    inputRefs.current[targetIdx]?.focus();

    if (pasted.length === 6 && onComplete) {
      onComplete(pasted);
    }
  };

  const handleResendClick = () => {
    if (resendCountdown > 0 || disabled || isLoading) return;
    if (onResend) {
      onResend();
    }
  };

  return (
    <div className="space-y-4">
      {/* 6 Digit Input Boxes */}
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <input
            key={idx}
            ref={(el) => { inputRefs.current[idx] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digits[idx] || ''}
            disabled={disabled || isLoading || isExpired}
            onChange={(e) => handleChange(idx, e)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono rounded-[10px] border transition-all outline-none ${
              error || isExpired
                ? 'border-[#F8C8C6] bg-[#FEECEB] text-[#C53030] focus:border-[#C53030]'
                : digits[idx]
                ? 'border-[#0B1F3A] bg-white text-[#0B1F3A] shadow-sm'
                : 'border-[#DCE4EE] bg-white text-[#172B4D] hover:border-[#1E4D8F]/60 focus:border-[#0B1F3A] focus:ring-2 focus:ring-[#0B1F3A]/10'
            }`}
          />
        ))}
      </div>

      {isExpired && (
        <div className="text-center text-xs text-[#C53030] font-medium bg-[#FEECEB] py-1.5 px-3 rounded-[6px] border border-[#F8C8C6]">
          OTP code has expired. Please request a new code below.
        </div>
      )}

      {/* Resend Actions & Cooldown */}
      <div className="flex items-center justify-between text-xs text-[#64748B] pt-1">
        <span>
          {resendCountdown > 0 ? (
            <span className="font-medium">
              Resend available in <span className="font-semibold text-[#0B1F3A] font-mono">{resendCountdown}s</span>
              {expiresAt !== undefined && expiresCountdown > 0 && expiresCountdown < Infinity && (
                <span className="ml-1 text-[#94A3B8]">({expiresCountdown}s expiry)</span>
              )}
            </span>
          ) : (
            <span className="text-[#64748B]">Didn't receive the code?</span>
          )}
        </span>

        <button
          type="button"
          onClick={handleResendClick}
          disabled={resendCountdown > 0 || disabled || isLoading}
          className={`inline-flex items-center gap-1 font-semibold transition-colors ${
            resendCountdown > 0 || disabled || isLoading
              ? 'text-[#94A3B8] cursor-not-allowed opacity-60'
              : 'text-[#1E4D8F] hover:text-[#0B1F3A] cursor-pointer'
          }`}
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Resend OTP</span>
        </button>
      </div>
    </div>
  );
};
