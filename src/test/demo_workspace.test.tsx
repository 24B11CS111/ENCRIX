import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DemoWorkspace } from '@/pages/DemoWorkspace';

const authProviderMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => { authProviderMock(); return children; },
  useAuth: vi.fn(),
}));
import { App } from '@/App';

describe('isolated client demo workspace', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('supports a sample lead workflow without calling a backend', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><DemoWorkspace /></MemoryRouter>);

    expect(screen.getByText(/DEMO MODE/)).toBeTruthy();
    expect(screen.getByText(/Synthetic sample workspace/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add sample lead/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sample Prospect' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'prospect@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const row = screen.getByText('Sample Prospect').closest('tr');
    expect(row).toBeTruthy();
    fireEvent.change(within(row as HTMLElement).getByLabelText('Assign Sample Prospect'), { target: { value: 'tc-2' } });
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Record sample interaction/ }));
    expect(within(row as HTMLElement).getByText('Kabir Shah')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('no call was placed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('schedules and completes a synthetic follow-up in the session', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><DemoWorkspace /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Follow-ups' }));
    fireEvent.change(screen.getByLabelText('Lead'), { target: { value: 'EN-2048' } });
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2026-11-10T11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule follow-up' }));
    expect(screen.getByRole('status').textContent).toContain('Sample follow-up scheduled');
    fireEvent.click(screen.getAllByRole('button', { name: /Mark complete/ })[0]);
    expect(screen.getByRole('status').textContent).toContain('Follow-up marked complete');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps /demo outside live authentication and session restoration', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('leadvault_session_token', 'must-not-be-restored-in-demo');
    window.history.replaceState({}, '', '/demo');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Good morning, Vikram' })).toBeTruthy();
    expect(authProviderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('edits and confirms deletion of synthetic leads only', () => {
    render(<MemoryRouter><DemoWorkspace /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Leads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Anika Sharma' }));
    fireEvent.change(screen.getByLabelText('Lead name'), { target: { value: 'Anika Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Anika Updated')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Anika Updated' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample lead' }));
    expect(screen.queryByText('Anika Updated')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('removed from this demo session');
  });
});

