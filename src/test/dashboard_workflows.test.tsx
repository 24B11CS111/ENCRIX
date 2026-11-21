import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getDashboardMetrics: vi.fn(),
  getOwnerLeads: vi.fn(),
  getAssignedTelecallerLeads: vi.fn(),
  db: {
    getCalls: vi.fn(),
    getFollowUps: vi.fn(),
    getTelecallers: vi.fn(),
    getSecurityEvents: vi.fn(),
    getOrganizations: vi.fn(),
    getProfiles: vi.fn(),
    getLeads: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/services/metrics/metricsService', () => ({
  metricsService: { getDashboardMetrics: mocks.getDashboardMetrics },
}));
vi.mock('@/services/leads/leadService', () => ({
  leadService: {
    getOwnerLeads: mocks.getOwnerLeads,
    getAssignedTelecallerLeads: mocks.getAssignedTelecallerLeads,
  },
}));
vi.mock('@/services/supabase/db', () => ({ db: mocks.db }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => children,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
  BarChart: () => null,
  Bar: () => null,
}));

import { RoleGate } from '@/features/auth/RoleGate';
import { OwnerDashboard } from '@/pages/owner/OwnerDashboard';
import { TelecallerDashboard } from '@/pages/telecaller/TelecallerDashboard';
import { AdminDashboard } from '@/pages/admin/AdminDashboard';

const ownerProfile = {
  id: 'owner-profile',
  user_id: 'owner-user',
  organization_id: 'org-a',
  full_name: 'Asha Owner',
  role: 'OWNER',
  status: 'ACTIVE',
};

const ownerMetrics = {
  totalLeads: 27,
  assignedLeads: 19,
  unassignedLeads: 8,
  conversions: 5,
  leadsByStatus: { INTERESTED: 4, CONVERTED: 1 },
  totalCallsCount: 34,
  totalCallSeconds: 4920,
  answeredCallsCount: 28,
  connectRate: 82,
  callsToday: 9,
  activeFollowUps: 6,
  followUpsDueToday: 3,
  followUpsOverdue: 1,
  securityCount: 2,
  telecallerPerformance: [],
};

const telecallerMetrics = {
  totalAssigned: 13,
  positiveLeads: 4,
  totalCalls: 21,
  callsToday: 7,
  myFollowUps: 6,
  followUpsDueToday: 2,
  followUpsOverdue: 1,
};

function activeProfile(role: 'OWNER' | 'TELECALLER' | 'ADMIN') {
  return {
    ...ownerProfile,
    id: `${role.toLowerCase()}-profile`,
    role,
    organization_id: role === 'ADMIN' ? '' : 'org-a',
  };
}

describe('role-specific dashboard workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.getCalls.mockReturnValue([]);
    mocks.db.getFollowUps.mockReturnValue([]);
    mocks.db.getTelecallers.mockReturnValue([]);
    mocks.db.getSecurityEvents.mockReturnValue([]);
    mocks.db.getOrganizations.mockReturnValue([]);
    mocks.db.getProfiles.mockReturnValue([]);
    mocks.db.getLeads.mockReturnValue([]);
    mocks.db.subscribe.mockReturnValue(() => {});
    mocks.getOwnerLeads.mockResolvedValue([]);
    mocks.getAssignedTelecallerLeads.mockResolvedValue([]);
    mocks.getDashboardMetrics.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders authoritative owner metrics from the metrics API', async () => {
    mocks.useAuth.mockReturnValue({ profile: activeProfile('OWNER') });
    mocks.getDashboardMetrics.mockResolvedValue(ownerMetrics);

    render(<MemoryRouter><OwnerDashboard /></MemoryRouter>);

    expect(await screen.findByText('27')).toBeTruthy();
    expect(screen.getByText('19 assigned')).toBeTruthy();
    expect(screen.getByText('8 unassigned')).toBeTruthy();
    expect(screen.getByText('82%')).toBeTruthy();
    expect(screen.getByText('34')).toBeTruthy();
    expect(mocks.getDashboardMetrics).toHaveBeenCalledWith(activeProfile('OWNER'));
  });

  it('renders telecaller-scoped metrics from the metrics API', async () => {
    mocks.useAuth.mockReturnValue({ profile: activeProfile('TELECALLER') });
    mocks.getDashboardMetrics.mockResolvedValue(telecallerMetrics);

    render(<MemoryRouter><TelecallerDashboard /></MemoryRouter>);

    expect(await screen.findByText('Assigned Leads')).toBeTruthy();
    expect(screen.getByText('13')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(mocks.getDashboardMetrics).toHaveBeenCalledWith(activeProfile('TELECALLER'));
  });

  it.each(['OWNER', 'TELECALLER'] as const)('denies %s access to the global admin dashboard', (role) => {
    mocks.useAuth.mockReturnValue({
      profile: activeProfile(role),
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <RoleGate allowedRoles={['ADMIN']}><AdminDashboard /></RoleGate>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Access Restricted' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Platform Administration' })).toBeNull();
    expect(mocks.db.getOrganizations).not.toHaveBeenCalled();
  });

  it('allows an active admin to view the global admin dashboard', () => {
    mocks.useAuth.mockReturnValue({
      profile: activeProfile('ADMIN'),
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    });

    render(
      <MemoryRouter>
        <RoleGate allowedRoles={['ADMIN']}><AdminDashboard /></RoleGate>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Platform Administration' })).toBeTruthy();
    expect(mocks.db.getOrganizations).toHaveBeenCalledWith(activeProfile('ADMIN'));
  });
});
