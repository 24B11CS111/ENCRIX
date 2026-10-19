import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Pure simulation of the PostgreSQL RLS Policy for public.call_recordings:
 *
 * CREATE POLICY "Tenant members can access own call_recordings"
 *     ON public.call_recordings
 *     FOR SELECT
 *     TO authenticated
 *     USING (
 *         EXISTS (
 *             SELECT 1 FROM public.profiles p
 *             WHERE p.organization_id = call_recordings.organization_id
 *             AND p.user_id = auth.uid()
 *             AND p.status = 'ACTIVE'
 *             AND (
 *                 p.role IN ('ADMIN', 'OWNER')
 *                 OR (
 *                     p.role = 'TELECALLER' AND EXISTS (
 *                         SELECT 1 FROM public.calls c
 *                         WHERE c.id = call_recordings.call_id
 *                         AND c.telecaller_id = p.id
 *                     )
 *                 )
 *             )
 *         )
 *     );
 */
function evaluateCallRecordingsRls(
  authUid: string | null,
  profile: { id: string; user_id: string; organization_id: string; role: string; status: string } | null,
  recording: { id: string; organization_id: string; call_id: string },
  call: { id: string; organization_id: string; telecaller_id: string; lead_id?: string } | null,
  lead?: { id: string; organization_id: string; assigned_to: string } | null
): boolean {
  if (!authUid || !profile) return false;
  if (profile.user_id !== authUid) return false;
  if (profile.organization_id !== recording.organization_id) return false;
  if (profile.status !== 'ACTIVE') return false;

  if (profile.role === 'ADMIN' || profile.role === 'OWNER') {
    return true;
  }

  if (profile.role === 'TELECALLER') {
    if (!call || call.id !== recording.call_id) return false;
    // Strictly initiator-only: calls.telecaller_id must match profile.id
    return call.telecaller_id === profile.id;
  }

  return false;
}

