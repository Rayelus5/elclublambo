import { randomInt } from 'node:crypto';
import { ROLES, type Role, usernameSchema } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import { writeAudit } from './audit';
import { UsernameTakenError, registerAccount } from './auth/accounts';
import { AccountNotFoundError, issueResetCode } from './auth/recovery';
import { encryptSecret, newTotpSecret } from './auth/totp';
import type { DB } from './db/schema';
import { inTransaction } from './db/tx';
import type { Env } from './env';

export type CliDeps = { db: Kysely<DB>; env: Env; out: (s: string) => void };

const USAGE = [
  'Uso:',
  '  create-admin <usuario> [--role superadmin|admin|moderator] [--json]',
  '  issue-reset-code <usuario>',
].join('\n');

const CLI_ACTOR = { id: null, label: 'cli' };
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomPassword(length = 20): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');
}

function usage(out: CliDeps['out'], problem?: string): number {
  if (problem) out(problem);
  out(USAGE);
  return 1;
}

async function createAdmin(args: string[], deps: CliDeps): Promise<number> {
  const json = args.includes('--json');
  const roleIdx = args.indexOf('--role');
  const role = (roleIdx >= 0 ? args[roleIdx + 1] : 'admin') as Role;
  const name = args.find((a, i) => !a.startsWith('--') && (roleIdx < 0 || i !== roleIdx + 1));
  if (!name) return usage(deps.out, 'Falta el usuario');
  const parsed = usernameSchema.safeParse(name);
  if (!parsed.success) return usage(deps.out, `Usuario no válido: ${name}`);
  if (!ROLES.includes(role)) return usage(deps.out, `Rol no válido: ${String(role)}`);

  const username = parsed.data;
  const password = randomPassword();
  const totp = newTotpSecret();
  try {
    await inTransaction(deps.db, async (trx) => {
      const { id } = await registerAccount(trx, { username, password }, { allowReserved: true });
      await trx.insertInto('galaxy.account_roles').values({ account_id: id, role }).execute();
      await trx
        .insertInto('galaxy.admin_totp')
        .values({ account_id: id, secret_enc: encryptSecret(deps.env.GALAXY_TOTP_KEY, totp.base32) })
        .execute();
      await writeAudit(trx, {
        actor: CLI_ACTOR,
        action: 'account.admin_created',
        targetType: 'account',
        targetId: id,
        after: { username, role },
        reason: 'create-admin desde el contenedor',
      });
    });
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      deps.out(`La cuenta ${username} ya existe: no se ha tocado`);
      return 1;
    }
    throw err;
  }

  const result = { username, password, totpSecret: totp.base32, totpUri: totp.uri(username) };
  if (json) {
    deps.out(JSON.stringify(result));
  } else {
    deps.out(
      [
        `Cuenta ${role} creada: ${username}`,
        `Contraseña (cámbiala al entrar): ${password}`,
        `Secreto TOTP: ${totp.base32}`,
        `URI para tu app de autenticación: ${result.totpUri}`,
        'Esta es la única vez que se muestran.',
      ].join('\n'),
    );
  }
  return 0;
}

async function issueCode(args: string[], deps: CliDeps): Promise<number> {
  const name = args[0];
  if (!name) return usage(deps.out, 'Falta el usuario');
  try {
    const code = await issueResetCode(deps.db, name, CLI_ACTOR);
    deps.out(`Código de recuperación para ${name.toLowerCase()} (24 h, un solo uso): ${code}`);
    return 0;
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      deps.out(`No existe la cuenta ${name}`);
      return 1;
    }
    throw err;
  }
}

/** Container CLI (GDD §18.2): `node dist/cli.js <command> …`. Returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  if (command === 'create-admin') return createAdmin(args, deps);
  if (command === 'issue-reset-code') return issueCode(args, deps);
  return usage(deps.out, command ? `Comando desconocido: ${command}` : undefined);
}
