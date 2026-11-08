import type { FastifyRequest } from 'fastify';
import { describe, expect, test } from 'vitest';
import { requireAdmin, requireStaff } from '../../src/auth/guards';
import type { SessionInfo } from '../../src/auth/sessions';

// Who reaches the panel (GDD §16.1; M6c-1): staff (moderator, admin, superadmin) signed in with TOTP reach moderation;
// only admins and superadmins reach the rest. Anyone else gets 403, and nobody without a session gets past 401.

const req = (s: Partial<SessionInfo> | null) =>
  ({ session: s ? { sessionId: 's', accountId: 'a', username: 'u', roles: [], mfa: false, ...s } : null }) as unknown as FastifyRequest;
const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (err) {
    return (err as { status: number }).status;
  }
};

describe('requireStaff', () => {
  test('moderadores, admins y superadmins con TOTP pasan', () => {
    for (const role of ['moderator', 'admin', 'superadmin'] as const) expect(status(() => requireStaff(req({ roles: [role], mfa: true })))).toBe(200);
  });

  test('sin TOTP, sin rol o sin sesión no pasan', () => {
    expect(status(() => requireStaff(req({ roles: ['moderator'], mfa: false })))).toBe(403);
    expect(status(() => requireStaff(req({ roles: [], mfa: true })))).toBe(403);
    expect(status(() => requireStaff(req(null)))).toBe(401);
  });

  test('un moderador sigue sin ser admin', () => {
    expect(status(() => requireAdmin(req({ roles: ['moderator'], mfa: true })))).toBe(403);
  });
});
