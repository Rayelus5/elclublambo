import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { type SessionInfo, readSession } from './sessions';

export const SESSION_COOKIE = 'gs_sid';

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionInfo | null;
    sessionToken: string | null;
  }
}

/** gs_sid: HttpOnly, Secure, SameSite=Strict, Path=/galaxy (GDD §18.2). */
const COOKIE_ATTRS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/galaxy' } as const;

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeSec: number): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRS, maxAge: maxAgeSec });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', { ...COOKIE_ATTRS, maxAge: 0, expires: new Date(0) });
}

/** Decorates every request with its session (or null) from the gs_sid cookie. */
export function registerSessionReader(app: FastifyInstance, db: Kysely<DB>, now: () => Date): void {
  app.decorateRequest('session', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('preHandler', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    req.sessionToken = token;
    req.session = await readSession(db, token, now());
  });
}

/** 401 unauthenticated without a live session (the error handler also clears the cookie). */
export function requireSession(req: FastifyRequest): SessionInfo {
  if (!req.session) throw new HttpError(401, 'unauthenticated');
  return req.session;
}

/** Admin powers need an admin role and a session opened with TOTP. */
export function requireAdmin(req: FastifyRequest): SessionInfo {
  const s = requireSession(req);
  if (!s.mfa || !s.roles.some((r) => r === 'admin' || r === 'superadmin')) throw new HttpError(403, 'forbidden');
  return s;
}
