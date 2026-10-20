import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db } from '@/services/supabase/db';
import { recordingService } from '@/services/telephony/recordingService';
import { Profile } from '@/types';

const serverMocks = vi.hoisted(() => ({
  authenticateServerRequest: vi.fn(),
  getSupabaseServerClient: vi.fn(),
  isRealSupabaseServerConfigured: vi.fn(() => true),
}));

vi.mock('../../api/_lib/supabaseServer', () => serverMocks);

import recordingHandler from '../../api/telephony/recording';

const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '20000000-0000-4000-8000-000000000002';
const ownerA: Profile = {
  id: '30000000-0000-4000-8000-000000000001',
  user_id: '40000000-0000-4000-8000-000000000001',
  organization_id: orgA,
  full_name: 'Organization Owner',
  role: 'OWNER',
  status: 'ACTIVE',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const ownerB: Profile = {
  ...ownerA,
  id: '30000000-0000-4000-8000-000000000002',
  user_id: '40000000-0000-4000-8000-000000000002',
  organization_id: orgB,
};
const telecaller: Profile = {
  ...ownerA,
  id: '30000000-0000-4000-8000-000000000003',
  user_id: '40000000-0000-4000-8000-000000000003',
  role: 'TELECALLER',
};
const call = {
  id: '50000000-0000-4000-8000-000000000001',
  organization_id: orgA,
  lead_id: '60000000-0000-4000-8000-000000000001',
  telecaller_id: telecaller.id,
  recording_url: `${orgA}/50000000-0000-4000-8000-000000000001.mp3`,
};

function request(callId: string) {
  return {
    req: {
      method: 'GET',
      headers: { authorization: 'Bearer test-session' },
      query: { callId },
    },
    res: {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: any) {
        this.body = body;
        return this;
      },
    },
  };
}

function createRecordingSupabase(options?: {
  callData?: typeof call | null;
  signedResult?: { data: { signedUrl: string } | null; error: { message: string } | null };
}) {
  return {
    from(table: string) {
      if (table === 'security_events') {
        return { insert: async () => ({ error: null }) };
      }
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({
          data: options?.callData === undefined ? call : options.callData,
          error: options?.callData === null ? { message: 'Not found' } : null,
        }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () =>
          options?.signedResult || {
            data: { signedUrl: 'https://storage.example/signed' },
            error: null,
          },
      }),
    },
  };
}

