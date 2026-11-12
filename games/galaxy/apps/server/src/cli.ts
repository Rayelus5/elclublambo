import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type ConfigKey,
  type ConfigValue,
  configIssues,
  configSchemas,
  currencySchema,
  draftFromDefaults,
  isConfigKey,
  mergeDraft,
  opsProblems,
  parseConfig,
  PUBLISH_ORDER,
  ROLES,
  type Role,
  usernameSchema,
} from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
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
import { reconcileShop, unblockShop } from './shop/cli';
import type { ShopGateway } from './shop/gateway';
import { createStripeGateway } from './shop/stripe-gateway';
import { backfillCosmetics } from './cosmetics/backfill';
import { cosmeticsToGrant } from './cosmetics/everything';

/** `shopGateway`: the shop's payment gateway (tests pass a fake; by default Stripe's from the env). */
export type CliDeps = { db: Kysely<DB>; env: Env; out: (s: string) => void; shopGateway?: ShopGateway | null };

const USAGE = [
  'Uso:',
  '  create-admin <usuario> [--role superadmin|admin|moderator] [--json]',
  '  issue-reset-code <usuario>',
  '  reset-totp <usuario> [--json]',
  '  grant <usuario> <moneda> <cantidad> --reason <motivo>',
  '  publish-config <clave> <archivo.json | -> --reason <motivo>',
  '  publish-config <clave> <archivo.json | -> --dry-run',
  '  show-config <clave> [--data]',
  '  cosmetics-backfill',
  '  grant-cosmetics <usuario> --all|--shop --reason <motivo>',
  '  draft-config <clave> <campo[,campo…]> [--ids id,id…]',
  '  check-config <lote.json | ->',
  '  notice <texto> [--tone info|warning] [--days N] --reason <motivo>',
  '  shop-reconcile [--days N]',
  '  shop-unblock <usuario> --reason <motivo>',
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
 * the season it replaces, like the panel does. With `--dry-run` it only checks the draft over what is live and says
 * which top-level fields would change (and, in lists of things with ids, which ids come, go or change): nothing is
 * published or audited, so it needs no reason (the content skills check before every publish on PRE).
 */
async function publishConfig(args: string[], deps: CliDeps): Promise<number> {
  const dryRun = args.includes('--dry-run');
  const reason = flag(args, '--reason');
  const [key, source] = positional(args, ['--reason']);
  if (!key || !source || (!dryRun && (!reason || reason.length < 3))) {
    return usage(deps.out, 'Uso: publish-config <clave> <archivo.json | -> --reason <motivo de 3 caracteres o más> (o --dry-run para solo comprobarla)');
  }
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
  if (dryRun) return (await simulate(key, data, config, deps.out)) === null ? 1 : 0;
  if (!reason) return 1;
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

/**
 * A draft of `key` over what is live, without publishing: prints what does not validate, or which fields would change
 * and the version it would become. Returns the value it would leave live, or null when it does not validate.
 */
async function simulate(key: ConfigKey, draft: unknown, config: ReturnType<typeof createConfigService>, out: CliDeps['out']): Promise<unknown> {
  const live = await config.getVersioned(key);
  const merged = mergeDraft(key, live.value, draft);
  const issues = configIssues(key, merged);
  if (issues.length > 0) {
    out(`La configuración de ${key} no es válida:`);
    for (const i of issues) out(`  ${i.path || '(raíz)'}: ${i.message}`);
    return null;
  }
  const value = parseConfig(key, merged);
  const changed = changedFields(live.value as Record<string, unknown>, value as Record<string, unknown>);
  out(changed.length === 0 ? `Sin cambios en ${key} (v${live.version})` : `Cambiaría ${key} v${live.version} → v${live.version + 1}: ${changed.join(', ')}`);
  return value;
}

/** The top-level fields that differ, with the ids that come (+), go (-) or change (~) when the field is a list of things with ids. */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const byId = (v: unknown) =>
    Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string')
      ? new Map(v.map((x) => [(x as { id: string }).id, JSON.stringify(x)]))
      : null;
  const out: string[] = [];
  for (const field of Object.keys(after)) {
    if (JSON.stringify(before[field]) === JSON.stringify(after[field])) continue;
    const [a, b] = [byId(before[field]), byId(after[field])];
    const ids: string[] = [];
    if (a && b) {
      for (const id of b.keys()) if (!a.has(id)) ids.push(`+${id}`);
      for (const id of a.keys()) if (!b.has(id)) ids.push(`-${id}`);
      for (const [id, json] of b) if (a.has(id) && a.get(id) !== json) ids.push(`~${id}`);
    }
    out.push(ids.length > 0 ? `${field} (${ids.join(' ')})` : field);
  }
  return out;
}

/**
 * `show-config <clave> [--data]`: what is live for a key, read-only. As `{ key, version, data }`, or only the data
 * with `--data` (to save it as the starting point of a draft: publishing replaces whole top-level fields).
 */
async function showConfig(args: string[], deps: CliDeps): Promise<number> {
  const [key] = positional(args, []);
  if (!key) return usage(deps.out, 'Uso: show-config <clave> [--data]');
  if (!isConfigKey(key)) {
    deps.out(`Clave desconocida: ${key}`);
    return 1;
  }
  const { value, version } = await createConfigService(deps.db).getVersioned(key);
  deps.out(JSON.stringify(args.includes('--data') ? value : { key, version, data: value }, null, 2));
  return 0;
}

/** This build's defaults for a key: what the code would serve with nothing published (content: DEFAULT_CONTENT). */
function codeDefaults(key: ConfigKey): Record<string, unknown> | null {
  if (key === 'content') return DEFAULT_CONTENT as unknown as Record<string, unknown>;
  const parsed = configSchemas[key].safeParse({});
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

/**
 * `draft-config <clave> <campo[,campo…]> [--ids id,id…]`: a draft that starts from what is live, read-only (docs/
 * CONTENIDO.md A4). Each named field as published, plus what this build's defaults add: in a list of things with ids,
 * the entries it lacks (or, with --ids, only those, added or replacing the live one); any other field whole from the
 * defaults. Run it on PRE once the code is deployed and save its output as `<clave>.json` in the ops/launch folder.
 */
async function draftConfig(args: string[], deps: CliDeps): Promise<number> {
  const [key, fieldList] = positional(args, ['--ids']);
  if (!key || !fieldList) return usage(deps.out, 'Uso: draft-config <clave> <campo[,campo…]> [--ids id,id…]');
  if (!isConfigKey(key)) {
    deps.out(`Clave desconocida: ${key}`);
    return 1;
  }
  const defaults = codeDefaults(key);
  if (!defaults) {
    deps.out(`${key} no tiene valores por defecto completos en el código: prepara el borrador con show-config ${key} --data`);
    return 1;
  }
  const fields = fieldList.split(',').filter(Boolean);
  const unknown = fields.filter((f) => !Object.hasOwn(configSchemas[key].shape, f));
  if (unknown.length > 0) {
    deps.out(`Campos que ${key} no tiene: ${unknown.join(', ')}`);
    return 1;
  }
  const ids = flag(args, '--ids')?.split(',').filter(Boolean);
  const live = (await createConfigService(deps.db).get(key)) as Record<string, unknown>;
  const draft: Record<string, unknown> = {};
  try {
    for (const f of fields) draft[f] = draftFromDefaults(live[f], defaults[f], ids);
  } catch (err) {
    const msg = (err as Error).message;
    deps.out(msg === 'not_a_list' ? '--ids solo vale para campos que son listas con id' : `Esos ids no están en los valores del código: ${msg.replace('id_not_in_defaults:', '')}`);
    return 1;
  }
  deps.out(JSON.stringify(draft, null, 2));
  return 0;
}

/**
 * `check-config <lote.json | ->`: a batch `{ "<clave>": borrador, … }` (a whole ops/launch folder; see scripts/
 * ops-bundle.mjs) checked over what is live, read-only. Each key as `publish-config --dry-run` would, in publish
 * order, and then all together: opsProblems over the result (events and their scanners, the season, featured values,
 * mission ids, the anomaly). Exit 0 only when every key validates and it all holds together.
 */
async function checkConfig(args: string[], deps: CliDeps): Promise<number> {
  const [source] = positional(args, []);
  if (!source) return usage(deps.out, 'Uso: check-config <lote.json | ->');
  let batch: unknown;
  try {
    batch = JSON.parse(readFileSync(source === '-' ? 0 : source, 'utf8'));
  } catch (err) {
    deps.out(`No se pudo leer el JSON de ${source}: ${(err as Error).message}`);
    return 1;
  }
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) {
    deps.out('El lote debe ser un objeto { "<clave>": borrador }');
    return 1;
  }
  const keys = Object.keys(batch);
  const strays = keys.filter((k) => !isConfigKey(k));
  if (strays.length > 0) {
    deps.out(`Claves desconocidas: ${strays.join(', ')}`);
    return 1;
  }
  const config = createConfigService(deps.db);
  const ordered = [...PUBLISH_ORDER.filter((k) => keys.includes(k)), ...(keys as ConfigKey[]).filter((k) => !PUBLISH_ORDER.includes(k))];
  const after: Partial<Record<ConfigKey, unknown>> = {};
  let valid = true;
  for (const key of ordered) {
    const value = await simulate(key, (batch as Record<string, unknown>)[key], config, deps.out);
    if (value === null) valid = false;
    else after[key] = value;
  }
  if (!valid) return 1;
  const live = async <K extends 'season' | 'events' | 'gacha' | 'missions' | 'content'>(k: K): Promise<ConfigValue<K>> => (after[k] as ConfigValue<K> | undefined) ?? (await config.get(k));
  const problems = opsProblems({ season: await live('season'), events: await live('events'), gacha: await live('gacha'), missions: await live('missions'), content: await live('content') }, Date.now());
  for (const p of problems) deps.out(`Problema: ${p}`);
  deps.out(problems.length === 0 ? `Se sostiene: ${ordered.join(', ')}` : `No se sostiene: ${problems.length} problema(s)`);
  return problems.length === 0 ? 0 : 1;
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

/** Asks Stripe about the recent payments not delivered (shop and lab plan, F4): delivers the paid ones. */
async function shopReconcile(args: string[], deps: CliDeps): Promise<number> {
  const days = Number(flag(args, '--days') ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > 90) return usage(deps.out, 'Uso: shop-reconcile [--days 1-90]');
  const gateway = deps.shopGateway !== undefined ? deps.shopGateway : deps.env.stripe ? createStripeGateway(deps.env.stripe) : null;
  if (!gateway) {
    deps.out('La tienda no tiene las claves de Stripe: no hay nada que conciliar');
    return 1;
  }
  const r = await reconcileShop(deps.db, gateway, days);
  deps.out(`Revisadas ${r.checked} compras de los últimos ${days} días: ${r.delivered} entregadas, ${r.expired} caducadas, ${r.failed} sin respuesta de Stripe`);
  return r.failed > 0 ? 1 : 0;
}

async function shopUnblock(args: string[], deps: CliDeps): Promise<number> {
  const reason = flag(args, '--reason');
  const [username] = positional(args, ['--reason']);
  if (!username || !usernameSchema.safeParse(username).success || !reason || reason.length < 3) return usage(deps.out, 'Uso: shop-unblock <usuario> --reason <motivo>');
  const account = await findAccountByUsername(deps.db, username);
  if (!account) {
    deps.out(`No existe la cuenta ${username}`);
    return 1;
  }
  const done = await unblockShop(deps.db, CLI_ACTOR, account.id, reason);
  deps.out(done ? `Tienda de ${username} desbloqueada` : `La tienda de ${username} no estaba bloqueada`);
  return 0;
}

/** Nov plan C2: gives the November cosmetics to who already earned them (portraits, achievements, catalog, route). */
async function cosmeticsBackfill(deps: CliDeps): Promise<number> {
  const config = createConfigService(deps.db);
  const [content, achievements, catalog, seasonRoute, season] = await Promise.all([config.get('content'), config.get('achievements'), config.get('catalog'), config.get('seasonRoute'), config.get('season')]);
  const done = await backfillCosmetics(deps.db, { content, achievements: achievements.list, catalog: catalog.rewards, route: seasonRoute.steps, season: season.id });
  deps.out(`Retratos revisados en ${done.portraits} partidas · logros ${done.achievements} · catálogo ${done.catalog} · ruta ${done.route}`);
  return 0;
}

/**
 * `grant-cosmetics <usuario> --all|--shop --reason <motivo>`: gives a player every piece (`--all`: the catalog and every
 * reward of the live config, events included) or only the shop's (`--shop`), what they lack. Audited.
 */
async function grantAllCosmetics(args: string[], deps: CliDeps): Promise<number> {
  const reason = flag(args, '--reason');
  const [username] = positional(args, ['--reason']);
  const scope = args.includes('--all') ? 'all' : args.includes('--shop') ? 'shop' : null;
  if (!username || !scope || (args.includes('--all') && args.includes('--shop')) || !reason || reason.length < 3) return usage(deps.out, 'Uso: grant-cosmetics <usuario> --all|--shop --reason <motivo>');
  const account = await findAccountByUsername(deps.db, username);
  if (!account) {
    deps.out(`No existe la cuenta ${username}`);
    return 1;
  }
  const config = createConfigService(deps.db);
  const [cosmetics, shop, achievements, missions, events, catalog, seasonRoute, season] = await Promise.all([
    config.get('cosmetics'),
    config.get('shop'),
    config.get('achievements'),
    config.get('missions'),
    config.get('events'),
    config.get('catalog'),
    config.get('seasonRoute'),
    config.get('season'),
  ]);
  const pieces = cosmeticsToGrant({ cosmetics, shopProducts: shop.products, rewards: [achievements, missions, events, catalog, seasonRoute, season] }, scope);
  const rows = [...pieces.avatars.map((value) => ({ kind: 'avatar' as const, value })), ...pieces.frames.map((value) => ({ kind: 'frame' as const, value })), ...pieces.titles.map((value) => ({ kind: 'title' as const, value }))].map((r) => ({ account_id: account.id, ...r }));
  const added = await inTransaction(deps.db, async (trx) => {
    const made = rows.length > 0 ? await trx.insertInto('galaxy.cosmetics').values(rows).onConflict((oc) => oc.doNothing()).returning(['kind', 'value']).execute() : [];
    await writeAudit(trx, { actor: CLI_ACTOR, action: 'cosmetics.grant', targetType: 'account', targetId: account.id, after: { scope, added: made }, reason });
    return made.length;
  });
  deps.out(`${account.username}: ${added} piezas nuevas de ${rows.length} (${pieces.avatars.length} avatares, ${pieces.frames.length} marcos, ${pieces.titles.length} títulos)`);
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
  if (command === 'show-config') return showConfig(args, deps);
  if (command === 'draft-config') return draftConfig(args, deps);
  if (command === 'check-config') return checkConfig(args, deps);
  if (command === 'notice') return notice(args, deps);
  if (command === 'shop-reconcile') return shopReconcile(args, deps);
  if (command === 'shop-unblock') return shopUnblock(args, deps);
  if (command === 'cosmetics-backfill') return cosmeticsBackfill(deps);
  if (command === 'grant-cosmetics') return grantAllCosmetics(args, deps);
  return usage(deps.out, command ? `Comando desconocido: ${command}` : undefined);
}
