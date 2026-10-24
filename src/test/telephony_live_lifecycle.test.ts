import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  profile: null as any,
}));

vi.mock('../../api/_lib/supabaseServer.js', () => ({
  authenticateServerRequest: vi.fn(async () => ({
    user: { id: authState.profile?.user_id || 'test-user' },
    profile: authState.profile,
    error: authState.profile ? null : 'Unauthorized',
  })),
  isRealSupabaseServerConfigured: () => false,
  getSupabaseServerClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

import callHandler from '../../api/telephony/call';
import { db } from '@/services/supabase/db';

const orgId = 'org-telephony-test';
const otherOrgId = 'org-other-test';
const leadId = '10000000-0000-4000-8000-000000000001';
const callId = '20000000-0000-4000-8000-000000000001';
const callSid = `CA${'a'.repeat(32)}`;

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'telecaller-1',
    user_id: 'user-1',
    organization_id: orgId,
    full_name: 'Test Telecaller',
    role: 'TELECALLER',
    status: 'ACTIVE',
    ...overrides,
  };
}

function request(method: string, options: { body?: unknown; query?: Record<string, string> } = {}) {
  const req = {
    method,
    headers: { authorization: 'Bearer synthetic-token' },
    body: options.body || {},
    query: options.query || {},
  };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this.body = data; return this; },
  };
  return { req, res };
}

function seedCall(overrides: Record<string, unknown> = {}) {
  const caller = profile();
  authState.profile = caller;
  (db as any).leads = [{
    id: leadId,
    organization_id: orgId,
    assigned_to: caller.id,
    name: 'Synthetic Lead',
    phone: '+15550001111',
  }];
  (db as any).calls = [{
    id: callId,
    organization_id: orgId,
    lead_id: leadId,
    telecaller_id: caller.id,
    provider: 'TWILIO',
    provider_call_id: callSid,
    status: 'IN_PROGRESS',
    duration_seconds: 0,
    started_at: '2026-10-23T00:00:00.000Z',
    ended_at: null,
    recording_url: null,
    ...overrides,
  }];
  return caller;
}

beforeEach(() => {
  db.resetSandbox();
  vi.stubEnv('TWILIO_ACCOUNT_SID', `AC${'b'.repeat(32)}`);
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'synthetic-auth-credential-abcdef');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  authState.profile = null;
});

describe('authenticated live call lifecycle API', () => {
  it('requires an authenticated active caller for status and end actions', async () => {
    seedCall();
    authState.profile = null;
    const status = request('GET', { query: { callId } });
    await callHandler(status.req, status.res);
    expect(status.res.statusCode).toBe(401);

    const end = request('POST', { body: { action: 'end', callId } });
    await callHandler(end.req, end.res);
    expect(end.res.statusCode).toBe(401);

    authState.profile = profile({ status: 'SUSPENDED' });
    const inactive = request('GET', { query: { callId } });
    await callHandler(inactive.req, inactive.res);
    expect(inactive.res.statusCode).toBe(403);
  });

  it('hides cross-tenant, unassigned, and malformed call IDs as not found', async () => {
    seedCall({ organization_id: otherOrgId });
    const crossTenant = request('GET', { query: { callId } });
    await callHandler(crossTenant.req, crossTenant.res);
    expect(crossTenant.res.statusCode).toBe(404);

    seedCall({ telecaller_id: 'another-caller' });
    const unassignedCall = request('GET', { query: { callId } });
    await callHandler(unassignedCall.req, unassignedCall.res);
    expect(unassignedCall.res.statusCode).toBe(404);

    seedCall();
    const malformed = request('POST', { body: { action: 'end', callId: 'not-a-uuid' } });
    await callHandler(malformed.req, malformed.res);
    expect(malformed.res.statusCode).toBe(404);
  });

  it('returns only persisted, non-sensitive call status', async () => {
    seedCall({ status: 'IN_PROGRESS', duration_seconds: 9 });
    const status = request('GET', { query: { callId } });
    await callHandler(status.req, status.res);

    expect(status.res.statusCode).toBe(200);
    expect(status.res.body).toEqual({
      callId,
      status: 'IN_PROGRESS',
      durationSeconds: 9,
      startedAt: '2026-10-23T00:00:00.000Z',
      endedAt: null,
    });
    expect(JSON.stringify(status.res.body)).not.toContain('+15550001111');
    expect(JSON.stringify(status.res.body)).not.toContain(callSid);
    expect(JSON.stringify(status.res.body)).not.toContain('recording_url');
  });

  it('treats end acknowledgements as pending and leaves status persistence to verified webhooks', async () => {
    seedCall();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'in-progress' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed', duration: '42' }) });
    vi.stubGlobal('fetch', fetchMock);

    const end = request('POST', { body: { action: 'end', callId } });
    await callHandler(end.req, end.res);
    expect(end.res.statusCode).toBe(202);
    expect(end.res.body).toEqual({ callId, accepted: true, status: 'IN_PROGRESS' });
    expect((db as any).calls[0].status).toBe('IN_PROGRESS');

    const repeatedEnd = request('POST', { body: { action: 'end', callId } });
    await callHandler(repeatedEnd.req, repeatedEnd.res);
    expect(repeatedEnd.res.statusCode).toBe(202);
    expect(repeatedEnd.res.body).toEqual({ callId, accepted: false, status: 'IN_PROGRESS' });
    expect((db as any).calls[0]).toMatchObject({ status: 'IN_PROGRESS', duration_seconds: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(end.res.body)).not.toContain(callSid);
    expect(JSON.stringify(end.res.body)).not.toContain('synthetic-secret');
  });

  it('does not call Twilio for an already completed persisted call', async () => {
    seedCall({ status: 'COMPLETED', duration_seconds: 30 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const end = request('POST', { body: { action: 'end', callId } });
    await callHandler(end.req, end.res);
    expect(end.res.statusCode).toBe(200);
    expect(end.res.body).toEqual({ callId, accepted: false, status: 'COMPLETED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed instead of placing a customer-only call when the secure bridge is unavailable', async () => {
    const caller = profile({ phone_verified: false });
    authState.profile = caller;
    (db as any).leads = [{
      id: leadId,
      organization_id: orgId,
      assigned_to: caller.id,
      name: 'Synthetic Lead',
      phone: '+15550001111',
      lead_code: 'SYN-1',
      status: 'ASSIGNED',
    }];
    const callCountBefore = (db as any).calls.length;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const start = request('POST', { body: { leadId } });
    await callHandler(start.req, start.res);

    expect(start.res.statusCode).toBe(503);
    expect(start.res.body.error).toMatch(/secure call bridge/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(start.res.body)).not.toContain('+15550001111');
    expect((db as any).calls).toHaveLength(callCountBefore);
  });
});
