import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Lead, Profile } from '@/types';

const mocks = vi.hoisted(() => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  isRealSupabaseConfigured: vi.fn(),
  isLiveApiMode: vi.fn(),
  demoMode: false,
  getLeads: vi.fn(),
  updateLead: vi.fn(),
  useAuth: vi.fn(),
  getAssigned: vi.fn(),
  updateAssigned: vi.fn(),
}));

vi.mock('@/services/supabase/client', () => ({
  supabase: mocks.supabase,
  isRealSupabaseConfigured: mocks.isRealSupabaseConfigured,
}));
vi.mock('@/services/auth/authService', () => ({
  authService: { getSessionToken: vi.fn() },
  isLiveApiMode: mocks.isLiveApiMode,
}));
vi.mock('@/lib/config', () => ({ get IS_DEMO_MODE() { return mocks.demoMode; } }));
vi.mock('@/services/supabase/db', () => ({
  db: { getLeads: mocks.getLeads, updateLead: mocks.updateLead, subscribe: vi.fn(() => () => {}) },
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/features/leads/StudentDetailModal', () => ({ StudentDetailModal: () => null }));
vi.mock('@/features/calls/CallModal', () => ({ CallModal: () => null }));
vi.mock('@/features/calls/OutcomeModal', () => ({ OutcomeModal: () => null }));

import { leadService } from '@/services/leads/leadService';
import { TelecallerLeadsPage } from '@/pages/telecaller/TelecallerLeadsPage';

const profile = {
  id: 'profile-a', user_id: 'user-a', organization_id: 'org-a', full_name: 'Caller A',
  role: 'TELECALLER', status: 'ACTIVE',
} as Profile;

const safeLead = {
  id: 'lead-a', organization_id: 'org-a', lead_code: 'EN-001', name: 'Sam S.',
  email: '***@***.***', source: 'Referral', status: 'ASSIGNED', priority: 'MEDIUM',
  assigned_to: 'profile-a', notes: 'Asked for a callback', last_contacted_at: null,
  calls_count: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
} as Lead;

function viewBuilder(rows: unknown) {
  const builder: Record<string, any> = {};
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(async () => ({ data: rows, error: null }));
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: Array.isArray(rows) ? rows[0] : rows, error: null }));
  return builder;
}

describe('secure telecaller lead client path', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.demoMode = false;
    mocks.isRealSupabaseConfigured.mockReturnValue(true);
    mocks.isLiveApiMode.mockReturnValue(false);
    mocks.supabase.from.mockImplementation(() => viewBuilder([safeLead]));
    mocks.supabase.rpc.mockResolvedValue({ data: true, error: null });
    mocks.useAuth.mockReturnValue({ profile });

    const authServiceModule = vi.mocked(await import('@/services/auth/authService'));
    vi.spyOn(authServiceModule.authService, 'getSessionToken').mockReturnValue('mock-telecaller-token');

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/leads/telecaller/update')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ lead: { ...safeLead, status: 'CONTACTED', notes: 'Follow up' } }),
        } as Response;
      }
      if (url.includes('/api/leads/telecaller')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ leads: [{ ...safeLead, phone: '+19999999999', metadata: { secret: 'hidden' } }] }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) } as Response;
    }) as any;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('loads only the sanitized view projection via server API and never returns a phone field', async () => {
    const rows = await leadService.getAssignedTelecallerLeads(profile);
    expect(global.fetch).toHaveBeenCalledWith('/api/leads/telecaller', {
      method: 'GET',
      headers: { Authorization: 'Bearer mock-telecaller-token' },
    });
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ id: safeLead.id, name: safeLead.name });
    expect(rows[0]).not.toHaveProperty('phone');
    expect(rows[0]).not.toHaveProperty('metadata');
  });

  it('updates only through the authorized server API endpoint and returns sanitized lead', async () => {
    const updated = await leadService.updateAssignedTelecallerLead('lead-a', 'CONTACTED', 'Follow up', profile);
    expect(global.fetch).toHaveBeenCalledWith('/api/leads/telecaller/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock-telecaller-token',
      },
      body: JSON.stringify({ leadId: 'lead-a', status: 'CONTACTED', notes: 'Follow up' }),
    });
    expect(mocks.supabase.rpc).not.toHaveBeenCalled();
    expect(updated.id).toBe('lead-a');
    expect(updated.status).toBe('CONTACTED');
    expect(updated).not.toHaveProperty('phone');
  });

  it('fails closed when the server API denies an unassigned or inactive caller', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'This lead could not be updated.' }),
    })) as any;

    await expect(leadService.updateAssignedTelecallerLead('lead-a', 'CONTACTED', '', profile))
      .rejects.toThrow(/could not be updated/i);
  });

  it('does not use the in-memory adapter in live mode without Supabase configuration', async () => {
    mocks.isRealSupabaseConfigured.mockReturnValue(false);
    mocks.isLiveApiMode.mockReturnValue(true);
    await expect(leadService.getAssignedTelecallerLeads(profile)).rejects.toThrow(/not configured/i);
    expect(mocks.getLeads).not.toHaveBeenCalled();
  });

  it('keeps demo reads isolated to the explicit demo adapter', async () => {
    mocks.isRealSupabaseConfigured.mockReturnValue(false);
    mocks.isLiveApiMode.mockReturnValue(false);
    mocks.demoMode = true;
    mocks.getLeads.mockReturnValue([{ ...safeLead, phone: '+10000000000' }]);
    const rows = await leadService.getAssignedTelecallerLeads(profile);
    expect(mocks.getLeads).toHaveBeenCalledWith(profile);
    expect(mocks.supabase.from).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('phone');
  });

  it('renders, saves through the service, and does not show success after a failed update', async () => {
    const service = await import('@/services/leads/leadService');
    vi.spyOn(service.leadService, 'getAssignedTelecallerLeads').mockResolvedValue([safeLead]);
    const updateSpy = vi.spyOn(service.leadService, 'updateAssignedTelecallerLead').mockRejectedValue(new Error('denied'));
    render(<TelecallerLeadsPage />);
    expect(await screen.findByText('Sam S.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit EN-001' }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CONTACTED' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Callback requested' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be updated/i);
    expect(updateSpy).toHaveBeenCalledWith('lead-a', 'CONTACTED', 'Callback requested', profile);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clears prior lead data when the session signs out', async () => {
    vi.spyOn(leadService, 'getAssignedTelecallerLeads').mockResolvedValue([safeLead]);
    const { rerender } = render(<TelecallerLeadsPage />);
    expect(await screen.findByText('Sam S.')).toBeInTheDocument();
    mocks.useAuth.mockReturnValue({ profile: null });
    rerender(<TelecallerLeadsPage />);
    await waitFor(() => expect(screen.queryByText('Sam S.')).not.toBeInTheDocument());
  });
});
