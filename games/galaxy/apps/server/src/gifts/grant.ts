import { createHash } from 'node:crypto';
import { generateGalaxy, type Gift, type GrantedItem, mergeCurrencies, TIERS, traitKnown } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import { grantCosmetics } from '../cosmetics/service';
import type { DB } from '../db/schema';
import { credit } from '../economy/wallet';
import { galaxyValues } from '../galaxies/insert';

// Gifts of every kind (mail v2, 2026-11-16): one service gives resources, cosmetic pieces, galaxies, probes, XP and
// season points inside the caller's transaction (the caller makes it once: the mail's guarded claim). Currencies go to
// the ledger (one credit per currency, keyed `<key>:<currency>`: an old message keeps its `mail:<id>:<currency>` keys);
// the rest to the audit. Each gift says what it did: given, already owned or not given (and why).

export interface GrantContext {
  /** The claim's key (`mail:<id>`): the ledger's keys and the galaxies' seeds come from it. */
  key: string;
  reason: string;
  ref: unknown;
  actor: AuditActor;
  /** The season live now: its points and currency only while it is open. */
  season: { id: string; open: boolean };
  /** The audit's action for the pieces, galaxies and probes given. */
  auditAction?: string;
}

/** A galaxy gift's seed: the claim's key, its place and its number (the same claim always makes the same galaxies). */
function giftSeed(key: string, index: number, n: number, attempt: number): bigint {
  const h = createHash('sha256').update(`${key}|${index}|${n}|${attempt}`).digest();
  return h.readBigUInt64BE(0) >> 1n;
}

export async function grantGifts(trx: Kysely<DB>, accountId: string, gifts: readonly Gift[], ctx: GrantContext): Promise<{ items: GrantedItem[]; seasonTouched: boolean }> {
  const items: GrantedItem[] = gifts.map((gift) => ({ gift, outcome: 'granted' }));
  let seasonTouched = false;

  // Currencies, summed by currency (a season's own only while that season is open).
  const skippedCurrency = new Set<string>();
  for (const [currency, amount] of mergeCurrencies(gifts)) {
    if (currency.startsWith('season:') && (!ctx.season.open || currency !== `season:${ctx.season.id}`)) {
      skippedCurrency.add(currency);
      continue;
    }
    await credit(trx, accountId, currency, amount, ctx.reason, ctx.ref, `${ctx.key}:${currency}`);
  }

  const given: Record<string, unknown>[] = [];
  for (const [index, gift] of gifts.entries()) {
    const item = items[index]!;
    if (gift.kind === 'currency') {
      if (skippedCurrency.has(gift.currency)) Object.assign(item, { outcome: 'skipped', why: 'season_closed' });
    } else if (gift.kind === 'cosmetic') {
      const owned = await trx.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', accountId).where('kind', '=', gift.piece).where('value', '=', gift.id).executeTakeFirst();
      if (owned) item.outcome = 'owned';
      else {
        await grantCosmetics(trx, accountId, { [gift.piece]: gift.id });
        given.push({ cosmetic: gift.piece, id: gift.id });
      }
    } else if (gift.kind === 'galaxy') {
      const tier = TIERS.indexOf(gift.tier);
      const made: NonNullable<GrantedItem['galaxies']> = [];
      // A trait value that does not exist never comes out: no seed is tried.
      const possible = !gift.trait || traitKnown(gift.trait.key, gift.trait.value);
      for (let n = 0; possible && n < gift.count; n++) {
        // A few seeds before giving up (a trait some tiers rarely carry).
        let g: ReturnType<typeof generateGalaxy> | null = null;
        for (let attempt = 0; attempt < 3 && !g; attempt++) {
          try {
            g = generateGalaxy(giftSeed(ctx.key, index, n, attempt), tier, gift.trait ? { trait: gift.trait.key, value: gift.trait.value } : undefined);
          } catch {
            g = null;
          }
        }
        if (!g) break;
        const row = await trx
          .insertInto('galaxy.galaxies')
          .values(galaxyValues(g, { owner: accountId, tier, finish: gift.finish, origin: 'grant' }))
          .returning(['id', 'name'])
          .executeTakeFirstOrThrow();
        made.push({ id: row.id, name: row.name, tier, finish: gift.finish });
      }
      if (made.length === 0) Object.assign(item, { outcome: 'skipped', why: 'galaxy_unreachable' });
      else {
        item.galaxies = made;
        given.push({ galaxies: made.map((m) => m.id), tier: gift.tier, finish: gift.finish });
      }
    } else if (gift.kind === 'probe') {
      const had = await trx.selectFrom('galaxy.probe_grants').select('probe').where('account_id', '=', accountId).where('probe', '=', gift.probe).executeTakeFirst();
      if (had) item.outcome = 'owned';
      else {
        await trx.insertInto('galaxy.probe_grants').values({ account_id: accountId, probe: gift.probe }).onConflict((oc) => oc.doNothing()).execute();
        given.push({ probe: gift.probe });
      }
    } else if (gift.kind === 'xp') {
      await trx
        .insertInto('galaxy.account_xp')
        .values({ account_id: accountId, xp: gift.amount, updated_at: new Date() })
        .onConflict((oc) => oc.column('account_id').doUpdateSet({ xp: sql`galaxy.account_xp.xp + ${gift.amount}`, updated_at: new Date() }))
        .execute();
    } else if (gift.kind === 'seasonPoints') {
      if (!ctx.season.open) Object.assign(item, { outcome: 'skipped', why: 'season_closed' });
      else {
        await trx.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: ctx.season.id, points: gift.amount, source: 'mail' }).execute();
        seasonTouched = true;
      }
    }
  }
  if (given.length > 0) await writeAudit(trx, { actor: ctx.actor, action: ctx.auditAction ?? 'gift.grant', targetType: 'account', targetId: accountId, after: { key: ctx.key, given }, reason: ctx.reason });
  return { items, seasonTouched };
}
