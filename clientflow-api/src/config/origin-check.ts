import type { NextFunction, Request, Response } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Session cookies are named clientflow_session / clientflow_refresh (with __Host- in production).
const SESSION_COOKIE = /(?:^|;\s*)(?:__Host-)?clientflow_(?:session|refresh)=/;

function originOf(request: Request): string | null {
  const origin = request.header('origin');
  if (origin && origin !== 'null') return origin;
  const referer = request.header('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Cross-site request forgery guard. A write that carries the staff session cookie must come from
 * the app's own site (an allowed CORS origin); another site can't use a signed-in browser to act.
 * Requests without the cookie (public form and contract links, server-to-server calls) and reads
 * are unaffected.
 */
export function sessionOriginCheck(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(request.method) || !SESSION_COOKIE.test(request.header('cookie') ?? '')) {
      next();
      return;
    }
    const origin = originOf(request);
    if (origin && allowed.has(origin)) {
      next();
      return;
    }
    response.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'This request did not come from ClientFlow.' },
    });
  };
}
