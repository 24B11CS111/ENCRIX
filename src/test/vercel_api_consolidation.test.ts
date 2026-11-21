import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBillingAction } from '../../api/_lib/billingRouting.js';

const handlers = vi.hoisted(() => ({
  health: vi.fn(),
  refresh: vi.fn(),
  metrics: vi.fn(),
  notifications: vi.fn(),
}));

vi.mock('../../api/_lib/publicRoutes/health.js', () => ({ default: handlers.health }));
vi.mock('../../api/_lib/publicRoutes/realtimeRefresh.js', () => ({ default: handlers.refresh }));
vi.mock('../../api/_lib/publicRoutes/metrics.js', () => ({ default: handlers.metrics }));
vi.mock('../../api/_lib/publicRoutes/notifications.js', () => ({ default: handlers.notifications }));

import monitorHandler from '../../api/monitor';
import workspaceHandler from '../../api/workspace';

function response() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

function routeConfig() {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    routes: Array<{ src: string; dest: string; transforms?: Array<any> }>;
  };
}

describe('Vercel shared API dispatchers', () => {
  afterEach(() => vi.resetAllMocks());

  it.each([
    ['/api/health', '/api/monitor', 'health'],
    ['/api/realtime/refresh', '/api/monitor', 'realtime-refresh'],
    ['/api/metrics', '/api/workspace', 'metrics'],
    ['/api/notifications', '/api/workspace', 'notifications'],
  ])('keeps %s mapped to its fixed dispatcher action', (source, destination, action) => {
    const route = routeConfig().routes.find((candidate) => candidate.src === source);
    expect(route?.dest).toBe(destination);
    expect(route?.transforms).toContainEqual({
      type: 'request.query',
      op: 'set',
      target: { key: '__encrix_route' },
      args: action,
    });
  });

  it('dispatches health without changing liveness/readiness query values or response behavior', async () => {
    const req = { method: 'GET', query: { __encrix_route: 'health', probe: 'ready', custom: 'kept' }, body: { untouched: true } };
    const res = response();
    handlers.health.mockImplementation(async (forwardedReq: any, forwardedRes: any) => {
      expect(forwardedReq.query).toEqual({ probe: 'ready', custom: 'kept' });
      expect(forwardedReq.body).toBe(req.body);
      forwardedRes.status(503).json({ live: true, ready: false, status: 'degraded' });
      return 'health-result';
    });

    await expect(monitorHandler(req, res)).resolves.toBe('health-result');
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ live: true, ready: false, status: 'degraded' });
  });

  it('dispatches realtime refresh with its authorization header and query untouched', async () => {
    const req = { method: 'GET', headers: { authorization: 'Bearer session' }, query: { __encrix_route: 'realtime-refresh', cursor: '7' }, body: undefined };
    const res = response();
    handlers.refresh.mockImplementation(async (forwardedReq: any, forwardedRes: any) => {
      expect(forwardedReq.headers).toBe(req.headers);
      expect(forwardedReq.query).toEqual({ cursor: '7' });
      forwardedRes.status(401).json({ error: 'Unauthorized' });
    });

    await monitorHandler(req, res);
    expect(handlers.refresh).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('dispatches metrics and notifications independently while preserving method and body', async () => {
    const metricsReq = { method: 'GET', query: { __encrix_route: 'metrics', filter: 'today' }, body: undefined };
    const metricsRes = response();
    handlers.metrics.mockImplementation(async (req: any) => {
      expect(req.method).toBe('GET');
      expect(req.query).toEqual({ filter: 'today' });
      return 'metrics-result';
    });
    await expect(workspaceHandler(metricsReq, metricsRes)).resolves.toBe('metrics-result');

    const body = { id: 'notification-id' };
    const notificationReq = { method: 'PATCH', query: { __encrix_route: 'notifications', view: 'inbox' }, body };
    const notificationRes = response();
    handlers.notifications.mockImplementation(async (req: any) => {
      expect(req.method).toBe('PATCH');
      expect(req.query).toEqual({ view: 'inbox' });
      expect(req.body).toBe(body);
      return 'notifications-result';
    });
    await expect(workspaceHandler(notificationReq, notificationRes)).resolves.toBe('notifications-result');
  });

  it('forwards entitlement and authorization responses without changing status or body', async () => {
    const metricsRes = response();
    handlers.metrics.mockImplementation(async (_req: any, res: any) => {
      res.status(402).json({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });
    });
    await workspaceHandler({ method: 'GET', query: { __encrix_route: 'metrics' } }, metricsRes);
    expect(metricsRes.statusCode).toBe(402);
    expect(metricsRes.body).toEqual({ error: 'ACTIVE_SUBSCRIPTION_REQUIRED' });

    const notificationRes = response();
    handlers.notifications.mockImplementation(async (_req: any, res: any) => {
      res.status(404).json({ error: 'Recipient user not found in organization.' });
    });
    await workspaceHandler({ method: 'POST', query: { __encrix_route: 'notifications' }, body: { userId: 'cross-org' } }, notificationRes);
    expect(notificationRes.statusCode).toBe(404);
    expect(notificationRes.body).toEqual({ error: 'Recipient user not found in organization.' });
  });

  it.each([
    [monitorHandler, { __encrix_route: 'unknown' }],
    [monitorHandler, { __encrix_route: ['health', 'realtime-refresh'] }],
    [workspaceHandler, { __encrix_route: 'health' }],
  ])('rejects unknown, ambiguous, or cross-dispatch route selectors', async (handler, query) => {
    const res = response();
    await handler({ method: 'POST', query }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
    expect(handlers.health).not.toHaveBeenCalled();
    expect(handlers.refresh).not.toHaveBeenCalled();
    expect(handlers.metrics).not.toHaveBeenCalled();
    expect(handlers.notifications).not.toHaveBeenCalled();
  });

  it('does not let an application query parameter override the rewrite-selected handler', async () => {
    const res = response();
    await workspaceHandler({ method: 'GET', query: { __encrix_route: 'notifications', _route: 'metrics' } }, res);
    expect(handlers.notifications).toHaveBeenCalledOnce();
    expect(handlers.metrics).not.toHaveBeenCalled();
  });

  it('routes pilot entitlements through the existing billing function to preserve the 12-function limit', () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as { rewrites: Array<{ source: string; destination: string }> };
    expect(vercel.rewrites).toContainEqual({ source: '/api/pilot-entitlements', destination: '/api/billing?_route=pilot-entitlements' });
    expect(resolveBillingAction('pilot-entitlements')).toBe('pilot-entitlements');
  });

  it('keeps the Vercel-eligible TypeScript function inventory at exactly twelve', () => {
    const apiRoot = resolve(process.cwd(), 'api');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        if (entry.startsWith('_') || entry.startsWith('.')) continue;
        const fullPath = resolve(directory, entry);
        if (statSync(fullPath).isDirectory()) visit(fullPath);
        else if (fullPath.endsWith('.ts') && !fullPath.endsWith('.d.ts')) files.push(fullPath);
      }
    };
    visit(apiRoot);
    expect(files).toHaveLength(12);
  });
});
