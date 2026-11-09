import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { currencySchema, isConfigKey, ROLES, type Role, usernameSchema } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import { createNotice } from './admin/communication';
import { writeAudit } from './audit';
import { UsernameTakenError, findAccountByUsername, registerAccount } from './auth/accounts';
import { AccountNotFoundError, issueResetCode } from './auth/recovery';
import { revokeAllSessions, rolesOf } from './auth/sessions';
import { encryptSecret, newTotpSecret } from './auth/totp';
import { createConfigService } from './config/service';
import type { DB } from './db/schema';
import { inTransaction } from './db/tx';
import { credit, debit } from './economy/wallet';
import { HttpError } from './errors';
import type { Env } from './env';
import { closeDue } from './season/close';
import { seasonConfigs } from './season/service';

export type CliDeps = { db: Kysely<DB>; env: Env; out: (s: string) => void };

const USAGE = [
  'Uso:',
  '  create-admin <usuario> [--role superadmin|admin|moderator] [--json]',
  '  issue-reset-code <usuario>',
  '  reset-totp <usuario> [--json]',
  '  grant <usuario> <moneda> <cantidad> --reason <motivo>',
  '  publish-config <clave> <archivo.json | -> --reason <motivo>',
  '  notice <texto> [--tone info|warning] [--days N] --reason <motivo>',
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
      // Staff start without the guided tour (polish phase 3); Ajustes can still repeat it.
      await trx.insertInto('galaxy.tutorial').values({ account_id: id, chapter: 'hub', skipped_at: new Date() }).execute();
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

/** The value after `--flag`, if any. */
const flag = (args: string[], name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1]?.trim() : undefined;
};
/** The arguments that are neither flags nor their values. */
const positional = (args: string[], flags: string[]) => args.filter((a, i) => !a.startsWith('--') && !flags.some((f) => args[i - 1] === f));

/**
 * `publish-config <clave> <archivo.json | -> --reason <motivo>` (open beta launch): publishes a key of the live config
 * from a JSON file (or stdin), validated like the panel's (the fields it names merged onto what is live), audited as
 * «cli». With no admin account (after the wipe), this is how the launch config goes live. A new season id archives
 * the season it replaces, like the panel does.
 */
async function publishConfig(args: string[], deps: CliDeps): Promise<number> {
  const reason = flag(args, '--reason');
  const [key, source] = positional(args, ['--reason']);
  if (!key || !source || !reason || reason.length < 3) return usage(deps.out, 'Uso: publish-config <clave> <archivo.json | -> --reason <motivo de 3 caracteres o más>');
  if (!isConfigKey(key)) {
    deps.out(`Clave desconocida: ${key}`);
    return 1;
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(source === '-' ? 0 : source, 'utf8'));
  } catch (err) {
    deps.out(`No se pudo leer el JSON de ${source}: ${(err as Error).message}`);
    return 1;
  }
  const config = createConfigService(deps.db);
  const before = key === 'season' ? await seasonConfigs(config) : null;
  try {
    const { version } = await config.publish(key, data as never, CLI_ACTOR, reason);
    if (before && (await config.get('season')).id !== before.season.id) await closeDue(deps.db, before, new Date(), { force: true });
    deps.out(`Publicado ${key} v${version}`);
    return 0;
  } catch (err) {
    if (err instanceof HttpError && err.code === 'config_invalid') {
      const issues = (err.details?.issues ?? []) as { path: string; message: string }[];
      deps.out(`La configuración de ${key} no es válida:`);
      for (const i of issues) deps.out(`  ${i.path || '(raíz)'}: ${i.message}`);
      return 1;
    }
    throw err;
  }
}

/** `notice <texto> [--tone info|warning] [--days N] --reason <motivo>`: a title-screen notice from now, audited. */
async function notice(args: string[], deps: CliDeps): Promise<number> {
  const reason = flag(args, '--reason');
  const tone = flag(args, '--tone') ?? 'info';
  const days = Number(flag(args, '--days') ?? '7');
  const [text] = positional(args, ['--reason', '--tone', '--days']);
  if (!text?.trim() || text.length > 200 || !reason || reason.length < 3 || (tone !== 'info' && tone !== 'warning') || !Number.isInteger(days) || days < 1 || days > 365) {
    return usage(deps.out, 'Uso: notice <texto de 1 a 200 caracteres> [--tone info|warning] [--days 1-365] --reason <motivo>');
  }
  const now = new Date();
  const { id } = await createNotice({ db: deps.db, config: createConfigService(deps.db), now: () => now }, CLI_ACTOR, {
    text: text.trim(),
    tone,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    reason,
  });
  deps.out(`Aviso ${id} publicado durante ${days} días`);
  return 0;
}

/** Container CLI (GDD §18.2): `node dist/cli.js <command> …`. Returns the process exit code. */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  if (command === 'create-admin') return createAdmin(args, deps);
  if (command === 'issue-reset-code') return issueCode(args, deps);
  if (command === 'reset-totp') return resetTotp(args, deps);
  if (command === 'grant') return grant(args, deps);
  if (command === 'publish-config') return publishConfig(args, deps);
  if (command === 'notice') return notice(args, deps);
  return usage(deps.out, command ? `Comando desconocido: ${command}` : undefined);
}
