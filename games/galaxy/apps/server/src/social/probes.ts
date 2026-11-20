import { PROBE_SHOWCASE_MAX, type Profile, type ProfileProbe, type ProfileProbesRequest } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { probeCards, probeGrants, runStats, testedProbe } from '../runs/hangar';
import { probeLevels } from '../runs/levels';
import type { SocialDeps } from './leaderboard';

// The probes on a profile (plan «banda sonora, skins, perfil y entorno», part D): the owner chooses up to three to show,
// and below them every probe they have, each with its level, its skin and its starting weapon. Only probes they earned:
// a locked probe is never shown, and one chosen that is no longer theirs drops out of the showcase.

/** Every probe the account has (in the content's order), with what it flies with. */
async function ownedProbes(deps: SocialDeps, db: Kysely<DB>, accountId: string): Promise<ProfileProbe[]> {
  const [content, cfg] = await Promise.all([deps.config.get('content'), deps.config.get('probes')]);
  const assigned = await testedProbe(db, accountId);
  if (assigned === null) return [];
  const levels = await probeLevels(db, accountId);
  // probeLevels already keeps a skin only while it is the account's.
  const owned = Object.values(levels).flatMap((l) => (l.skin ? [l.skin] : []));
  const cards = probeCards(content, assigned, await runStats(db, accountId, cfg.minRunSeconds), cfg, levels, await probeGrants(db, accountId), { owned, runs: {} });
  return cards
    .filter((c) => c.unlocked)
    .map((c) => ({ id: c.id, level: c.level, skin: c.skin, variant: c.variant === c.weapon.id ? null : c.variant }));
}

export async function profileProbes(deps: SocialDeps, accountId: string): Promise<NonNullable<Profile['probes']>> {
  const all = await ownedProbes(deps, deps.db, accountId);
  const chosen = await deps.db.selectFrom('galaxy.probe_showcase').select(['probe']).where('account_id', '=', accountId).orderBy('slot').execute();
  const showcase = chosen.flatMap((r) => all.filter((p) => p.id === r.probe)).slice(0, PROBE_SHOWCASE_MAX);
  return { showcase, all };
}

/** Replaces the showcase: each probe must be the account's (409 probe_locked otherwise). */
export async function setProfileProbes(deps: SocialDeps, accountId: string, req: ProfileProbesRequest): Promise<NonNullable<Profile['probes']>> {
  const mine = new Set((await ownedProbes(deps, deps.db, accountId)).map((p) => p.id));
  if (req.probes.some((id) => !mine.has(id))) throw new HttpError(409, 'probe_locked');
  await deps.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('galaxy.probe_showcase').where('account_id', '=', accountId).execute();
    if (req.probes.length > 0) await trx.insertInto('galaxy.probe_showcase').values(req.probes.map((probe, slot) => ({ account_id: accountId, slot, probe }))).execute();
  });
  return profileProbes(deps, accountId);
}
