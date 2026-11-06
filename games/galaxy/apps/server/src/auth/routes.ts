import { type LoginResponse, type MeResponse, loginInput, registerInput } from '@galaxy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { UsernameReservedError, UsernameTakenError, findAccountByUsername, registerAccount } from './accounts';
import { clearSessionCookie, requireSession, setSessionCookie } from './guards';
import { DUMMY_HASH, verifyPassword } from './password';
import { createSession, revokeSession, rolesOf } from './sessions';

export type AuthDeps = { env: Env; db: Kysely<DB>; config: ConfigReader; now: () => Date };

const DAY = 24 * 3600;
const TEN_MIN = 600;
const HOUR = 3600;

export function userAgent(req: FastifyRequest): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : '';
}

/** Opens a session, sets the cookie and returns the profile. */
export async function startSession(
  deps: AuthDeps,
  req: FastifyRequest,
  reply: FastifyReply,
  account: { id: string; username: string },
  opts: { mfa: boolean; ttlSec: number },
): Promise<MeResponse> {
  const token = await createSession(deps.db, account.id, {
    ip: clientIp(req, deps.env.TRUST_CF_IP),
    userAgent: userAgent(req),
    mfa: opts.mfa,
    ttlMs: opts.ttlSec * 1000,
  });
  setSessionCookie(reply, token, opts.ttlSec);
  return { id: account.id, username: account.username, roles: await rolesOf(deps.db, account.id), mfa: opts.mfa };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { db } = deps;

  app.post('/galaxy/api/auth/register', async (req, reply) => {
    const input = registerInput.parse(req.body);
    const auth = await deps.config.get('auth');
    await hitRateLimit(db, `ip:${clientIp(req, deps.env.TRUST_CF_IP)}`, 'register', auth.registerPerIpHour, HOUR);
    let id: string;
    try {
      ({ id } = await registerAccount(db, input));
    } catch (err) {
      if (err instanceof UsernameTakenError) throw new HttpError(409, 'username_taken');
      if (err instanceof UsernameReservedError) throw new HttpError(409, 'username_reserved');
      throw err;
    }
    const me = await startSession(deps, req, reply, { id, username: input.username }, {
      mfa: false,
      ttlSec: auth.sessionDays * DAY,
    });
    return reply.code(201).send(me);
  });

  app.post('/galaxy/api/auth/login', async (req, reply): Promise<LoginResponse> => {
    const { username, password } = loginInput.parse(req.body);
    const auth = await deps.config.get('auth');
    await hitRateLimit(db, `ip:${clientIp(req, deps.env.TRUST_CF_IP)}`, 'login_ip', auth.loginPerIpTenMin, TEN_MIN);
    await hitRateLimit(db, `u:${username}`, 'login_user', auth.loginPerUserTenMin, TEN_MIN);

    const account = await findAccountByUsername(db, username);
    // Always pay for one argon2 verification, so an unknown username costs as much as a wrong password.
    const ok = await verifyPassword(account?.password_hash ?? DUMMY_HASH, password);
    if (!account || !ok) throw new HttpError(401, 'invalid_credentials');
    if (account.banned_until && account.banned_until > deps.now()) throw new HttpError(403, 'banned');

    const me = await startSession(deps, req, reply, account, { mfa: false, ttlSec: auth.sessionDays * DAY });
    return { status: 'ok', me };
  });

  app.post('/galaxy/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await revokeSession(db, req.sessionToken);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/galaxy/api/auth/me', async (req): Promise<MeResponse> => {
    const s = requireSession(req);
    return { id: s.accountId, username: s.username, roles: s.roles, mfa: s.mfa };
  });
}
