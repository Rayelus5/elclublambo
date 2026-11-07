import { randomInt } from 'node:crypto';
import { currencySchema, ROLES, type Role, usernameSchema } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import { writeAudit } from './audit';
import { UsernameTakenError, findAccountByUsername, registerAccount } from './auth/accounts';
import { AccountNotFoundError, issueResetCode } from './auth/recovery';
import { revokeAllSessions, rolesOf } from './auth/sessions';
import { encryptSecret, newTotpSecret } from './auth/totp';
import type { DB } from './db/schema';
import { inTransaction } from './db/tx';
import { credit, debit } from './economy/wallet';
import { HttpError } from './errors';
import type { Env } from './env';

export type CliDeps = { db: Kysely<DB>; env: Env; out: (s: string) => void };

const USAGE = [
  'Uso:',
  '  create-admin <usuario> [--role superadmin|admin|moderator] [--json]',
  '  issue-reset-code <usuario>',
  '  reset-totp <usuario> [--json]',
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
        `Contraseña (guárdala en tu gestor de contraseñas): ${password}`,
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

/**
 * New TOTP secret for a role holder who lost their authenticator (or after rotating GALAXY_TOTP_KEY): replaces the
 * secret, resets the used step, closes every session of the account and audits it. The secret is printed once.
 */
async function resetTotp(args: string[], deps: CliDeps): Promise<number> {
  const json = args.includes('--json');
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) return usage(deps.out, 'Falta el usuario');
  const account = await findAccountByUsername(deps.db, name);
  if (!account) {
    deps.out(`No existe la cuenta ${name}`);
    return 1;
  }
  if ((await rolesOf(deps.db, account.id)).length === 0) {
    deps.out(`La cuenta ${account.username} no tiene ningún rol: no usa TOTP`);
    return 1;
  }
  const totp = newTotpSecret();
  await inTransaction(deps.db, async (trx) => {
    const secret_enc = encryptSecret(deps.env.GALAXY_TOTP_KEY, totp.base32);
    await trx
      .insertInto('galaxy.admin_totp')
      .values({ account_id: account.id, secret_enc, last_used_step: 0 })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ secret_enc, last_used_step: 0 }))
      .execute();
    await revokeAllSessions(trx, account.id);
    await writeAudit(trx, {
      actor: CLI_ACTOR,
      action: 'account.totp_reset',
      targetType: 'account',
      targetId: account.id,
      after: { username: account.username },
      reason: 'reset-totp desde el contenedor',
    });
  });
  const result = { username: account.username, totpSecret: totp.base32, totpUri: totp.uri(account.username) };
  if (json) deps.out(JSON.stringify(result));
  else
    deps.out(
      [
        `TOTP renovado para ${account.username}. Sus sesiones abiertas se han cerrado`,
        `Secreto TOTP: ${totp.base32}`,
        `URI para tu app de autenticación: ${result.totpUri}`,
        'Esta es la única vez que se muestra.',
      ].join('\n'),
    );
  return 0;
}

/**
 * `grant <usuario> <moneda> <cantidad> --reason <texto>`: credits (or, with a negative amount, debits) a currency.
 * Until incursions pay (M3) this is how PRE testers get coins and signals. Audited; never below 0.
 */
async function grant(args: string[], deps: CliDeps): Promise<number> {
  const reasonAt = args.indexOf('--reason');
  const reason = reasonAt >= 0 ? args[reasonAt + 1]?.trim() : undefined;
  const [name, currency, amountText] = args.filter((a, i) => !a.startsWith('--') && i !== reasonAt + 1);
  const amount = Number(amountText);
  if (!name || !currency || !reason || !Number.isSafeInteger(amount) || amount === 0) {
    return usage(deps.out, 'Uso: grant <usuario> <moneda> <cantidad entera distinta de 0> --reason <motivo>');
  }
  if (!currencySchema.safeParse(currency).success) {
    deps.out(`Moneda desconocida: ${currency} (coins, dust, signal, signal:<grupo>, material o components)`);
    return 1;
  }
  const account = await findAccountByUsername(deps.db, name);
  if (!account) {
    deps.out(`No existe la cuenta ${name}`);
    return 1;
  }
  try {
    const balance = await inTransaction(deps.db, async (trx) => {
      const after =
        amount > 0
          ? await credit(trx, account.id, currency, amount, 'grant', { by: 'cli' })
          : await debit(trx, account.id, currency, -amount, 'grant', { by: 'cli' });
      await writeAudit(trx, {
        actor: CLI_ACTOR,
        action: 'wallet.grant',
        targetType: 'account',
        targetId: account.id,
        after: { currency, amount, balance: after },
        reason,
      });
      return after;
    });
    deps.out(`${account.username}: ${amount > 0 ? '+' : ''}${amount} ${currency} (saldo ${balance})`);
    return 0;
  } catch (err) {
    if (err instanceof HttpError && err.code === 'insufficient_funds') {
      deps.out(`${account.username} no tiene bastante ${currency} para restar ${-amount}`);
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
  if (command === 'reset-totp') return resetTotp(args, deps);
  if (command === 'grant') return grant(args, deps);
  return usage(deps.out, command ? `Comando desconocido: ${command}` : undefined);
}
