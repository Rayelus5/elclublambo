import { type LoginResponse, type MeResponse, loginInput, registerInput, resetRedeemInput, totpInput } from '@galaxy/shared';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { clientIp } from '../security/client-ip';
import { UsernameReservedError, UsernameTakenError, findAccountByUsername, registerAccount } from './accounts';
import { consumeChallenge, createChallenge, peekChallenge } from './challenges';
import { clearSessionCookie, requireSession, setSessionCookie } from './guards';
import { DUMMY_HASH, verifyPassword } from './password';
import { InvalidResetCodeError, redeemResetCode } from './recovery';
import { createSession, revokeSession, rolesOf } from './sessions';
import { verifyTotp } from './totp';
import { accountLevel } from '../social/progress';
import { inTransaction } from '../db/tx';
import { onLevel, signUpWithCode } from '../referrals/service';

export type AuthDeps = { env: Env; db: Kysely<DB>; config: ConfigReader; now: () => Date; onLogout?: (sessionId: string) => void };

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
    if (!(await deps.config.get('features')).registrationOpen) throw new HttpError(403, 'registration_closed');
    // Referrals (plan «referidos»): a code may be required to sign up; one given must be usable, or no account is made.
    const referrals = await deps.config.get('referrals');
    if (referrals.required && !input.referralCode) throw new HttpError(400, 'referral_required');
    const auth = await deps.config.get('auth');
    const ip = clientIp(req, deps.env.TRUST_CF_IP);
    // Counted before the code is looked at: trying codes costs sign-up attempts too.
    await hitRateLimit(db, `ip:${ip}`, 'register', auth.registerPerIpHour, HOUR);
    let id: string;
    try {
      ({ id } = await inTransaction(db, async (trx) => {
        const made = await registerAccount(trx, input);
        if (input.referralCode) await signUpWithCode(trx, referrals, { id: made.id, ip: isIP(ip) ? ip : null, userAgent: userAgent(req) || null }, input.referralCode);
        return made;
      }));
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
    const ip = clientIp(req, deps.env.TRUST_CF_IP);
    await hitRateLimit(db, `ip:${ip}`, 'login_ip', auth.loginPerIpTenMin, TEN_MIN);
    // Per (user, IP): attempts against an account only lock the attacker's own address out, never the owner.
    await hitRateLimit(db, `u:${username}|ip:${ip}`, 'login_user_ip', auth.loginPerUserTenMin, TEN_MIN);
    // Per user, any IP: a ceiling of 10× for distributed guessing (argon2 + TOTP for staff do the rest).
    await hitRateLimit(db, `u:${username}`, 'login_user', auth.loginPerUserTenMin * 10, TEN_MIN);

    const account = await findAccountByUsername(db, username);
    // Always pay for one argon2 verification, so an unknown username costs as much as a wrong password.
    const ok = await verifyPassword(account?.password_hash ?? DUMMY_HASH, password);
    if (!account || !ok) throw new HttpError(401, 'invalid_credentials');
    if (account.banned_until && account.banned_until > deps.now()) throw new HttpError(403, 'banned');

    // Any role (superadmin, admin, moderator) needs the second factor before getting a session.
    if ((await rolesOf(db, account.id)).length > 0) {
      return { status: 'totp_required', challenge: await createChallenge(db, account.id) };
    }
    const me = await startSession(deps, req, reply, account, { mfa: false, ttlSec: auth.sessionDays * DAY });
    return { status: 'ok', me };
  });

  app.post('/galaxy/api/auth/totp', async (req, reply): Promise<MeResponse> => {
    const { challenge, code } = totpInput.parse(req.body);
    const auth = await deps.config.get('auth');
    const now = deps.now();
    const accountId = await peekChallenge(db, challenge, now);
    if (!accountId) throw new HttpError(401, 'challenge_expired');
    await hitRateLimit(db, `a:${accountId}`, 'totp', auth.totpPerAccountTenMin, TEN_MIN);
    if (!(await verifyTotp(db, deps.env.GALAXY_TOTP_KEY, accountId, code, now))) throw new HttpError(401, 'invalid_totp');
    if ((await consumeChallenge(db, challenge, now)) !== accountId) throw new HttpError(401, 'challenge_expired');
    const account = await db
      .selectFrom('galaxy.accounts')
      .select(['id', 'username', 'banned_until'])
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    if (account.banned_until && account.banned_until > now) throw new HttpError(403, 'banned');
    return startSession(deps, req, reply, account, { mfa: true, ttlSec: auth.adminSessionHours * HOUR });
  });

  app.post('/galaxy/api/auth/reset/redeem', async (req, reply) => {
    const input = resetRedeemInput.parse(req.body);
    const auth = await deps.config.get('auth');
    await hitRateLimit(db, `ip:${clientIp(req, deps.env.TRUST_CF_IP)}`, 'reset_redeem', auth.resetRedeemPerIpHour, HOUR);
    try {
      await redeemResetCode(db, input, deps.now());
    } catch (err) {
      if (err instanceof InvalidResetCodeError) throw new HttpError(400, 'invalid_reset_code');
      throw err;
    }
    return reply.code(204).send();
  });

  app.post('/galaxy/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await revokeSession(db, req.sessionToken);
    // The live sockets of this session close too (plan phase 3).
    if (req.session) deps.onLogout?.(req.session.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/galaxy/api/auth/me', async (req): Promise<MeResponse> => {
    const s = requireSession(req);
    // The account level (M5a) for the top bar.
    const [level, look, referrals] = await Promise.all([
      accountLevel(deps.db, s.accountId, await deps.config.get('account')),
      // Nov plan C2: the avatar and frame the top bar shows.
      deps.db.selectFrom('galaxy.accounts').select(['avatar', 'frame']).where('id', '=', s.accountId).executeTakeFirst(),
      deps.config.get('referrals'),
    ]);
    // A newcomer who came with a code: past the owner's level, the owner's gift goes out (once). The game reads the
    // account after every run, so this follows the level closely. A failure here never costs the player their page.
    await onLevel(deps.db, referrals, s.accountId, level).catch((err: unknown) => req.log.warn({ err }, 'referral activation failed'));
    return { id: s.accountId, username: s.username, roles: s.roles, mfa: s.mfa, level, avatar: look?.avatar ?? null, frame: look?.frame ?? null };
  });
}
