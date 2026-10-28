import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { AuthProvider } from '@/features/auth/AuthContext';
import { authService } from '@/services/auth/authService';

vi.mock('@/services/supabase/client', async () => {
  const actual = await vi.importActual<any>('@/services/supabase/client');
  return {
    ...actual,
    isRealSupabaseConfigured: () => false,
  };
});

describe('ENCRIX Phase 26: Homepage Hero Repositioning & Role-Based Login', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. HOMEPAGE HERO REDESIGN TESTS
  // =========================================================================
  describe('1. Homepage Hero Redesign', () => {
    it('renders the exact primary headline', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent(/Your Leads\. Your Business\.\s*Your Control\./i);
    });

    it('renders the exact supporting headline', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(/Protect Your Leads\. Empower Your Team\. Prevent Revenue Leakage\./i)
      ).toBeInTheDocument();
    });

    it('renders the exact hero description', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(
          /Your customer data is one of your most valuable business assets\. ENCRIX helps you control access to lead information, protect sensitive contact details, and manage your telecalling team with greater confidence\./i
        )
      ).toBeInTheDocument();
    });

    it('renders the exact supporting statement', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      expect(
        screen.getByText(
          /A lead shared without control can become a business opportunity lost\. Keep access accountable with ENCRIX\./i
        )
      ).toBeInTheDocument();
    });

    it('connects both CTA buttons to valid destinations', () => {
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      );

      const getStartedLinks = screen.getAllByRole('link', { name: /Get Started/i });
      expect(getStartedLinks.length).toBeGreaterThanOrEqual(1);
      getStartedLinks.forEach((link) => {
        expect(link).toHaveAttribute('href', '/register');
      });

      const exploreSecurityBtn = screen.getByRole('link', { name: /Explore Security/i });
      expect(exploreSecurityBtn).toHaveAttribute('href', '#security');

      // Verify the targeted #security section exists
      const securitySection = document.getElementById('security');
      expect(securitySection).not.toBeNull();
    });
  });

  // =========================================================================
  // 2. ROLE-BASED LOGIN PORTAL TESTS
  // =========================================================================
  describe('2. Role-Based Login Experience', () => {
    it('renders Option A (Admin / Owner Login) and Option B (Telecaller Login) entry points', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      // Option A: Admin / Owner
      expect(screen.getByText('Admin / Owner Login')).toBeInTheDocument();
      expect(
        screen.getByText('Manage your organization, team members, lead assignments, permissions, and reporting.')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue as Admin/i })).toBeInTheDocument();

      // Option B: Telecaller
      expect(screen.getByText('Telecaller Login')).toBeInTheDocument();
      expect(
        screen.getByText('Access assigned leads, manage follow-ups, and use authorized calling tools.')
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue as Telecaller/i })).toBeInTheDocument();
    });

    it('clicking "Continue as Admin" opens the Admin/Owner email input form', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      const continueAdminBtn = screen.getByRole('button', { name: /Continue as Admin/i });
      fireEvent.click(continueAdminBtn);

      expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send OTP/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Telecaller/i })).toBeInTheDocument();
    });

    it('clicking "Continue as Telecaller" opens the Telecaller email input form', () => {
      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      const continueTelecallerBtn = screen.getByRole('button', { name: /Continue as Telecaller/i });
      fireEvent.click(continueTelecallerBtn);

      expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send OTP/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Admin \/ Owner/i })).toBeInTheDocument();
    });

    it('pre-selects role portal when URL query param ?role=admin is provided', () => {
      render(
        <MemoryRouter initialEntries={['/login?role=admin']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      // Directly shows the input form for Admin / Owner
      expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
      expect(screen.getByText('Admin / Owner Login')).toBeInTheDocument();
    });

    it('pre-selects role portal when URL query param ?role=telecaller is provided', () => {
      render(
        <MemoryRouter initialEntries={['/login?role=telecaller']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      // Directly shows the input form for Telecaller
      expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
      expect(screen.getByText('Telecaller Login')).toBeInTheDocument();
    });

    it('allows toggling between Admin and Telecaller portals via top switcher tabs', () => {
      render(
        <MemoryRouter initialEntries={['/login?role=admin']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      expect(screen.getByText('Manage your organization, team members, lead assignments, permissions, and reporting.')).toBeInTheDocument();

      // Click Telecaller tab
      const telecallerTab = screen.getByRole('button', { name: /Telecaller/i });
      fireEvent.click(telecallerTab);

      expect(screen.getByText('Access assigned leads, manage follow-ups, and use authorized calling tools.')).toBeInTheDocument();
    });

    it('allows returning to dual entry point selection view', () => {
      render(
        <MemoryRouter initialEntries={['/login?role=admin']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      const switchRoleLink = screen.getByRole('button', { name: /Switch Role Entry Point/i });
      fireEvent.click(switchRoleLink);

      expect(screen.getByRole('button', { name: /Continue as Admin/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Continue as Telecaller/i })).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. AUTHORIZATION & ROLE INTEGRITY ENFORCEMENT
  // =========================================================================
  describe('3. Verified Server Role Routing Integrity', () => {
    it('routes strictly by verified server role (selecting Admin cannot grant telecaller admin access)', async () => {
      // Mock authService.requestOtp and verifyOtp
      vi.spyOn(authService, 'requestOtp').mockResolvedValue({
        success: true,
        maskedEmail: 't***r@encrix.com',
        verificationTicket: 'signed-ticket-123',
        cooldownSeconds: 60,
      });

      // Server returns TELECALLER profile despite user logging in under Admin portal
      vi.spyOn(authService, 'verifyOtp').mockResolvedValue({
        success: true,
        role: 'TELECALLER',
        profile: {
          id: 'tc-001',
          user_id: 'user-tc-001',
          organization_id: 'org-001',
          full_name: 'Test Telecaller',
          role: 'TELECALLER',
          status: 'ACTIVE',
        } as any,
      });

      render(
        <MemoryRouter initialEntries={['/login?role=admin']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/telecaller" element={<div data-testid="telecaller-dashboard">Telecaller Dashboard</div>} />
              <Route path="/owner" element={<div data-testid="owner-dashboard">Owner Dashboard</div>} />
              <Route path="/admin" element={<div data-testid="admin-dashboard">Admin Dashboard</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      // Send OTP
      const emailInput = screen.getByPlaceholderText('name@company.com');
      fireEvent.change(emailInput, { target: { value: 'telecaller@encrix.com' } });
      const sendOtpBtn = screen.getByRole('button', { name: /Send OTP/i });
      fireEvent.click(sendOtpBtn);

      // Wait for step 2 OTP form
      await waitFor(() => {
        expect(screen.getByText(/Verify Your Email/i)).toBeInTheDocument();
      });

      // Submit valid OTP
      const verifyBtn = screen.getByRole('button', { name: /Verify OTP/i });
      // Simulate completing OTP
      const digitInputs = screen.getAllByRole('textbox');
      digitInputs.forEach((input, index) => {
        fireEvent.change(input, { target: { value: String(index + 1) } });
      });

      fireEvent.click(verifyBtn);

      // Must be redirected to /telecaller (NOT /admin or /owner)
      await waitFor(() => {
        expect(screen.getByTestId('telecaller-dashboard')).toBeInTheDocument();
        expect(screen.queryByTestId('admin-dashboard')).not.toBeInTheDocument();
        expect(screen.queryByTestId('owner-dashboard')).not.toBeInTheDocument();
      });
    });

    it('rejects suspended accounts with clear user notification', async () => {
      vi.spyOn(authService, 'requestOtp').mockResolvedValue({
        success: true,
        maskedEmail: 's***d@encrix.com',
        verificationTicket: 'signed-ticket-suspended',
        cooldownSeconds: 60,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });

      vi.spyOn(authService, 'verifyOtp').mockResolvedValue({
        success: true,
        role: 'TELECALLER',
        profile: {
          id: 'tc-suspended',
          user_id: 'user-tc-suspended',
          organization_id: 'org-001',
          full_name: 'Suspended User',
          role: 'TELECALLER',
          status: 'SUSPENDED',
        } as any,
      });

      render(
        <MemoryRouter initialEntries={['/login?role=telecaller']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText('name@company.com');
      fireEvent.change(emailInput, { target: { value: 'suspended@encrix.com' } });
      fireEvent.click(screen.getByRole('button', { name: /Send OTP/i }));

      await waitFor(() => {
        expect(screen.getByText(/Verify Your Email/i)).toBeInTheDocument();
      });

      const digitInputs = screen.getAllByRole('textbox');
      digitInputs.forEach((input) => {
        fireEvent.change(input, { target: { value: '1' } });
      });

      const verifyOtpButton = screen.queryByRole('button', { name: /Verify OTP/i });
      if (verifyOtpButton) {
        fireEvent.click(verifyOtpButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/Your account has been suspended\. Please contact your organization owner\./i)).toBeInTheDocument();
      });
    });
  });
});
