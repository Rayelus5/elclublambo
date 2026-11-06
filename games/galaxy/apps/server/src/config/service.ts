import { type ConfigKey, type ConfigValue, configSchemas, parseConfig } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { ZodError } from 'zod';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import type { ConfigReader } from './reader';

export type ConfigVersion = { version: number; data: unknown; createdAt: string; createdBy: string | null; note: string };

export interface ConfigService extends ConfigReader {
  versions(key: ConfigKey): Promise<ConfigVersion[]>;
  active(): Promise<Array<{ key: string; version: number; data: unknown }>>;
  publish<K extends ConfigKey>(key: K, data: unknown, actor: AuditActor, reason: string): Promise<{ version: number }>;
}

/**
 * Live configuration backed by galaxy.game_config_versions. Reads are cached per key for `ttlMs` (10 s), so a publish
 * from another process shows up within that time; a publish from this process invalidates the cache at once.
 * A stored row that no longer passes its schema is logged and replaced by the schema defaults.
 */
/**
 * Configuration the game cannot serve yet. Event banners (GDD §9) have their rules and their server tests, but not
 * their event signals in the wallet, combined odds on screen or featured checks: until the events milestone the live
 * config refuses them, so no one can publish half of a feature to players.
 */
function refuseUnfinished(key: ConfigKey, value: unknown): void {
  if (key !== 'gacha') return;
  const banners = (value as ConfigValue<'gacha'>).banners;
  if (banners.some((b) => b.kind === 'event')) {
    throw new ZodError([{ code: 'custom', message: 'events_not_ready', path: ['banners'], input: banners }]);
  }
}

export function createConfigService(
  db: Kysely<DB>,
  opts: { ttlMs?: number; now?: () => number; onInvalid?: (key: ConfigKey, err: unknown) => void } = {},
): ConfigService {
  const ttlMs = opts.ttlMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const onInvalid = opts.onInvalid ?? (() => {});
  // Value and version are cached together, from the same row, so whoever records a version records the one it used.
  const cache = new Map<ConfigKey, { value: unknown; version: number; at: number }>();

  async function load<K extends ConfigKey>(key: K): Promise<{ value: ConfigValue<K>; version: number }> {
    const row = await db
      .selectFrom('galaxy.game_config_active')
      .select(['data', 'version'])
      .where('key', '=', key)
      .executeTakeFirst();
    try {
      return { value: parseConfig(key, row?.data ?? {}), version: row?.version ?? 0 };
    } catch (err) {
      onInvalid(key, err);
      return { value: parseConfig(key, {}), version: 0 };
    }
  }

  async function getVersioned<K extends ConfigKey>(key: K): Promise<{ value: ConfigValue<K>; version: number }> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return { value: hit.value as ConfigValue<K>, version: hit.version };
    const loaded = await load(key);
    cache.set(key, { ...loaded, at: now() });
    return loaded;
  }

  return {
    getVersioned,
    async get(key) {
      return (await getVersioned(key)).value;
    },

    async versions(key) {
      const rows = await db
        .selectFrom('galaxy.game_config_versions')
        .select(['version', 'data', 'created_at', 'created_by', 'note'])
        .where('key', '=', key)
        .orderBy('version', 'asc')
        .execute();
      return rows.map((r) => ({
        version: r.version,
        data: r.data,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        note: r.note,
      }));
    },

    async active() {
      return db.selectFrom('galaxy.game_config_active').select(['key', 'version', 'data']).orderBy('key').execute();
    },

    async publish(key, data, actor, reason) {
      // Fail fast on a typo or a wrong type before taking the lock.
      parseConfig(key, data);
      let value: ConfigValue<typeof key> | undefined;
      const version = await inTransaction(db, async (trx) => {
        // One publisher per key at a time: version + 1 never collides.
        await sql`select pg_advisory_xact_lock(hashtext(${`galaxy.config:${key}`}))`.execute(trx);
        const current = await trx
          .selectFrom('galaxy.game_config_active')
          .select(['version', 'data'])
          .where('key', '=', key)
          .executeTakeFirst();
        // A publish changes only the fields it names: merge onto the active value (known fields only, so a field
        // removed from the schema never blocks a publish).
        const known = new Set(Object.keys(configSchemas[key].shape));
        const base = Object.fromEntries(
          Object.entries((current?.data ?? {}) as Record<string, unknown>).filter(([k]) => known.has(k)),
        );
        value = parseConfig(key, { ...base, ...(data as Record<string, unknown>) });
        refuseUnfinished(key, value);
        const next = (current?.version ?? 0) + 1;
        await trx
          .insertInto('galaxy.game_config_versions')
          .values({ key, version: next, data: JSON.stringify(value), created_by: actor.id, note: reason })
          .execute();
        await writeAudit(trx, {
          actor,
          action: 'config.published',
          targetType: 'config',
          targetId: key,
          before: current?.data ?? null,
          after: value,
          reason,
        });
        return next;
      });
      cache.delete(key);
      return { version };
    },
  };
}
