import metricsHandler from './_lib/publicRoutes/metrics.js';
import notificationsHandler from './_lib/publicRoutes/notifications.js';

const ROUTES = {
  metrics: metricsHandler,
  notifications: notificationsHandler,
} as const;

type WorkspaceRoute = keyof typeof ROUTES;

function resolveRoute(value: unknown): WorkspaceRoute | null {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(ROUTES, value)) {
    return null;
  }
  return value as WorkspaceRoute;
}

export default async function handler(req: any, res: any) {
  const route = resolveRoute(req.query?.__encrix_route);
  if (!route) return res.status(404).json({ error: 'Not Found' });

  // The route selector is an internal rewrite detail, not an application query parameter.
  // Strip it before calling the unchanged public handler.
  const query = { ...(req.query || {}) };
  delete query.__encrix_route;
  const forwardedReq = Object.create(req);
  Object.defineProperty(forwardedReq, 'query', { value: query, enumerable: true });
  return ROUTES[route](forwardedReq, res);
}
