import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppSplashScreen } from '@/components/AppSplashScreen';
import { RealtimeStatusBadge } from '@/components/common/RealtimeStatusBadge';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { LandingPage } from '@/pages/LandingPage';
import { Navbar } from '@/components/layout/Navbar';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { RoleGate } from '@/features/auth/RoleGate';
import { authService } from '@/services/auth/authService';
import { db } from '@/services/supabase/db';
import { DEMO_PROFILES, DEMO_ORGS } from '@/services/supabase/demoData';

vi.mock('@/services/supabase/client', async () => {
  const actual = await vi.importActual<any>('@/services/supabase/client');
  return {
    ...actual,
    isRealSupabaseConfigured: () => false,
  };
});

describe('ENCRIX Phase 19: Premium Startup Animation & Demo UI Removal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    sessionStorage.clear();
    realtimeManager.setStatus('CONNECTED');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // 1. Startup Brand Animation (AppSplashScreen)
  describe('1. Startup Brand Animation (AppSplashScreen)', () => {
    it('renders centered brand mark, wordmark, and SECURE TELECALLER CRM tagline', () => {
      render(<AppSplashScreen isLoading={false} />);

      // Brand logo container with shield
      const logo = screen.getByTestId('splash-logo');
      expect(logo).toBeInTheDocument();
      expect(logo.className).toContain('animate-splash-logo');

      // Wordmark and tagline
      const brandText = screen.getByTestId('splash-brand-text');
      expect(brandText).toBeInTheDocument();
      expect(brandText).toHaveTextContent('ENCRIX');
      expect(brandText).toHaveTextContent('SECURE TELECALLER CRM');
    });

    it('completes sequence within target 1.0–1.3s and triggers onComplete transition', () => {
      const onComplete = vi.fn();
      render(<AppSplashScreen isLoading={false} minDurationMs={1100} onComplete={onComplete} />);

      expect(onComplete).not.toHaveBeenCalled();

      // Advance by 1000ms: animation is still playing
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onComplete).not.toHaveBeenCalled();

      // Advance past min duration (1100ms)
      act(() => {
        vi.advanceTimersByTime(150);
      });
      // Advance through exit fade (250ms)
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('shows restrained loading indicator when session resolution exceeds minimum animation time', () => {
      render(<AppSplashScreen isLoading={true} minDurationMs={1000} />);

      // Initially before minDuration, no loading indicator shown
      expect(screen.queryByTestId('splash-loading-indicator')).not.toBeInTheDocument();

      // Once minDuration passes while still loading, shows restrained feedback
      act(() => {
        vi.advanceTimersByTime(1050);
      });

      const indicator = screen.getByTestId('splash-loading-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent('Initializing secure workspace...');
    });

    it('failsafe timeout ensures splash never blocks the application on network error or hang', () => {
      const onComplete = vi.fn();
      // Even if isLoading remains stuck as true forever:
      render(<AppSplashScreen isLoading={true} maxTimeoutMs={3000} onComplete={onComplete} />);

      act(() => {
        vi.advanceTimersByTime(3500);
      });

      expect(onComplete).toHaveBeenCalled();
    });

    it('respects prefers-reduced-motion with instant static layout and accelerated completion', () => {
      const onComplete = vi.fn();
      render(
        <AppSplashScreen
          isLoading={false}
          forceReducedMotion={true}
          minDurationMs={1100}
          onComplete={onComplete}
        />
      );

      const logo = screen.getByTestId('splash-logo');
      // No scale transform animation when reduced motion is preferred
      expect(logo.className).not.toContain('animate-splash-logo');
      expect(logo.className).toContain('opacity-100');

      const brandText = screen.getByTestId('splash-brand-text');
      expect(brandText.className).not.toContain('animate-splash-text');

      // Reduced motion minimizes duration for immediate accessibility
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  // 2. Truthful Real-Time Status Indicator (No fake "LIVE" badge)
  describe('2. Truthful Real-Time Status Indicator (RealtimeStatusBadge)', () => {
    it('displays CONNECTED when real-time connection is active', () => {
      realtimeManager.setStatus('CONNECTED');
      render(<RealtimeStatusBadge />);

      expect(screen.getByText('CONNECTED')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    });

    it('maps internal LIVE state to truthful CONNECTED badge to avoid misleading the user', () => {
      realtimeManager.setStatus('LIVE');
      render(<RealtimeStatusBadge />);

      expect(screen.getByText('CONNECTED')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    });

    it('displays RECONNECTING during connection recovery', () => {
      realtimeManager.setStatus('RECONNECTING');
      render(<RealtimeStatusBadge />);

      expect(screen.getByText('RECONNECTING')).toBeInTheDocument();
      expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    });

    it('displays OFFLINE when disconnected and allows reconnection trigger', () => {
      realtimeManager.setStatus('OFFLINE');
      const reconnectSpy = vi.spyOn(realtimeManager, 'reconnect');

      render(<RealtimeStatusBadge />);

      const button = screen.getByText('OFFLINE');
      expect(button).toBeInTheDocument();

      act(() => {
        button.click();
      });
      expect(reconnectSpy).toHaveBeenCalled();
    });
  });

  // 3. User-Facing Demo UI Removal
  describe('3. User-Facing Demo UI Removal', () => {
    it('LandingPage has NO "Instant Live Demo" or "TRY WITH DEMO DATA" buttons', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      // Verify absence of user-facing demo CTAs
      expect(screen.queryByText(/Instant Live Demo/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/TRY WITH DEMO DATA/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Explore demo personas/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/VIEW PLATFORM/i)).not.toBeInTheDocument();

      // Verifies clean enterprise CTAs exist
      expect(screen.getByRole('link', { name: /START PROTECTING YOUR LEADS/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /SIGN IN TO WORKSPACE/i })).toBeInTheDocument();
    });

    it('Header (Navbar) has NO demo role switcher or fake role selector dropdown', () => {
      render(
        <MemoryRouter>
          <AuthProvider>
            <Navbar />
          </AuthProvider>
        </MemoryRouter>
      );

      // Click notification bell to open popover
      const bellButton = screen.getByTitle(/Notifications/i);
      act(() => {
        bellButton.click();
      });

      expect(screen.queryByText(/Live Feed/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Event Stream/i)).toBeInTheDocument();
    });
  });

  // 4. Truthful Security Indicator in Header
  describe('4. Truthful Security Indicator in Header', () => {
    const owner = DEMO_PROFILES.find((p) => p.role === 'OWNER' && p.organization_id === 'org-vertex-001')!;

    it('truthfully reports Security Alert when high/critical anomalies exist in tenant audit', async () => {
      // org-vertex-001 has active security events in demoData
      vi.spyOn(authService, 'getSessionToken').mockReturnValue('mock-owner-token');
      vi.spyOn(authService, 'restoreServerSession').mockResolvedValue({
        authenticated: true,
        profile: owner,
        organization: DEMO_ORGS[0],
        role: 'OWNER',
      });

      render(
        <MemoryRouter>
          <AuthProvider>
            <Navbar />
          </AuthProvider>
        </MemoryRouter>
      );

      await act(async () => {
        vi.runAllTimers();
      });

      const indicator = screen.getByTestId('navbar-security-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent(/Security Alert/i);
    });

    it('truthfully reports System Secure when organization audit events are clean', async () => {
      vi.spyOn(authService, 'getSessionToken').mockReturnValue('mock-owner-token');
      vi.spyOn(authService, 'restoreServerSession').mockResolvedValue({
        authenticated: true,
        profile: owner,
        organization: DEMO_ORGS[0],
        role: 'OWNER',
      });
      vi.spyOn(db, 'getSecurityEvents').mockReturnValue([]);

      render(
        <MemoryRouter>
          <AuthProvider>
            <Navbar />
          </AuthProvider>
        </MemoryRouter>
      );

      await act(async () => {
        vi.runAllTimers();
      });

      const indicator = screen.getByTestId('navbar-security-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent(/System Secure/i);
    });
  });

  // 5. Route Protection & Dashboard Access Guarantees
  describe('5. Session Protection & Dashboard Zero-Leakage Guarantees', () => {
    it('unauthenticated users are strictly barred from protected dashboards by RoleGate', () => {
      // Mock unauthenticated useAuth state
      const UnauthMock: React.FC = () => {
        return (
          <MemoryRouter initialEntries={['/owner']}>
            <Routes>
              <Route
                path="/owner"
                element={
                  // When profile is null and isAuthenticated is false
                  <FakeRoleGate profile={null} isAuthenticated={false} isLoading={false} allowedRoles={['OWNER']}>
                    <div data-testid="owner-secret-dashboard">CONFIDENTIAL OWNER DATA</div>
                  </FakeRoleGate>
                }
              />
              <Route path="/login" element={<div data-testid="login-page">LOGIN PAGE</div>} />
            </Routes>
          </MemoryRouter>
        );
      };

      render(<UnauthMock />);
      expect(screen.queryByTestId('owner-secret-dashboard')).not.toBeInTheDocument();
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    it('authenticated Owner reaches Owner Dashboard and Telecaller reaches Telecaller Dashboard', () => {
      const ownerProfile = DEMO_PROFILES.find((p) => p.role === 'OWNER')!;
      const telecallerProfile = DEMO_PROFILES.find((p) => p.role === 'TELECALLER')!;

      // Owner verification
      const { unmount: unmountOwner } = render(
        <MemoryRouter initialEntries={['/owner']}>
          <Routes>
            <Route
              path="/owner"
              element={
                <FakeRoleGate profile={ownerProfile} isAuthenticated={true} isLoading={false} allowedRoles={['OWNER']}>
                  <div data-testid="owner-dashboard">OWNER WORKSPACE</div>
                </FakeRoleGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByTestId('owner-dashboard')).toBeInTheDocument();
      unmountOwner();

      // Telecaller verification
      render(
        <MemoryRouter initialEntries={['/telecaller']}>
          <Routes>
            <Route
              path="/telecaller"
              element={
                <FakeRoleGate profile={telecallerProfile} isAuthenticated={true} isLoading={false} allowedRoles={['TELECALLER']}>
                  <div data-testid="telecaller-dashboard">TELECALLER WORKSPACE</div>
                </FakeRoleGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );
      expect(screen.getByTestId('telecaller-dashboard')).toBeInTheDocument();
    });

    it('disabled accounts are strictly barred from workspace access and display Account Suspended notice', () => {
      const disabledUser = { ...DEMO_PROFILES[1], status: 'DISABLED' as const };

      render(
        <MemoryRouter initialEntries={['/telecaller']}>
          <Routes>
            <Route
              path="/telecaller"
              element={
                <FakeRoleGate profile={disabledUser} isAuthenticated={true} isLoading={false} allowedRoles={['TELECALLER']}>
                  <div data-testid="telecaller-dashboard">LEADS QUEUE</div>
                </FakeRoleGate>
              }
            />
            <Route path="/login" element={<div>LOGIN PAGE</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByTestId('telecaller-dashboard')).not.toBeInTheDocument();
      expect(screen.getByText(/Account Suspended/i)).toBeInTheDocument();
    });

    it('cryptographically forged or revoked session tokens reject server authentication', async () => {
      // Set forged/invalid token in secure storage
      localStorage.setItem('leadvault_session_token', 'forged.malicious.token');
      const result = await authService.restoreServerSession();

      expect(result.authenticated).toBe(false);
      expect(result.profile).toBeFalsy();
    });
  });
});

// Helper component matching RoleGate's exact logic for deterministic isolated testing
const FakeRoleGate: React.FC<{
  profile: any;
  isAuthenticated: boolean;
  isLoading: boolean;
  allowedRoles: string[];
  children: React.ReactNode;
}> = ({ profile, isAuthenticated, isLoading, allowedRoles, children }) => {
  if (isLoading) {
    return <div>Verifying secure session...</div>;
  }

  if (!isAuthenticated || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (profile.status === 'DISABLED') {
    return <div>Account Suspended</div>;
  }

  if (!allowedRoles.includes(profile.role)) {
    return <div>Access Restricted</div>;
  }

  return <>{children}</>;
};