describe('Phase 23.7 production blocker remediation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    db.resetSandbox();
    (db as any).profiles = [ownerA, ownerB, telecaller];
    serverMocks.authenticateServerRequest.mockResolvedValue({
      user: { id: telecaller.user_id },
      profile: telecaller,
      error: null,
    });
    serverMocks.getSupabaseServerClient.mockReturnValue(createRecordingSupabase());
    serverMocks.isRealSupabaseServerConfigured.mockReturnValue(true);
  });

  describe('role privilege escalation', () => {
    it('prevents an owner from promoting another owner to global ADMIN', () => {
      const sameTenantOwner = {
        ...ownerB,
        id: '30000000-0000-4000-8000-000000000004',
        organization_id: orgA,
      };
      (db as any).profiles.push(sameTenantOwner);
      expect(() => db.updateProfile(sameTenantOwner.id, { role: 'ADMIN' }, ownerA)).toThrow(/platform administration flow/i);
      expect((db as any).profiles.find((profile: Profile) => profile.id === sameTenantOwner.id).role).toBe('OWNER');
    });

    it('prevents a telecaller from promoting a user to global ADMIN', () => {
      const sameTenantOwner = {
        ...ownerB,
        id: '30000000-0000-4000-8000-000000000004',
        organization_id: orgA,
      };
      (db as any).profiles.push(sameTenantOwner);
      expect(() => db.updateProfile(sameTenantOwner.id, { role: 'ADMIN' }, telecaller)).toThrow(/platform administration flow/i);
    });

    it('preserves permitted organization-level role changes', () => {
      const sameTenantOwner = {
        ...ownerB,
        id: '30000000-0000-4000-8000-000000000004',
        organization_id: orgA,
      };
      (db as any).profiles.push(sameTenantOwner);
      const updated = db.updateProfile(sameTenantOwner.id, { role: 'TELECALLER' }, ownerA);
      expect(updated.role).toBe('TELECALLER');
      expect(updated.organization_id).toBe(orgA);
    });
  });

  describe('telecaller leads and Realtime privacy', () => {
    it('keeps the recreated leads view null-safe and strips digits and phone delimiters from names', () => {
      const sql = fs.readFileSync(
        path.resolve(
          process.cwd(),
          'supabase',
          'migrations',
          '20261021000000_phase23_7_production_blocker_remediation.sql'
        ),
        'utf-8'
      );
      const viewSql = sql.slice(
        sql.indexOf('CREATE VIEW public.telecaller_leads_view'),
        sql.indexOf('GRANT SELECT ON public.telecaller_leads_view')
      );

      expect(viewSql).toContain("REGEXP_REPLACE(COALESCE(l.name, ''), '[0-9]', '', 'g')");
      expect(viewSql).toContain("'[-_./,()+]+'");
      expect(viewSql).toContain("'[[:space:]]+'");
      expect(viewSql).toMatch(/COALESCE\(NULLIF\(BTRIM\(n\.clean_name\), ''\), 'Student'\)/i);
      expect(viewSql).not.toMatch(/^\s*l\.phone\b/im);
    });

    it('blocks inactive and suspended profiles and keeps lead reads assigned and tenant-scoped', () => {
      const assignedLead = {
        id: 'lead-assigned',
        organization_id: orgA,
        assigned_to: telecaller.id,
        name: 'Mira Student',
        phone: '+91 9876543210',
        email: 'mira@example.test',
        status: 'ASSIGNED',
      };
      (db as any).leads = [
        assignedLead,
        { ...assignedLead, id: 'lead-other-user', assigned_to: ownerB.id },
        { ...assignedLead, id: 'lead-other-org', organization_id: orgB },
      ];

      const result = db.getLeads(telecaller);
      expect(result.map((lead) => lead.id)).toEqual(['lead-assigned']);
      expect(JSON.stringify(result)).not.toMatch(/9876543210|mira@example\.test/);
      expect(() => db.getLeads({ ...telecaller, status: 'DISABLED' })).toThrow(/inactive|suspended|disabled/i);
      expect(() => db.getLeads({ ...telecaller, status: 'SUSPENDED' })).toThrow(/inactive|suspended|disabled/i);
      expect(db.getLeads(ownerA)).toHaveLength(2);
      expect(db.getLeads({ ...ownerA, role: 'ADMIN', organization_id: '' })).toHaveLength(3);
    });

    it('delivers only assigned lead changes to active telecallers and strips nested contact data', () => {
      const received: any[] = [];
      const unsubscribe = db.subscribe((event) => received.push(event), telecaller);
      const emit = (db as any).emit.bind(db);

      emit(
        'RECORD_INSERTED',
        {
          table: 'leads',
          eventType: 'INSERT',
          new: {
            id: 'lead-assigned',
            organization_id: orgA,
            assigned_to: telecaller.id,
            phone: '+91 9876543210',
            notes: 'Call 9876543210',
            details: { contact_phone: '9876543210' },
          },
          old: {},
        },
        { organization_id: orgA }
      );
      emit(
        'RECORD_INSERTED',
        {
          table: 'leads',
          eventType: 'INSERT',
          new: { id: 'lead-unassigned', organization_id: orgA, assigned_to: ownerB.id },
          old: {},
        },
        { organization_id: orgA }
      );

      unsubscribe();
      expect(received).toHaveLength(1);
      expect(JSON.stringify(received[0])).not.toMatch(/9876543210|contact_phone/);
      expect((received[0].payload as any).new.assigned_to).toBe(telecaller.id);
    });

    it('does not restore a revoked session from its signed role claim when profile verification fails', async () => {
      const originalEnv = {
        url: process.env.VITE_SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      };
      process.env.VITE_SUPABASE_URL = 'https://project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'configured-service-role-key';
      const profileQuery: any = {
        select: () => profileQuery,
        eq: () => profileQuery,
        single: async () => ({ data: null, error: { message: 'profile unavailable' } }),
      };
      vi.resetModules();
      vi.doMock('@supabase/supabase-js', () => ({
        createClient: () => ({ from: () => profileQuery }),
      }));

      try {
        const { authenticateServerRequest } = await vi.importActual<
          typeof import('../../api/_lib/supabaseServer')
        >('../../api/_lib/supabaseServer');
        const { createSignedSessionToken } = await import('../../api/_lib/sessionServer');
        const token = createSignedSessionToken({
          userId: telecaller.user_id,
          profileId: telecaller.id,
          organizationId: orgA,
          role: 'TELECALLER',
          fullName: telecaller.full_name,
          email: '',
          status: 'ACTIVE',
        });
        const result = await authenticateServerRequest({
          headers: { authorization: `Bearer ${token}` },
        });

        expect(result.profile).toBeNull();
        expect(result.error).toMatch(/Unable to verify/i);
      } finally {
        vi.doUnmock('@supabase/supabase-js');
        if (originalEnv.url === undefined) {
          delete process.env.VITE_SUPABASE_URL;
        } else {
          process.env.VITE_SUPABASE_URL = originalEnv.url;
        }
        if (originalEnv.serviceKey === undefined) {
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
          process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.serviceKey;
        }
        vi.resetModules();
      }
    });

    it('rejects inactive profiles resolved from Supabase Auth JWTs', async () => {
      const originalEnv = {
        url: process.env.VITE_SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      };
      process.env.VITE_SUPABASE_URL = 'https://project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'configured-service-role-key';
      const profileQuery: any = {
        select: () => profileQuery,
        eq: () => profileQuery,
        single: async () => ({
          data: { ...telecaller, status: 'DISABLED' },
          error: null,
        }),
      };
      vi.resetModules();
      vi.doMock('@supabase/supabase-js', () => ({
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: telecaller.user_id } }, error: null }) },
          from: () => profileQuery,
        }),
      }));

      try {
        const { authenticateServerRequest } = await vi.importActual<
          typeof import('../../api/_lib/supabaseServer')
        >('../../api/_lib/supabaseServer');
        const result = await authenticateServerRequest({
          headers: { authorization: 'Bearer supabase-access-token' },
        });

        expect(result.profile?.status).toBe('DISABLED');
        expect(result.error).toMatch(/inactive or suspended/i);
      } finally {
        vi.doUnmock('@supabase/supabase-js');
        if (originalEnv.url === undefined) {
          delete process.env.VITE_SUPABASE_URL;
        } else {
          process.env.VITE_SUPABASE_URL = originalEnv.url;
        }
        if (originalEnv.serviceKey === undefined) {
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
          process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.serviceKey;
        }
        vi.resetModules();
      }
    });

    it('fails closed in production when the Supabase server credential is missing', async () => {
      const originalEnv = {
        nodeEnv: process.env.NODE_ENV,
        url: process.env.VITE_SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        serviceKeyAlias: process.env.SUPABASE_SERVICE_KEY,
      };
      process.env.NODE_ENV = 'production';
      process.env.VITE_SUPABASE_URL = 'https://project.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SERVICE_KEY;
      vi.resetModules();

      try {
        const { authenticateServerRequest } = await vi.importActual<
          typeof import('../../api/_lib/supabaseServer')
        >('../../api/_lib/supabaseServer');
        const { createSignedSessionToken } = await import('../../api/_lib/sessionServer');
        const token = createSignedSessionToken({
          userId: telecaller.user_id,
          profileId: telecaller.id,
          organizationId: orgA,
          role: 'TELECALLER',
          fullName: telecaller.full_name,
          email: '',
          status: 'ACTIVE',
        });
        const result = await authenticateServerRequest({
          headers: { authorization: `Bearer ${token}` },
        });

        expect(result.user).toBeNull();
        expect(result.profile).toBeNull();
        expect(result.error).toMatch(/authentication is unavailable/i);
      } finally {
        if (originalEnv.nodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalEnv.nodeEnv;
        }
        if (originalEnv.url === undefined) {
          delete process.env.VITE_SUPABASE_URL;
        } else {
          process.env.VITE_SUPABASE_URL = originalEnv.url;
        }
        if (originalEnv.serviceKey === undefined) {
          delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        } else {
          process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.serviceKey;
        }
        if (originalEnv.serviceKeyAlias === undefined) {
          delete process.env.SUPABASE_SERVICE_KEY;
        } else {
          process.env.SUPABASE_SERVICE_KEY = originalEnv.serviceKeyAlias;
        }
        vi.resetModules();
      }
    });

    it('adds database guards for raw lead reads, inactive view/RPC access, and phone sanitization', () => {
      const migration = fs.readFileSync(
        path.resolve(process.cwd(), 'supabase/migrations/20261021000000_phase23_7_production_blocker_remediation.sql'),
        'utf8'
      );
      expect(migration).toMatch(/AS RESTRICTIVE\s+FOR SELECT\s+TO authenticated\s+USING \(public\.get_auth_role\(\) <> 'TELECALLER'\)/i);
      expect(migration).toMatch(/p\.role = 'TELECALLER'\s+AND p\.status = 'ACTIVE'/i);
      expect(migration).toMatch(/caller_profile\.status <> 'ACTIVE'/i);
      expect(migration).toMatch(/l\.neet_score::TEXT ~ '\[0-9\]\{5,\}'/i);
      expect(migration).toMatch(/item\.value::TEXT ~ '\[0-9\]\{5,\}'/i);
      expect(migration).toMatch(/REGEXP_REPLACE\(item\.value #>> '\{\}', '\[0-9\]'/i);
      expect(migration).not.toMatch(/(?:DROP|CREATE) POLICY[^;]*ON storage\.objects/is);
      expect(migration).toMatch(
        /OLD\.user_id = auth\.uid\(\)\s+AND OLD\.status IS DISTINCT FROM 'ACTIVE'\s+AND NEW\.status = 'ACTIVE'/i
      );
    });
  });

  describe('recording access', () => {
    it('does not create audio when the authorized endpoint denies access', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'Forbidden' }),
        })
      );
      const createAudio = vi.fn(() => document.createElement('audio'));

      await expect(recordingService.createAuthorizedAudio(call.id, createAudio)).rejects.toThrow('Forbidden');
      expect(createAudio).not.toHaveBeenCalled();
    });

    it('does not create audio when signed-URL retrieval fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
      const createAudio = vi.fn(() => document.createElement('audio'));

      await expect(recordingService.createAuthorizedAudio(call.id, createAudio)).rejects.toThrow(
        'Network unavailable'
      );
      expect(createAudio).not.toHaveBeenCalled();
    });

    it('rejects legacy provider and stored HTTP URLs before creating audio', async () => {
      const createAudio = vi.fn(() => document.createElement('audio'));
      for (const recordingUrl of [
        'https://api.twilio.com/recording.mp3',
        'https://storage.example/legacy.mp3',
      ]) {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ recordingUrl, expiresIn: 60 }),
          })
        );
        await expect(recordingService.createAuthorizedAudio(call.id, createAudio)).rejects.toThrow();
      }

      expect(createAudio).not.toHaveBeenCalled();
    });

    it('creates playback audio only from the signed URL returned by the authorized endpoint', async () => {
      const signedUrl = 'https://project.supabase.co/storage/v1/object/sign/call-recordings/path.mp3?token=signed';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ recordingUrl: signedUrl, expiresIn: 60 }),
        })
      );
      const audio = document.createElement('audio');
      const createAudio = vi.fn(() => audio);

      await expect(recordingService.createAuthorizedAudio(call.id, createAudio)).resolves.toBe(audio);
      expect(createAudio).toHaveBeenCalledWith(signedUrl);
    });

    it('keeps both call pages on the authorized endpoint without stored-URL fallbacks', () => {
      for (const pagePath of [
        'src/pages/owner/OwnerCallsPage.tsx',
        'src/pages/telecaller/TelecallerCallsPage.tsx',
      ]) {
        const page = fs.readFileSync(path.resolve(process.cwd(), pagePath), 'utf8');
        const handlerStart = page.indexOf('const handlePlayRecording');
        const handlerEnd = page.indexOf('\n  };', handlerStart);
        const handler = page.slice(handlerStart, handlerEnd);

        expect(handler).toContain('recordingService.createAuthorizedAudio(call.id)');
        expect(handler).not.toMatch(/call\.recording_url|new Audio\(|fetchRecordingSignedUrl/);
      }
    });

    it('rejects cross-tenant owners and telecallers who did not initiate the call', async () => {
      serverMocks.authenticateServerRequest.mockResolvedValueOnce({
        user: { id: ownerB.user_id },
        profile: ownerB,
        error: null,
      });
      const crossTenant = request(call.id);
      serverMocks.getSupabaseServerClient.mockReturnValueOnce(createRecordingSupabase());
      await recordingHandler(crossTenant.req, crossTenant.res);
      expect(crossTenant.res.statusCode).toBe(403);

      serverMocks.authenticateServerRequest.mockResolvedValueOnce({
        user: { id: ownerA.user_id },
        profile: { ...ownerA, role: 'TELECALLER' },
        error: null,
      });
      const otherCaller = request(call.id);
      serverMocks.getSupabaseServerClient.mockReturnValueOnce(createRecordingSupabase());
      await recordingHandler(otherCaller.req, otherCaller.res);
      expect(otherCaller.res.statusCode).toBe(403);
    });

    it('returns not found for malformed call paths and missing bucket/signing failures', async () => {
      serverMocks.getSupabaseServerClient.mockReturnValueOnce(createRecordingSupabase({ callData: null }));
      const malformed = request('../../unexpected.mp3');
      await recordingHandler(malformed.req, malformed.res);
      expect(malformed.res.statusCode).toBe(404);

      serverMocks.getSupabaseServerClient.mockReturnValueOnce(
        createRecordingSupabase({ signedResult: { data: null, error: { message: 'Bucket not found' } } })
      );
      const missingBucket = request(call.id);
      await recordingHandler(missingBucket.req, missingBucket.res);
      expect(missingBucket.res.statusCode).toBe(404);
      expect(missingBucket.res.body.recordingUrl).toBeUndefined();

      serverMocks.getSupabaseServerClient.mockReturnValueOnce(
        createRecordingSupabase({ signedResult: { data: null, error: null } })
      );
      const signFailure = request(call.id);
      await recordingHandler(signFailure.req, signFailure.res);
      expect(signFailure.res.statusCode).toBe(404);
      expect(signFailure.res.body.recordingUrl).toBeUndefined();
    });
  });

  it('documents private bucket settings and only scoped client SELECT access', () => {
    const setup = fs.readFileSync(path.resolve(process.cwd(), 'docs/RECORDING_STORAGE_SETUP.md'), 'utf8');
    expect(setup).toContain('52428800');
    expect(setup).toContain('public.can_access_call_recording_path(name)');
    expect(setup).toMatch(/Do \*\*not\*\* add client INSERT, UPDATE, or DELETE policies/);
    expect(setup).toMatch(/service-role key in browser code/i);
  });
});
