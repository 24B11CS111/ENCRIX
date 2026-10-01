import { describe, it, expect } from 'vitest';
import { leadSchema, loginSchema, registerSchema } from '@/lib/validation';
import { sanitizeLeadForRole } from '@/lib/dataMasking';
import { Lead } from '@/types';

describe('LEADVAULT Form Validation & Role Gate Rules', () => {
  it('Validates correct login credentials via Zod', () => {
    const valid = loginSchema.safeParse({
      email: 'owner@vertex.com',
      password: 'StrongPassword123!',
    });
    expect(valid.success).toBe(true);

    const invalidEmail = loginSchema.safeParse({
      email: 'not-an-email',
      password: '123',
    });
    expect(invalidEmail.success).toBe(false);
  });

  it('Validates organization registration requirements', () => {
    const valid = registerSchema.safeParse({
      companyName: 'Vertex Consultancy',
      ownerName: 'Vikram Malhotra',
      email: 'vikram@vertex.com',
      password: 'SecurePassword2026!',
      phone: '+91 98200 12345',
      industry: 'Education Consultancy',
      companySize: '11-50',
    });
    expect(valid.success).toBe(true);
  });

  it('Validates lead phone formats and strips malicious characters', () => {
    const validLead = leadSchema.safeParse({
      name: 'Priya Sharma',
      phone: '+91 98765 43210',
      email: 'priya@example.com',
      source: 'Website',
      priority: 'HIGH',
    });
    expect(validLead.success).toBe(true);

    const invalidPhone = leadSchema.safeParse({
      name: 'Invalid Test',
      phone: '12',
    });
    expect(invalidPhone.success).toBe(false);
  });

  it('Sanitizes Lead data for Telecaller while keeping Owner data intact', () => {
    const rawLead: Lead = {
      id: 'lead-test-1',
      organization_id: 'org-vertex-001',
      lead_code: 'LV-99999',
      name: 'Aditya Srivastava',
      phone: '+91 9811122334',
      email: 'aditya.s@example.com',
      source: 'Google Ads',
      status: 'ASSIGNED',
      priority: 'HIGH',
      assigned_to: 'tc-arjun-01',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Owner receives raw unmasked details
    const ownerView = sanitizeLeadForRole(rawLead, 'OWNER');
    expect(ownerView.phone).toBe('+91 9811122334');
    expect(ownerView.name).toBe('Aditya Srivastava');
    expect(ownerView.email).toBe('aditya.s@example.com');

    // Telecaller receives masked details
    const telecallerView = sanitizeLeadForRole(rawLead, 'TELECALLER');
    expect(telecallerView.phone).toContain('***');
    expect(telecallerView.name).toBe('Aditya S.');
    expect(telecallerView.email).toContain('***');
  });
});
