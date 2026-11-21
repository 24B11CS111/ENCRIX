import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ requestOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ requestOtp: mocks.requestOtp, verifyOtp: mocks.verifyOtp }),
}));

import { RegisterPage } from '@/pages/auth/RegisterPage';
import { PricingPage } from '@/pages/PricingPage';

describe('shared owner onboarding and plan entry', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('collects all required owner and business registration details', () => {
    render(<MemoryRouter initialEntries={['/register']}><RegisterPage /></MemoryRouter>);
    expect(screen.getByLabelText('Full name')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number')).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Business / organization name')).toBeTruthy();
    expect(screen.getByLabelText('Business category')).toBeTruthy();
    expect(screen.getByLabelText('Business phone')).toBeTruthy();
    expect(screen.getByLabelText('Business email')).toBeTruthy();
    expect(screen.getByLabelText('Business location')).toBeTruthy();
    expect(screen.getByLabelText(/Website/)).toBeTruthy();
    expect(screen.queryByLabelText(/Password/)).toBeNull();
  });

  it('validates required business details before requesting the existing OTP flow', async () => {
    render(<MemoryRouter initialEntries={['/register']}><RegisterPage /></MemoryRouter>);
    const submit = screen.getByRole('button', { name: /continue to email verification/i });
    fireEvent.click(submit);
    expect(mocks.requestOtp).not.toHaveBeenCalled();
  });

  it('sends validated owner and organization data through the existing OTP service', async () => {
    mocks.requestOtp.mockResolvedValue({ success: true, maskedEmail: 'ow***@example.com' });
    render(<MemoryRouter initialEntries={['/register']}><RegisterPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Owner Example' } });
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '+91 98765 43210' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Business / organization name'), { target: { value: 'Example Org' } });
    fireEvent.change(screen.getByLabelText('Business phone'), { target: { value: '+91 98765 43211' } });
    fireEvent.change(screen.getByLabelText('Business email'), { target: { value: 'billing@example.com' } });
    fireEvent.change(screen.getByLabelText('Business location'), { target: { value: 'Mumbai, India' } });
    fireEvent.click(screen.getByRole('button', { name: /continue to email verification/i }));
    expect(await screen.findByText(/enter the 6-digit code sent to/i)).toBeTruthy();
    expect(mocks.requestOtp).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'REGISTER',
      email: 'owner@example.com',
      phone: '+919876543210',
      companyName: 'Example Org',
      businessEmail: 'billing@example.com',
      businessPhone: '+919876543211',
      businessLocation: 'Mumbai, India',
    }));
  });

  it('keeps telecaller registration invitation-only', () => {
    render(<MemoryRouter initialEntries={['/register']}><RegisterPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Telecaller' }));
    expect(screen.getByText(/telecaller accounts are invitation-only/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /i have an invitation/i }).getAttribute('href')).toBe('/accept-invitation');
  });

  it('routes unauthenticated pricing selection through registration and the shared checkout destination', () => {
    const { container } = render(<MemoryRouter initialEntries={['/pricing']}><PricingPage /></MemoryRouter>);
    const start = screen.getByRole('link', { name: /get started/i });
    expect(start.getAttribute('href')).toBe('/register?next=%2Fowner%2Fpricing%2Fcheckout');
    expect(container.textContent).toContain('₹9,999');
    expect(container.textContent).toContain('Annual billing');
  });
});
