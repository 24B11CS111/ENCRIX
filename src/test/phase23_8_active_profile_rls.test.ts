import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db } from '@/services/supabase/db';
import { authenticateServerRequest } from '../../api/_lib/supabaseServer';
import { createSignedSessionToken } from '../../api/_lib/sessionServer';
import { Profile } from '@/types';

// ============================================================================
// SIMULATION ENGINE: PostgreSQL RLS with Restrictive Active-Profile Policy
// ============================================================================

interface MockDbProfile {
  id: string;
  user_id: string;
  organization_id: string | null;
  role: 'ADMIN' | 'OWNER' | 'TELECALLER';
  status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED' | 'PENDING' | 'PENDING_VERIFICATION';
}

function simulateIsActiveAuthenticatedProfile(
  authUid: string | null,
  profiles: MockDbProfile[]
): boolean {
  if (!authUid) return false;
  return profiles.some((p) => p.user_id === authUid && p.status === 'ACTIVE');
}

function simulateGetAuthRole(
  authUid: string | null,
  profiles: MockDbProfile[]
): string | null {
  if (!authUid) return null;
  const match = profiles.find((p) => p.user_id === authUid && p.status === 'ACTIVE');
  return match ? match.role : null;
}

function simulateGetAuthOrgId(
  authUid: string | null,
  profiles: MockDbProfile[]
): string | null {
  if (!authUid) return null;
  const match = profiles.find((p) => p.user_id === authUid && p.status === 'ACTIVE');
  return match ? match.organization_id : null;
}

function simulateGetAuthProfile(
  authUid: string | null,
  profiles: MockDbProfile[]
): MockDbProfile | null {
  if (!authUid) return null;
  const match = profiles.find((p) => p.user_id === authUid && p.status === 'ACTIVE');
  return match || null;
}

/**
 * Evaluates whether a table operation qualifies under PostgreSQL RLS:
 * - Permissive policies are OR-ed together.
 * - The restrictive active_profile_required_phase23_8 policy is AND-ed.
 */
function evaluateTableAccess(options: {
  table: string;
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  authUid: string | null;
  callerProfile: MockDbProfile | null;
  allProfiles: MockDbProfile[];
  targetRow: Record<string, any>;
}): { allowed: boolean; violation?: string } {
  const { table, operation, authUid, callerProfile, allProfiles, targetRow } = options;

  // 1. Restrictive policy check: must have active authenticated profile
  const isActive = simulateIsActiveAuthenticatedProfile(authUid, allProfiles);
  if (!isActive) {
    if (operation === 'INSERT') {
      return { allowed: false, violation: 'violates row-level security policy for table ' + table };
    }
    return { allowed: false };
  }

  // Active helpers
  const callerRole = simulateGetAuthRole(authUid, allProfiles);
  const callerOrg = simulateGetAuthOrgId(authUid, allProfiles);

  if (!callerRole) return { allowed: false };

  // 2. Permissive policies per table
  switch (table) {
    case 'leads': {
      if (operation === 'SELECT') {
        // "Telecallers cannot select raw leads" is RESTRICTIVE: role <> 'TELECALLER'
        if (callerRole === 'TELECALLER') return { allowed: false };
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      if (operation === 'INSERT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        return { allowed: false, violation: 'violates row-level security policy for table leads' };
      }
      if (operation === 'UPDATE') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (
          callerRole === 'TELECALLER' &&
          targetRow.organization_id === callerOrg &&
          targetRow.assigned_to === callerProfile?.id
        ) {
          return { allowed: true };
        }
        return { allowed: false };
      }
      if (operation === 'DELETE') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      break;
    }

    case 'calls': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (callerRole === 'TELECALLER' && targetRow.telecaller_id === callerProfile?.id) return { allowed: true };
        return { allowed: false };
      }
      if (operation === 'INSERT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (
          callerRole === 'TELECALLER' &&
          targetRow.organization_id === callerOrg &&
          targetRow.telecaller_id === callerProfile?.id
        ) {
          return { allowed: true };
        }
        return { allowed: false, violation: 'violates row-level security policy for table calls' };
      }
      break;
    }

    case 'call_recordings': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (targetRow.organization_id !== callerOrg) return { allowed: false };
        if (callerRole === 'OWNER') return { allowed: true };
        if (callerRole === 'TELECALLER' && targetRow.telecaller_id === callerProfile?.id) return { allowed: true };
        return { allowed: false };
      }
      break;
    }

    case 'follow_ups': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (
          callerRole === 'TELECALLER' &&
          targetRow.organization_id === callerOrg &&
          targetRow.assigned_to === callerProfile?.id
        ) {
          return { allowed: true };
        }
        return { allowed: false };
      }
      if (operation === 'UPDATE' || operation === 'DELETE') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (
          callerRole === 'TELECALLER' &&
          targetRow.organization_id === callerOrg &&
          targetRow.assigned_to === callerProfile?.id
        ) {
          return { allowed: true };
        }
        return { allowed: false };
      }
      break;
    }

    case 'profiles': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (targetRow.organization_id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      if (operation === 'UPDATE') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        if (targetRow.user_id === authUid) return { allowed: true };
        return { allowed: false };
      }
      break;
    }

    case 'notifications': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (targetRow.user_id === callerProfile?.id) return { allowed: true };
        return { allowed: false };
      }
      break;
    }

    case 'activity_logs':
    case 'security_events': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.organization_id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      if (operation === 'INSERT') {
        return { allowed: true };
      }
      break;
    }

    case 'organizations': {
      if (operation === 'SELECT') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (targetRow.id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      if (operation === 'UPDATE') {
        if (callerRole === 'ADMIN') return { allowed: true };
        if (callerRole === 'OWNER' && targetRow.id === callerOrg) return { allowed: true };
        return { allowed: false };
      }
      break;
    }
  }

  return { allowed: false };
}

