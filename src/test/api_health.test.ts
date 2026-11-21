import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configured: true, dbError: null as unknown, dbClient: null as any }));
vi.mock('../../api/_lib/supabaseServer.js', () => ({
  isRealSupabaseServerConfigured: () => state.configured,
  getSupabaseServerClient: () => state.dbClient,
}));
vi.mock('../../api/_lib/serverSecret.js', () => ({
  getRequiredServerSecret: (name: string) => {
    if (!process.env[name] || process.env[name]!.length < 32) throw new Error('invalid');
    return process.env[name];
  },
}));
vi.mock('../../api/_lib/otpServer.js', () => ({ isLiveEmailConfigured: () => true }));

import handler from '../../api/_lib/publicRoutes/health';

function response() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader() {},
  };
}

describe('health endpoint', () => {
  const originalEnv = { ...process.env };
  const req = (probe?: string) => ({ method: 'GET', query: probe ? { probe } : {} });

  beforeEach(() => {
    process.env.OTP_SERVER_SECRET = 'a'.repeat(40);
    process.env.SESSION_SERVER_SECRET = 'b'.repeat(40);
    state.configured = true;
    state.dbClient = {
      from: () => ({ select: () => ({ limit: async () => ({ error: state.dbError }) }) }),
    };
    state.dbError = null;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  it('reports liveness without revealing dependency state', async () => {
    const res = response();
    await handler(req('live'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ live: true, ready: null, status: 'alive' });
  });

  it('reports degraded readiness when essential configuration is missing', async () => {
    state.configured = false;
    const res = response();
    await handler(req('ready'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ live: true, ready: false, status: 'degraded', checks: { application: 'ok', configuration: 'incomplete' } });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|key|password|url/i);
  });

  it('reports unavailable when the database dependency is unavailable', async () => {
    state.dbError = { message: 'private database details' };
    const res = response();
    await handler(req('ready'), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(JSON.stringify(res.body)).not.toContain('private database details');
  });

  it('reports ready when configuration and the database probe succeed', async () => {
    const res = response();
    await handler(req('ready'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ live: true, ready: true, status: 'healthy', checks: { application: 'ok', configuration: 'ready', database: 'available' } });
  });

  it('preserves the GET-only method contract', async () => {
    const res = response();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method Not Allowed' });
  });
});
