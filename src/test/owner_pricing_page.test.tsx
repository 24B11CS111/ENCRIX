import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn() }));

vi.mock('@/features/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: mocks.useAuth,
}));

vi.mock('@/components/layout/AppLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { AppLayout: () => <Outlet /> };
});

import { App } from '@/App';
import { Sidebar } from '@/components/layout/Sidebar';

const ownerContext = {
  profile: {
    id: 'profile-owner',
    user_id: 'user-owner',
    organization_id: 'org-owner',
    full_name: 'Owner Example',
    role: 'OWNER',
    status: 'ACTIVE',
  },
  organization: { id: 'org-owner', name: 'Example Organization', industry: 'Education' },
  isAuthenticated: true,
  isLoading: false,
  logout: vi.fn(),
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockDraftBillingApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/billing/plans')) {
      return jsonResponse({
        plans: [{
          code: 'business',
          displayName: 'Business',
          billingInterval: 'yearly',
          billingIntervalCount: 1,
          currency: 'INR',
          priceInr: 9999,
          checkoutAvailable: false,
        }],
      });
    }
    return jsonResponse({ subscription: null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Owner pricing and billing page', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.setItem('encrix_splash_completed', 'true');
    localStorage.setItem('leadvault_session_token', 'test-session-token');
    mocks.useAuth.mockReturnValue(ownerContext);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('opens directly at /owner/pricing, displays the target price, and never implies paid activation', async () => {
    const fetchMock = mockDraftBillingApi();
    window.history.replaceState({}, '', '/owner/pricing');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Pricing & Billing' }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText('₹9,999')).toBeTruthy();
    expect(screen.getByText(/business annual plan/i)).toBeTruthy();
    expect(screen.getByText(/annual recurring subscription/i)).toBeTruthy();
    expect(await screen.findByText(/₹9,999 INR/i, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test checkout unavailable' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/test checkout requires valid razorpay test mode credentials/i)).toBeTruthy();
    expect(screen.getByText('No active subscription')).toBeTruthy();
    expect(screen.queryByText(/premium active|payment successful|business activated/i)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/billing/subscription', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-session-token' }),
      cache: 'no-store',
    }));
  });

  it('shows a loading state while subscription details are pending', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    window.history.replaceState({}, '', '/owner/pricing');

    render(<App />);

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('Loading subscription status…')).toBeTruthy();
  });

  it('explains when the billing database is unavailable and keeps checkout disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/billing/plans')) {
        return jsonResponse({ plans: [{ code: 'business', displayName: 'Business', billingInterval: 'yearly', billingIntervalCount: 1, currency: 'INR', priceInr: 9999, checkoutAvailable: false }] });
      }
      return jsonResponse({ error: 'BILLING_DATABASE_CONFIGURATION_MISSING' }, 503);
    }));
    window.history.replaceState({}, '', '/owner/pricing');

    render(<App />);

    expect(await screen.findByText(/billing database setup must be completed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test checkout unavailable' })).toHaveProperty('disabled', true);
  });

  it('offers the server-configured Test Mode checkout without claiming payment activation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/billing/plans')) {
        return jsonResponse({ plans: [{ code: 'business', displayName: 'Business', billingInterval: 'yearly', billingIntervalCount: 1, currency: 'INR', priceInr: 9999, checkoutAvailable: true }] });
      }
      return jsonResponse({ subscription: null, subscriptions: [], payments: [] });
    }));
    window.history.replaceState({}, '', '/owner/pricing');
    render(<App />);

    expect(await screen.findByRole('link', { name: /continue to test checkout · ₹9,999\/year/i })).toHaveAttribute('href', '/owner/pricing/checkout');
    expect(screen.getByText(/test mode only/i)).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('shows Pricing & Billing only in the owner management navigation', () => {
    const { rerender } = render(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Pricing & Billing' }).getAttribute('href')).toBe('/owner/pricing');

    mocks.useAuth.mockReturnValue({ ...ownerContext, profile: { ...ownerContext.profile, role: 'TELECALLER' } });
    rerender(<MemoryRouter><Sidebar /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Pricing & Billing' })).toBeNull();
  });

  it('keeps direct pricing-route access behind the existing owner role gate', async () => {
    mocks.useAuth.mockReturnValue({
      ...ownerContext,
      profile: { ...ownerContext.profile, role: 'TELECALLER' },
    });
    window.history.replaceState({}, '', '/owner/pricing');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Access Restricted' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pricing & Billing' })).toBeNull();
  });
});