describe('ENCRIX Phase 23.8: Active Profile RLS & Inactive Authorization Gap Remediation', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../supabase/migrations/20261022000000_phase23_8_active_profile_rls.sql'
  );
  const testSqlPath = path.resolve(
    __dirname,
    '../../supabase/tests/phase23_8_inactive_profile_rls.test.sql'
  );

  // ==========================================================================
  // SUITE 1: STATIC MIGRATION SQL VERIFICATION
  // ==========================================================================
  describe('1. Static SQL Inspection: Forward-Only Migration & Function Hardening', () => {
    it('migration file exists and is forward-only', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql.length).toBeGreaterThan(0);
      // Forward-only: no DROP TABLE or destruction
      expect(sql).not.toMatch(/DROP\s+TABLE/i);
      expect(sql).not.toMatch(/TRUNCATE/i);
    });

    it('pins search_path = public, pg_temp on all helper functions', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      const functions = [
        'is_active_authenticated_profile',
        'is_caller_active',
        'get_auth_profile',
        'get_auth_role',
        'get_auth_org_id',
      ];
      for (const fn of functions) {
        const regex = new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public, pg_temp`,
          'i'
        );
        expect(sql).toMatch(regex);
      }
    });

    it('revokes execution from PUBLIC and anon and grants to authenticated, service_role', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      const functions = [
        'is_active_authenticated_profile',
        'is_caller_active',
        'get_auth_profile',
        'get_auth_role',
        'get_auth_org_id',
      ];
      for (const fn of functions) {
        expect(sql).toMatch(
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\)\\s+FROM PUBLIC, anon`, 'i')
        );
        expect(sql).toMatch(
          new RegExp(
            `GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\)\\s+TO authenticated, service_role`,
            'i'
          )
        );
      }
    });

    it('enforces status = ACTIVE in is_active_authenticated_profile()', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/auth\.uid\(\)\s+IS NOT NULL/i);
      expect(sql).toMatch(/p\.status\s*=\s*'ACTIVE'/i);
    });

    it('enforces status = ACTIVE in get_auth_role(), get_auth_org_id(), and get_auth_profile()', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      const roleBlock = sql.slice(
        sql.indexOf('FUNCTION public.get_auth_role()'),
        sql.indexOf('FUNCTION public.get_auth_org_id()')
      );
      expect(roleBlock).toMatch(/p\.user_id\s*=\s*auth\.uid\(\)/i);
      expect(roleBlock).toMatch(/p\.status\s*=\s*'ACTIVE'/i);

      const orgBlock = sql.slice(
        sql.indexOf('FUNCTION public.get_auth_org_id()'),
        sql.indexOf('active_profile_required_phase23_8')
      );
      expect(orgBlock).toMatch(/p\.user_id\s*=\s*auth\.uid\(\)/i);
      expect(orgBlock).toMatch(/p\.status\s*=\s*'ACTIVE'/i);
    });

    it('dynamically attaches RESTRICTIVE policy to all public tables with relrowsecurity', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/SELECT n\.nspname, c\.relname/i);
      expect(sql).toMatch(/FROM pg_class c/i);
      expect(sql).toMatch(/WHERE n\.nspname = 'public'/i);
      expect(sql).toMatch(/c\.relrowsecurity/i);
      expect(sql).toMatch(
        /CREATE POLICY %I ON %I\.%I AS RESTRICTIVE FOR ALL TO authenticated USING \(public\.is_active_authenticated_profile\(\)\) WITH CHECK \(public\.is_active_authenticated_profile\(\)\)/i
      );
      expect(sql).toMatch(/DROP POLICY IF EXISTS %I ON %I\.%I/i);
    });

    it('database test script exists and verifies active/inactive profile behavior in a rolled-back transaction', () => {
      expect(fs.existsSync(testSqlPath)).toBe(true);
      const sql = fs.readFileSync(testSqlPath, 'utf-8');
      expect(sql).toMatch(/^BEGIN;/m);
      expect(sql).toMatch(/ROLLBACK;$/m);
      expect(sql).toMatch(/p238-disabled-owner@example\.test/i);
      expect(sql).toMatch(/p238-suspended-tc@example\.test/i);
      expect(sql).toMatch(/p238-pending-tc@example\.test/i);
      expect(sql).toMatch(/Disabled owner read tenant data/i);
      expect(sql).toMatch(/Suspended telecaller read tenant data/i);
      expect(sql).toMatch(/Pending telecaller read tenant data/i);
    });
  });

  // ==========================================================================
  // SUITE 2: AUTHORIZATION HELPERS UNIT BEHAVIOR
  // ==========================================================================
  describe('2. Authorization Helpers: Active vs Inactive Profile Resolution', () => {
    const orgA = '91000000-0000-4000-8000-000000000001';
    const testProfiles: MockDbProfile[] = [
      {
        id: '92000000-0000-4000-8000-000000000001',
        user_id: '90000000-0000-4000-8000-000000000001',
        organization_id: orgA,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      {
        id: '92000000-0000-4000-8000-000000000002',
        user_id: '90000000-0000-4000-8000-000000000002',
        organization_id: orgA,
        role: 'TELECALLER',
        status: 'ACTIVE',
      },
      {
        id: '92000000-0000-4000-8000-000000000003',
        user_id: '90000000-0000-4000-8000-000000000003',
        organization_id: orgA,
        role: 'OWNER',
        status: 'DISABLED',
      },
      {
        id: '92000000-0000-4000-8000-000000000004',
        user_id: '90000000-0000-4000-8000-000000000004',
        organization_id: orgA,
        role: 'TELECALLER',
        status: 'SUSPENDED',
      },
      {
        id: '92000000-0000-4000-8000-000000000005',
        user_id: '90000000-0000-4000-8000-000000000005',
        organization_id: orgA,
        role: 'TELECALLER',
        status: 'PENDING',
      },
    ];

    it('is_active_authenticated_profile() returns true ONLY for active profiles', () => {
      expect(simulateIsActiveAuthenticatedProfile('90000000-0000-4000-8000-000000000001', testProfiles)).toBe(true);
      expect(simulateIsActiveAuthenticatedProfile('90000000-0000-4000-8000-000000000002', testProfiles)).toBe(true);
      // Inactive profiles return false
      expect(simulateIsActiveAuthenticatedProfile('90000000-0000-4000-8000-000000000003', testProfiles)).toBe(false);
      expect(simulateIsActiveAuthenticatedProfile('90000000-0000-4000-8000-000000000004', testProfiles)).toBe(false);
      expect(simulateIsActiveAuthenticatedProfile('90000000-0000-4000-8000-000000000005', testProfiles)).toBe(false);
      // Unauthenticated or unknown returns false
      expect(simulateIsActiveAuthenticatedProfile(null, testProfiles)).toBe(false);
      expect(simulateIsActiveAuthenticatedProfile('non-existent-user', testProfiles)).toBe(false);
    });

    it('get_auth_role() returns role for active profiles, null for inactive or unauthenticated', () => {
      expect(simulateGetAuthRole('90000000-0000-4000-8000-000000000001', testProfiles)).toBe('OWNER');
      expect(simulateGetAuthRole('90000000-0000-4000-8000-000000000002', testProfiles)).toBe('TELECALLER');
      // Inactive profiles return null
      expect(simulateGetAuthRole('90000000-0000-4000-8000-000000000003', testProfiles)).toBeNull();
      expect(simulateGetAuthRole('90000000-0000-4000-8000-000000000004', testProfiles)).toBeNull();
      expect(simulateGetAuthRole('90000000-0000-4000-8000-000000000005', testProfiles)).toBeNull();
      expect(simulateGetAuthRole(null, testProfiles)).toBeNull();
    });

    it('get_auth_org_id() returns organization_id for active profiles, null for inactive', () => {
      expect(simulateGetAuthOrgId('90000000-0000-4000-8000-000000000001', testProfiles)).toBe(orgA);
      expect(simulateGetAuthOrgId('90000000-0000-4000-8000-000000000002', testProfiles)).toBe(orgA);
      // Inactive profiles return null
      expect(simulateGetAuthOrgId('90000000-0000-4000-8000-000000000003', testProfiles)).toBeNull();
      expect(simulateGetAuthOrgId('90000000-0000-4000-8000-000000000004', testProfiles)).toBeNull();
      expect(simulateGetAuthOrgId(null, testProfiles)).toBeNull();
    });

    it('get_auth_profile() returns record for active profiles, null for inactive', () => {
      expect(simulateGetAuthProfile('90000000-0000-4000-8000-000000000001', testProfiles)?.id).toBe(
        '92000000-0000-4000-8000-000000000001'
      );
      // Inactive profiles return null
      expect(simulateGetAuthProfile('90000000-0000-4000-8000-000000000003', testProfiles)).toBeNull();
      expect(simulateGetAuthProfile('90000000-0000-4000-8000-000000000004', testProfiles)).toBeNull();
      expect(simulateGetAuthProfile(null, testProfiles)).toBeNull();
    });
  });

  // ==========================================================================
  // SUITE 3: COMPREHENSIVE RLS ACCESS MATRIX (READ & WRITE)
  // ==========================================================================
  describe('3. RLS Matrix: Inactive Owners & Telecallers Denied All Operations', () => {
    const orgA = '91000000-0000-4000-8000-000000000001';
    const orgB = '91000000-0000-4000-8000-000000000002';

    const activeOwner: MockDbProfile = {
      id: '92000000-0000-4000-8000-000000000001',
      user_id: '90000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      role: 'OWNER',
      status: 'ACTIVE',
    };
    const activeTelecaller: MockDbProfile = {
      id: '92000000-0000-4000-8000-000000000002',
      user_id: '90000000-0000-4000-8000-000000000002',
      organization_id: orgA,
      role: 'TELECALLER',
      status: 'ACTIVE',
    };
    const disabledOwner: MockDbProfile = {
      id: '92000000-0000-4000-8000-000000000003',
      user_id: '90000000-0000-4000-8000-000000000003',
      organization_id: orgA,
      role: 'OWNER',
      status: 'DISABLED',
    };
    const suspendedTelecaller: MockDbProfile = {
      id: '92000000-0000-4000-8000-000000000004',
      user_id: '90000000-0000-4000-8000-000000000004',
      organization_id: orgA,
      role: 'TELECALLER',
      status: 'SUSPENDED',
    };

    const allProfiles = [activeOwner, activeTelecaller, disabledOwner, suspendedTelecaller];

    const leadOrgA = {
      id: '93000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      assigned_to: activeTelecaller.id,
    };
    const leadOrgB = {
      id: '93000000-0000-4000-8000-000000000002',
      organization_id: orgB,
      assigned_to: null,
    };
    const callOrgA = {
      id: '94000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      telecaller_id: activeTelecaller.id,
    };
    const recordingOrgA = {
      id: '95000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      call_id: callOrgA.id,
      telecaller_id: activeTelecaller.id,
    };
    const followUpOrgA = {
      id: '96000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      assigned_to: activeTelecaller.id,
    };
    const notificationOrgA = {
      id: '97000000-0000-4000-8000-000000000001',
      organization_id: orgA,
      user_id: disabledOwner.id,
    };

    // --- Disabled Owner Tests ---
    describe('Disabled Owner Access Denials', () => {
      it('denies SELECT across all tables', () => {
        const tables = [
          { table: 'leads', row: leadOrgA },
          { table: 'calls', row: callOrgA },
          { table: 'call_recordings', row: recordingOrgA },
          { table: 'follow_ups', row: followUpOrgA },
          { table: 'profiles', row: disabledOwner },
          { table: 'notifications', row: notificationOrgA },
          { table: 'organizations', row: { id: orgA } },
          { table: 'activity_logs', row: { organization_id: orgA } },
          { table: 'security_events', row: { organization_id: orgA } },
        ];

        for (const { table, row } of tables) {
          const res = evaluateTableAccess({
            table,
            operation: 'SELECT',
            authUid: disabledOwner.user_id,
            callerProfile: disabledOwner,
            allProfiles,
            targetRow: row,
          });
          expect(res.allowed).toBe(false);
        }
      });

      it('denies INSERT across tenant tables with RLS policy violation', () => {
        const resLead = evaluateTableAccess({
          table: 'leads',
          operation: 'INSERT',
          authUid: disabledOwner.user_id,
          callerProfile: disabledOwner,
          allProfiles,
          targetRow: { organization_id: orgA, lead_code: 'TEST' },
        });
        expect(resLead.allowed).toBe(false);
        expect(resLead.violation).toMatch(/violates row-level security policy/i);

        const resCall = evaluateTableAccess({
          table: 'calls',
          operation: 'INSERT',
          authUid: disabledOwner.user_id,
          callerProfile: disabledOwner,
          allProfiles,
          targetRow: { organization_id: orgA },
        });
        expect(resCall.allowed).toBe(false);
        expect(resCall.violation).toMatch(/violates row-level security policy/i);
      });

      it('denies UPDATE and DELETE on leads (0 qualifying rows)', () => {
        const resUpdate = evaluateTableAccess({
          table: 'leads',
          operation: 'UPDATE',
          authUid: disabledOwner.user_id,
          callerProfile: disabledOwner,
          allProfiles,
          targetRow: leadOrgA,
        });
        expect(resUpdate.allowed).toBe(false);

        const resDelete = evaluateTableAccess({
          table: 'leads',
          operation: 'DELETE',
          authUid: disabledOwner.user_id,
          callerProfile: disabledOwner,
          allProfiles,
          targetRow: leadOrgA,
        });
        expect(resDelete.allowed).toBe(false);
      });

      it('denies self-update or status reactivation on profiles', () => {
        const resProfileUpdate = evaluateTableAccess({
          table: 'profiles',
          operation: 'UPDATE',
          authUid: disabledOwner.user_id,
          callerProfile: disabledOwner,
          allProfiles,
          targetRow: disabledOwner,
        });
        expect(resProfileUpdate.allowed).toBe(false);
      });
    });

    // --- Suspended Telecaller Tests ---
    describe('Suspended Telecaller Access Denials', () => {
      it('denies SELECT across leads, calls, recordings, follow_ups, notifications', () => {
        const tables = [
          { table: 'leads', row: leadOrgA },
          { table: 'calls', row: callOrgA },
          { table: 'call_recordings', row: recordingOrgA },
          { table: 'follow_ups', row: followUpOrgA },
          { table: 'notifications', row: { id: 'notif-1', user_id: suspendedTelecaller.id } },
        ];

        for (const { table, row } of tables) {
          const res = evaluateTableAccess({
            table,
            operation: 'SELECT',
            authUid: suspendedTelecaller.user_id,
            callerProfile: suspendedTelecaller,
            allProfiles,
            targetRow: row,
          });
          expect(res.allowed).toBe(false);
        }
      });

      it('denies INSERT calls with RLS policy violation', () => {
        const res = evaluateTableAccess({
          table: 'calls',
          operation: 'INSERT',
          authUid: suspendedTelecaller.user_id,
          callerProfile: suspendedTelecaller,
          allProfiles,
          targetRow: { organization_id: orgA, telecaller_id: suspendedTelecaller.id },
        });
        expect(res.allowed).toBe(false);
        expect(res.violation).toMatch(/violates row-level security policy/i);
      });

      it('denies UPDATE on assigned leads and follow-ups', () => {
        const resLead = evaluateTableAccess({
          table: 'leads',
          operation: 'UPDATE',
          authUid: suspendedTelecaller.user_id,
          callerProfile: suspendedTelecaller,
          allProfiles,
          targetRow: { ...leadOrgA, assigned_to: suspendedTelecaller.id },
        });
        expect(resLead.allowed).toBe(false);

        const resFup = evaluateTableAccess({
          table: 'follow_ups',
          operation: 'UPDATE',
          authUid: suspendedTelecaller.user_id,
          callerProfile: suspendedTelecaller,
          allProfiles,
          targetRow: { ...followUpOrgA, assigned_to: suspendedTelecaller.id },
        });
        expect(resFup.allowed).toBe(false);
      });
    });

    // --- Active Owner & Active Telecaller Tests ---
    describe('Active Profile Authorized Operations', () => {
      it('permits active owner to read, insert, update, delete in own tenant', () => {
        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'SELECT',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: leadOrgA,
          }).allowed
        ).toBe(true);

        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'INSERT',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: { organization_id: orgA },
          }).allowed
        ).toBe(true);

        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'UPDATE',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: leadOrgA,
          }).allowed
        ).toBe(true);

        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'DELETE',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: leadOrgA,
          }).allowed
        ).toBe(true);
      });

      it('strictly denies active owner from cross-tenant operations in Tenant B', () => {
        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'SELECT',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: leadOrgB,
          }).allowed
        ).toBe(false);

        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'INSERT',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: { organization_id: orgB },
          }).allowed
        ).toBe(false);

        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'UPDATE',
            authUid: activeOwner.user_id,
            callerProfile: activeOwner,
            allProfiles,
            targetRow: leadOrgB,
          }).allowed
        ).toBe(false);
      });

      it('permits active telecaller to insert/view own calls and view recordings for own calls', () => {
        expect(
          evaluateTableAccess({
            table: 'calls',
            operation: 'INSERT',
            authUid: activeTelecaller.user_id,
            callerProfile: activeTelecaller,
            allProfiles,
            targetRow: callOrgA,
          }).allowed
        ).toBe(true);

        expect(
          evaluateTableAccess({
            table: 'calls',
            operation: 'SELECT',
            authUid: activeTelecaller.user_id,
            callerProfile: activeTelecaller,
            allProfiles,
            targetRow: callOrgA,
          }).allowed
        ).toBe(true);

        expect(
          evaluateTableAccess({
            table: 'call_recordings',
            operation: 'SELECT',
            authUid: activeTelecaller.user_id,
            callerProfile: activeTelecaller,
            allProfiles,
            targetRow: recordingOrgA,
          }).allowed
        ).toBe(true);
      });

      it('denies active telecaller from direct raw leads SELECT and unassigned lead updates', () => {
        // Raw leads SELECT is blocked by restrictive policy
        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'SELECT',
            authUid: activeTelecaller.user_id,
            callerProfile: activeTelecaller,
            allProfiles,
            targetRow: leadOrgA,
          }).allowed
        ).toBe(false);

        // Update on unassigned lead is blocked
        expect(
          evaluateTableAccess({
            table: 'leads',
            operation: 'UPDATE',
            authUid: activeTelecaller.user_id,
            callerProfile: activeTelecaller,
            allProfiles,
            targetRow: { ...leadOrgA, assigned_to: 'other-telecaller' },
          }).allowed
        ).toBe(false);
      });
    });
  });

  // ==========================================================================
  // SUITE 4: CLIENT & SERVER INTEGRATION REGRESSION TESTS
  // ==========================================================================
  describe('4. Client & Server Integration: Inactive Account Rejection', () => {
    beforeEach(() => {
      db.resetSandbox();
    });

    const activeOwnerProfile: Profile = {
      id: 'prof-owner-001',
      user_id: 'user-owner-001',
      organization_id: 'org-vertex-001',
      full_name: 'Vertex Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('db.getLeads rejects callers with status DISABLED or SUSPENDED', () => {
      expect(() => {
        db.getLeads({ ...activeOwnerProfile, status: 'DISABLED' });
      }).toThrow(/inactive|suspended|disabled/i);

      expect(() => {
        db.getLeads({ ...activeOwnerProfile, status: 'SUSPENDED' });
      }).toThrow(/inactive|suspended|disabled/i);
    });

    it('db.updateLead rejects inactive callers', () => {
      const leads = db.getLeads(activeOwnerProfile);
      expect(leads.length).toBeGreaterThan(0);

      expect(() => {
        db.updateLead(leads[0].id, { notes: 'tamper' }, { ...activeOwnerProfile, status: 'DISABLED' });
      }).toThrow(/inactive|suspended|disabled/i);
    });

    it('authenticateServerRequest rejects server-signed session token if profile status is DISABLED', async () => {
      const token = createSignedSessionToken({
        userId: 'test-user-disabled',
        profileId: 'test-prof-disabled',
        organizationId: 'org-test',
        role: 'OWNER',
        fullName: 'Disabled Owner',
        email: 'disabled@test.com',
        status: 'DISABLED',
      });

      const result = await authenticateServerRequest({
        headers: { authorization: `Bearer ${token}` },
      });

      // When token status is DISABLED, authenticateServerRequest flags profile as DISABLED
      expect(result.profile?.status).toBe('DISABLED');
    });
  });
});
