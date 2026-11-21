import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/services/supabase/client', () => ({ supabase: { auth } }));

import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';

function renderRoutes(path: string) {
  return render(<MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/login" element={<div>Login destination</div>} />
    </Routes>
  </MemoryRouter>);
}

describe('Supabase Auth password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    auth.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('requests a time-limited Supabase recovery link and returns a non-enumerating response', async () => {
    renderRoutes('/forgot-password');
    fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
      redirectTo: `${window.location.origin}/reset-password`,
    }));
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByText(/does not reveal whether the address has an account/i)).toBeInTheDocument();
    expect(screen.queryByText(/owner@example.com/)).not.toBeInTheDocument();
  });

  it('does not reveal account existence when the recovery provider returns an error', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: new Error('provider unavailable') });
    renderRoutes('/forgot-password');
    fireEvent.change(screen.getByLabelText('Work Email'), { target: { value: 'unknown@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('could not be completed');
    expect(screen.queryByText(/unknown@example.com/)).not.toBeInTheDocument();
  });

  it('updates the password only through a valid Supabase recovery session and globally signs out sessions', async () => {
    renderRoutes('/reset-password');
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'long-enough-password' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'long-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-password' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ scope: 'global' }));
    expect(await screen.findByText('Password updated!')).toBeInTheDocument();
  });

  it('rejects an invalid or expired recovery session without changing a password', async () => {
    auth.updateUser.mockResolvedValue({ data: null, error: new Error('invalid recovery token') });
    renderRoutes('/reset-password');
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'long-enough-password' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'long-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText(/invalid or expired/i)).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
