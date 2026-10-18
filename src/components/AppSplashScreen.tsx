import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface AppSplashScreenProps {
  /**
   * Whether authentication or session restoration is currently in progress.
   */
  isLoading?: boolean;
  /**
   * Callback invoked once the splash animation and exit transition complete.
   */
  onComplete?: () => void;
  /**
   * Minimum display time for the brand animation sequence (ms). Defaults to 1600ms (~1.5–2s).
   * Can be overridden in unit tests or fast-forwarded via user click/key when auth is ready.
   */
  minDurationMs?: number;
  /**
   * Maximum safety timeout (ms) before forcing an exit, preventing any freeze on slow networks.
   * Defaults to 3500ms.
   */
  maxTimeoutMs?: number;
  /**
   * Optional manual override for reduced-motion testing or accessibility.
   */
  forceReducedMotion?: boolean;
}

export const AppSplashScreen: React.FC<AppSplashScreenProps> = ({
  isLoading = false,
  onComplete,
  minDurationMs = 1600,
  maxTimeoutMs = 3500,
  forceReducedMotion,
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const completedRef = useRef(false);
  const skipRequestedRef = useRef(false);

  const isReducedMotion =
    forceReducedMotion ??
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

  const triggerExit = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsExiting(true);

    if (isReducedMotion) {
      onComplete?.();
    } else {
      setTimeout(() => {
        onComplete?.();
      }, 250);
    }
  }, [isReducedMotion, onComplete]);

  // 1. Minimum brand animation timer (~1.5–2s)
  useEffect(() => {
    const minDelay = isReducedMotion ? 150 : minDurationMs;
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, minDelay);
    return () => clearTimeout(timer);
  }, [minDurationMs, isReducedMotion]);

  // 2. Safety timeout: prevents freezing on hangs or slow network auth
  useEffect(() => {
    const timeout = setTimeout(() => {
      triggerExit();
    }, maxTimeoutMs);
    return () => clearTimeout(timeout);
  }, [maxTimeoutMs, triggerExit]);

  // 3. Trigger smooth exit once min duration has passed and authentication resolved
  useEffect(() => {
    if (minTimeElapsed && !isLoading && !completedRef.current) {
      triggerExit();
    }
  }, [minTimeElapsed, isLoading, triggerExit]);

  // 4. Handle early skip when user requested fast-forward and auth finishes
  useEffect(() => {
    if (skipRequestedRef.current && !isLoading && !completedRef.current) {
      triggerExit();
    }
  }, [isLoading, triggerExit]);

  // Skip / Fast-Forward interaction handler
  const handleUserSkip = () => {
    if (completedRef.current) return;
    if (!isLoading) {
      triggerExit();
    } else {
      skipRequestedRef.current = true;
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="ENCRIX Secure CRM Initializing"
      data-testid="app-splash-screen"
      onClick={handleUserSkip}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
          handleUserSkip();
        }
      }}
      tabIndex={0}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white min-h-screen select-none cursor-default transition-opacity duration-300 ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle Pale-Blue Light Bloom Behind Logo */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[280px] sm:w-[500px] sm:h-[340px] rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(219,234,254,0.65)_0%,_rgba(239,246,255,0.35)_45%,_transparent_72%)] pointer-events-none blur-xl ${
          isReducedMotion ? 'opacity-40' : 'animate-logo-bloom'
        }`}
        aria-hidden="true"
      />

      {/* Center Composition: Complete Official ENCRIX Logo Lockup */}
      <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-xl">
        <div className="flex items-center justify-center gap-3.5 sm:gap-5 md:gap-6">
          {/* Official Geometric Blue E Mark */}
          <div
            data-testid="splash-logo"
            className={`relative flex items-center justify-center shrink-0 ${
              isReducedMotion ? 'opacity-100' : 'animate-splash-logo'
            }`}
          >
            <div
              className={`flex items-center justify-center ${
                isReducedMotion ? '' : 'animate-logo-float'
              }`}
            >
              <img
                src="/encrix-mark.png"
                alt="ENCRIX Symbol"
                className="w-14 sm:w-18 md:w-20 h-auto object-contain drop-shadow-[0_12px_22px_rgba(30,77,143,0.18)]"
              />
            </div>
          </div>

          {/* Official Wordmark & Tagline Lockup */}
          <div
            data-testid="splash-brand-text"
            className={`flex flex-col items-start justify-center text-left ${
              isReducedMotion ? 'opacity-100' : 'animate-splash-text'
            }`}
          >
            {/* Crisp Navy Wordmark */}
            <div className="overflow-hidden">
              <img
                src="/encrix-wordmark.png"
                alt="ENCRIX"
                className="h-8 sm:h-10 md:h-11 w-auto object-contain"
              />
            </div>

            {/* SECURE TELECALLER CRM Tagline */}
            <div className="mt-1.5 sm:mt-2 overflow-hidden">
              <img
                src="/encrix-tagline.png"
                alt="SECURE TELECALLER CRM"
                className={`h-2.5 sm:h-3 md:h-3.5 w-auto object-contain ${
                  isReducedMotion ? 'opacity-100' : 'animate-splash-tagline'
                }`}
              />
            </div>

            {/* Accessible screen-reader text & test matcher text */}
            <span className="sr-only">ENCRIX SECURE TELECALLER CRM</span>
          </div>
        </div>

        {/* Restrained Loading Indicator for extended authentication */}
        {isLoading && minTimeElapsed && (
          <div
            data-testid="splash-loading-indicator"
            className="mt-8 flex items-center gap-2.5 text-xs font-medium text-[#475569] bg-[#F1F5F9]/80 px-3.5 py-1.5 rounded-full border border-[#DCE4EE]"
          >
            <div className="h-3.5 w-3.5 rounded-full border-2 border-[#1E4D8F] border-t-transparent animate-spin" />
            <span>Initializing secure workspace...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppSplashScreen;