describe('ENCRIX Phase 23.6: Realtime Publication Idempotency & Recording Metadata Policy', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../../supabase/migrations/20261012000000_phase17_realtime_crm_telephony.sql'
  );

  // ==========================================================================
  // SUITE 1: STATIC MIGRATION SQL VERIFICATION
  // ==========================================================================
  describe('1. Static SQL Inspection: Realtime Idempotency & RLS Rerunnability', () => {
    it('migration file exists and is readable', () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql.length).toBeGreaterThan(0);
    });

    it('enforces DROP POLICY IF EXISTS before creating call_recordings policy', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(
        /DROP POLICY IF EXISTS "Tenant members can access own call_recordings" ON public\.call_recordings;\s*CREATE POLICY "Tenant members can access own call_recordings"\s+ON public\.call_recordings/i
      );
    });

    it('policy strictly restricts telecaller access to c.telecaller_id = p.id (no lead assignment bypass)', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/p\.organization_id = call_recordings\.organization_id/i);
      expect(sql).toMatch(/p\.user_id = auth\.uid\(\)/i);
      expect(sql).toMatch(/p\.status = 'ACTIVE'/i);
      // Must contain initiator check
      expect(sql).toMatch(/c\.telecaller_id = p\.id/i);
      // Must NOT contain lead assignment check
      expect(sql).not.toMatch(/assigned_to = p\.id/i);
      expect(sql).not.toMatch(/EXISTS \(\s*SELECT 1 FROM public\.leads/i);
    });

    it('does not catch unrelated SQL errors in the migration', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).not.toMatch(/\bEXCEPTION\s+WHEN\b/i);
    });

    it('publication addition checks pg_publication_tables for all 4 tables before ADD TABLE', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toMatch(/SELECT 1 FROM pg_publication_tables[\s\S]*?pubname = 'supabase_realtime'[\s\S]*?tablename = 'calls'/i);
      expect(sql).toMatch(/SELECT 1 FROM pg_publication_tables[\s\S]*?pubname = 'supabase_realtime'[\s\S]*?tablename = 'leads'/i);
      expect(sql).toMatch(/SELECT 1 FROM pg_publication_tables[\s\S]*?pubname = 'supabase_realtime'[\s\S]*?tablename = 'follow_ups'/i);
      expect(sql).toMatch(/SELECT 1 FROM pg_publication_tables[\s\S]*?pubname = 'supabase_realtime'[\s\S]*?tablename = 'security_events'/i);

      // Ensures ALTER PUBLICATION is wrapped in IF NOT EXISTS block
      expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*?tablename = 'calls'[\s\S]*?\) THEN\s*ALTER PUBLICATION supabase_realtime ADD TABLE public\.calls;/i);
      expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*?tablename = 'leads'[\s\S]*?\) THEN\s*ALTER PUBLICATION supabase_realtime ADD TABLE public\.leads;/i);
      expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*?tablename = 'follow_ups'[\s\S]*?\) THEN\s*ALTER PUBLICATION supabase_realtime ADD TABLE public\.follow_ups;/i);
      expect(sql).toMatch(/IF NOT EXISTS \([\s\S]*?tablename = 'security_events'[\s\S]*?\) THEN\s*ALTER PUBLICATION supabase_realtime ADD TABLE public\.security_events;/i);
    });
  });

  // ==========================================================================
  // SUITE 2: RECORDING METADATA AUTHORIZATION MATRIX
  // ==========================================================================
  describe('2. Recording Metadata Policy Authorization Matrix', () => {
    const orgA = 'org-vertex-01';
    const orgB = 'org-apex-02';

    const ownerA = {
      id: 'prof-owner-a',
      user_id: 'user-owner-a',
      organization_id: orgA,
      role: 'OWNER',
      status: 'ACTIVE',
    };

    const adminGlobal = {
      id: 'prof-admin-g',
      user_id: 'user-admin-g',
      organization_id: orgA,
      role: 'ADMIN',
      status: 'ACTIVE',
    };

    const telecallerArjun = {
      id: 'prof-arjun',
      user_id: 'user-arjun',
      organization_id: orgA,
      role: 'TELECALLER',
      status: 'ACTIVE',
    };

    const telecallerPriya = {
      id: 'prof-priya',
      user_id: 'user-priya',
      organization_id: orgA,
      role: 'TELECALLER',
      status: 'ACTIVE',
    };

    const callArjun = {
      id: 'call-101',
      organization_id: orgA,
      telecaller_id: telecallerArjun.id,
      lead_id: 'lead-999',
    };

    const leadPriyaAssigned = {
      id: 'lead-999',
      organization_id: orgA,
      assigned_to: telecallerPriya.id, // Priya is assigned to this lead, but Arjun made the call!
    };

    const recordingArjun = {
      id: 'rec-101',
      organization_id: orgA,
      call_id: callArjun.id,
    };

    it('permits organization Owner to view call recording metadata for call in their organization', () => {
      const allowed = evaluateCallRecordingsRls(
        ownerA.user_id,
        ownerA,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(true);
    });

    it('permits Admin to view call recording metadata', () => {
      const allowed = evaluateCallRecordingsRls(
        adminGlobal.user_id,
        adminGlobal,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(true);
    });

    it('permits initiating Telecaller (Arjun) to view recording metadata for their own call', () => {
      const allowed = evaluateCallRecordingsRls(
        telecallerArjun.user_id,
        telecallerArjun,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(true);
    });

    it('strictly DENIES Telecaller (Priya) from viewing recording metadata for Arjun call even though lead is assigned to Priya', () => {
      const allowed = evaluateCallRecordingsRls(
        telecallerPriya.user_id,
        telecallerPriya,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });

    it('strictly DENIES cross-tenant Owner access (Org B Owner cannot view Org A recording)', () => {
      const ownerB = {
        id: 'prof-owner-b',
        user_id: 'user-owner-b',
        organization_id: orgB,
        role: 'OWNER',
        status: 'ACTIVE',
      };
      const allowed = evaluateCallRecordingsRls(
        ownerB.user_id,
        ownerB,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });

    it('strictly DENIES cross-tenant Telecaller access', () => {
      const telecallerB = {
        id: 'prof-tc-b',
        user_id: 'user-tc-b',
        organization_id: orgB,
        role: 'TELECALLER',
        status: 'ACTIVE',
      };
      const allowed = evaluateCallRecordingsRls(
        telecallerB.user_id,
        telecallerB,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });

    it('strictly DENIES inactive Owner (status DISABLED) from viewing recording metadata', () => {
      const inactiveOwner = {
        ...ownerA,
        status: 'DISABLED',
      };
      const allowed = evaluateCallRecordingsRls(
        inactiveOwner.user_id,
        inactiveOwner,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });

    it('strictly DENIES inactive Telecaller (status SUSPENDED) even if they initiated the call', () => {
      const suspendedArjun = {
        ...telecallerArjun,
        status: 'SUSPENDED',
      };
      const allowed = evaluateCallRecordingsRls(
        suspendedArjun.user_id,
        suspendedArjun,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });

    it('strictly DENIES unauthenticated callers (null user_id / authUid)', () => {
      const allowed = evaluateCallRecordingsRls(
        null,
        null,
        recordingArjun,
        callArjun,
        leadPriyaAssigned
      );
      expect(allowed).toBe(false);
    });
  });

  // ==========================================================================
  // SUITE 3: PUBLICATION MEMBERSHIP IDEMPOTENCY SIMULATION
  // ==========================================================================
  describe('3. Realtime Publication Membership Idempotency Simulation', () => {
    const publicationName = 'supabase_realtime';
    const schemaName = 'public';
    const targetTables = ['calls', 'leads', 'follow_ups', 'security_events'];

    function applyPublicationMembershipChecks(publicationTables: Set<string>) {
      for (const table of targetTables) {
        const key = `${publicationName}.${schemaName}.${table}`;
        if (!publicationTables.has(key)) {
          publicationTables.add(key);
        }
      }
    }

    it('adds all four tables when the publication is empty and skips them on rerun', () => {
      const publicationTables = new Set<string>();
      const expectedTables = targetTables.map(
        (table) => `${publicationName}.${schemaName}.${table}`
      );

      applyPublicationMembershipChecks(publicationTables);
      expect(publicationTables).toEqual(new Set(expectedTables));

      applyPublicationMembershipChecks(publicationTables);
      expect(publicationTables).toEqual(new Set(expectedTables));
    });

    it('adds only missing tables when some target tables are already members', () => {
      const publicationTables = new Set([
        `${publicationName}.${schemaName}.calls`,
        `${publicationName}.${schemaName}.follow_ups`,
      ]);

      applyPublicationMembershipChecks(publicationTables);

      expect(publicationTables).toEqual(
        new Set(targetTables.map((table) => `${publicationName}.${schemaName}.${table}`))
      );
    });
  });
});
