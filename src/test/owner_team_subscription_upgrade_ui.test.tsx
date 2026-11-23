import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OwnerTeamPage } from '../pages/owner/OwnerTeamPage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockInviteTelecaller = vi.fn();
const mockProfile = {
  id: 'owner-prof-id',
  user_id: 'owner-user-id',
  organization_id: 'org-test-id',
  role: 'OWNER',
  status: 'ACTIVE',
  full_name: 'Owner Name',
  email: 'owner@test.com',
};

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({
    profile: mockProfile,
    inviteTelecaller: mockInviteTelecaller,
  }),
}));

vi.mock('@/services/supabase/db', () => ({
  db: {
    getProfiles: () => [],
    getCalls: () => [],
    subscribe: () => () => {},
  },
}));

vi.mock('@/services/leads/leadService', () => ({
  leadService: {
    getOwnerLeads: async () => [],
  },
}));

vi.mock('@/services/auth/authService', () => ({
  authService: {
    getInvitations: async () => ({ success: true, invitations: [] }),
    getOrganizationTelecallers: async () => ({ success: true, telecallers: [] }),
    updateTelecallerStatus: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}));

describe('OwnerTeamPage Subscription Upgrade UI & Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays an actionable Business Plan upgrade card when ACTIVE_SUBSCRIPTION_REQUIRED is returned', async () => {
    mockInviteTelecaller.mockResolvedValueOnce({
      success: false,
      error: 'ACTIVE_SUBSCRIPTION_REQUIRED',
    });

    render(
      <MemoryRouter>
        <OwnerTeamPage />
      </MemoryRouter>
    );

    // Click "Invite Telecaller" to open modal
    const inviteButtons = screen.getAllByRole('button', { name: /invite telecaller/i });
    fireEvent.click(inviteButtons[0]);

    // Fill in form
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Ramesh Chandra/i), {
      target: { value: 'New Telecaller' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ramesh@vertex\.com/i), {
      target: { value: 'tc@vertex.com' },
    });

    // Submit invitation
    const submitBtn = screen.getByRole('button', { name: /send invitation/i });
    fireEvent.click(submitBtn);

    // Wait for the upgrade card to appear
    await waitFor(() => {
      expect(screen.getByText('Business Plan Required')).toBeDefined();
    });

    expect(screen.getByText(/requires an active Business Plan/i)).toBeDefined();

    // Verify upgrade CTA button
    const upgradeBtn = screen.getByRole('button', { name: /view business plan · ₹9,999\/yr/i });
    expect(upgradeBtn).toBeDefined();

    // Click upgrade button and verify navigation
    fireEvent.click(upgradeBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/owner/pricing');
  });

  it('displays a friendly retry message when PAID_ENTITLEMENT_UNAVAILABLE is returned', async () => {
    mockInviteTelecaller.mockResolvedValueOnce({
      success: false,
      error: 'PAID_ENTITLEMENT_UNAVAILABLE',
    });

    render(
      <MemoryRouter>
        <OwnerTeamPage />
      </MemoryRouter>
    );

    const inviteButtons = screen.getAllByRole('button', { name: /invite telecaller/i });
    fireEvent.click(inviteButtons[0]);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Ramesh Chandra/i), {
      target: { value: 'Another Telecaller' },
    });
    fireEvent.change(screen.getByPlaceholderText(/ramesh@vertex\.com/i), {
      target: { value: 'another@vertex.com' },
    });

    const submitBtn = screen.getByRole('button', { name: /send invitation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/subscription verification is temporarily unavailable/i)).toBeDefined();
    });
  });
});
