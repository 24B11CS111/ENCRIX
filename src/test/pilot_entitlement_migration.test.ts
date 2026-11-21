import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261104120000_founding_pilot_entitlements.sql'), 'utf8');

describe('founding pilot entitlement migration contract', () => {
  it('scopes grants to one organization with explicit expiry and bounded annual validity', () => {
    expect(migration).toMatch(/organization_pilot_entitlements[\s\S]*?organization_id UUID NOT NULL REFERENCES public\.organizations\(id\)/i);
    expect(migration).toMatch(/expires_at > granted_at AND expires_at <= granted_at \+ INTERVAL '365 days'/i);
    expect(migration).toMatch(/e\.organization_id = p_organization_id[\s\S]*?e\.expires_at > pg_catalog\.statement_timestamp\(\)/i);
  });

  it('requires an active platform ADMIN in the grant and revoke RPCs and writes audit events', () => {
    expect(migration).toMatch(/p\.id = p_granted_by AND p\.role = 'ADMIN' AND p\.status = 'ACTIVE'/i);
    expect(migration).toMatch(/p\.id = p_revoked_by AND p\.role = 'ADMIN' AND p\.status = 'ACTIVE'/i);
    expect(migration).toMatch(/'GRANTED'/i);
    expect(migration).toMatch(/'REVOKED'/i);
    expect(migration).toMatch(/pg_advisory_xact_lock/i);
    expect(migration).toMatch(/founding_pilot_capacity_reached/i);
  });

  it('keeps the original Razorpay verification and joins it as a separate valid gate branch', () => {
    expect(migration).toMatch(/p\.signature_verified_at IS NOT NULL/);
    expect(migration).toMatch(/p\.amount_refunded_paise < p\.amount_paise/);
    expect(migration).toMatch(/\) OR EXISTS \([\s\S]*organization_pilot_entitlements/i);
  });

  it('denies browser/service-role table access and restricts mutation RPCs to service_role', () => {
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.organization_pilot_entitlements FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.organization_pilot_entitlement_events FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/grant_founding_pilot_entitlement[\s\S]*?TO service_role/i);
    expect(migration).toMatch(/revoke_founding_pilot_entitlement[\s\S]*?TO service_role/i);
  });
});
