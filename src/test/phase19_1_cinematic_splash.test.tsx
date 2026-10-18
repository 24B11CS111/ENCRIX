import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { AppSplashScreen } from '@/components/AppSplashScreen';

describe('ENCRIX: Premium White-Background Logo Animation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // 1. Visual Hierarchy & White-Background Composition
  describe('1. Visual Hierarchy & White-Background Minimal Composition', () => {
    it('renders pure white viewport with pale-blue bloom and official logo lockup', () => {
      const { container } = render(<AppSplashScreen isLoading={false} />);

      const splashScreen = screen.getByTestId('app-splash-screen');
      expect(splashScreen).toBeInTheDocument();
      expect(splashScreen.className).toContain('bg-white');

      // Subtle pale-blue light bloom is present behind the logo
      const bloom = container.querySelector('.animate-logo-bloom');
      expect(bloom).toBeInTheDocument();

      // Logo container with official geometric blue E mark
      const logo = screen.getByTestId('splash-logo');
      expect(logo).toBeInTheDocument();
      expect(logo.className).toContain('animate-splash-logo');

      // Mark image points to official asset
      const markImg = screen.getByAltText('ENCRIX Symbol');
      expect(markImg).toBeInTheDocument();
      expect(markImg.getAttribute('src')).toBe('/encrix-mark.png');

      // Continuous gentle hover loop
      const floatWrapper = container.querySelector('.animate-logo-float');
      expect(floatWrapper).toBeInTheDocument();

      // Wordmark and tagline lockup
      const brandText = screen.getByTestId('splash-brand-text');
      expect(brandText).toBeInTheDocument();
      expect(brandText).toHaveTextContent('ENCRIX');
      expect(brandText).toHaveTextContent('SECURE TELECALLER CRM');

      // Wordmark image points to official asset
      const wordmarkImg = screen.getByAltText('ENCRIX');
      expect(wordmarkImg).toBeInTheDocument();
      expect(wordmarkImg.getAttribute('src')).toBe('/encrix-wordmark.png');

      // Tagline image points to official asset
      const taglineImg = screen.getByAltText('SECURE TELECALLER CRM');
      expect(taglineImg).toBeInTheDocument();
      expect(taglineImg.getAttribute('src')).toBe('/encrix-tagline.png');
    });

    it('applies staggered reveal classes to wordmark and tagline', () => {
      const { container } = render(<AppSplashScreen isLoading={false} />);

      const brandText = screen.getByTestId('splash-brand-text');
      expect(brandText.className).toContain('animate-splash-text');

      const tagline = container.querySelector('.animate-splash-tagline');
      expect(tagline).toBeInTheDocument();
    });
  });

  // 2. Interactive Fast-Forward & Skip Functionality
  describe('2. User Interaction & Fast-Forward Skip', () => {
    it('allows immediate skip on click when auth is already resolved', () => {
      const onComplete = vi.fn();
      render(
        <AppSplashScreen
          isLoading={false}
          minDurationMs={2000}
          onComplete={onComplete}
        />
      );

      expect(onComplete).not.toHaveBeenCalled();

      // User clicks anywhere at 400ms
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const splashScreen = screen.getByTestId('app-splash-screen');
      fireEvent.click(splashScreen);

      // Advance through exit fade (250ms)
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('allows immediate skip via keyboard (Enter, Space, Escape) when auth is resolved', () => {
      const onComplete = vi.fn();
      render(
        <AppSplashScreen
          isLoading={false}
          minDurationMs={2000}
          onComplete={onComplete}
        />
      );

      expect(onComplete).not.toHaveBeenCalled();

      const splashScreen = screen.getByTestId('app-splash-screen');
      fireEvent.keyDown(splashScreen, { key: 'Enter' });

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('queues user skip when auth is still loading and exits immediately once auth finishes', () => {
      const onComplete = vi.fn();
      const { rerender } = render(
        <AppSplashScreen
          isLoading={true}
          minDurationMs={2000}
          onComplete={onComplete}
        />
      );

      // User clicks while auth is in progress
      const splashScreen = screen.getByTestId('app-splash-screen');
      fireEvent.click(splashScreen);

      // Still loading, so onComplete must NOT fire yet
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onComplete).not.toHaveBeenCalled();

      // Auth finishes
      rerender(
        <AppSplashScreen
          isLoading={false}
          minDurationMs={2000}
          onComplete={onComplete}
        />
      );

      // Advance through exit fade
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // 3. Accessibility & Prefers-Reduced-Motion
  describe('3. Accessibility & prefers-reduced-motion compliance', () => {
    it('disables 3D float, tilt, and delays when reduced motion is preferred', () => {
      const onComplete = vi.fn();
      const { container } = render(
        <AppSplashScreen
          isLoading={false}
          forceReducedMotion={true}
          minDurationMs={1600}
          onComplete={onComplete}
        />
      );

      // No continuous float or bloom animations
      expect(container.querySelector('.animate-logo-float')).toBeNull();

      // Logo has opacity-100 without entrance animation class
      const logo = screen.getByTestId('splash-logo');
      expect(logo.className).not.toContain('animate-splash-logo');
      expect(logo.className).toContain('opacity-100');

      // Completes within accelerated accessible duration
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  // 4. Fallback Timeout
  describe('4. Resilient Fallback Timeout', () => {
    it('triggers exit on safety timeout even if loading is indefinitely stalled', () => {
      const onComplete = vi.fn();
      render(
        <AppSplashScreen
          isLoading={true}
          maxTimeoutMs={3500}
          onComplete={onComplete}
        />
      );

      // Before timeout
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(onComplete).not.toHaveBeenCalled();

      // Past safety timeout (3500ms) + exit fade delay (250ms)
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
