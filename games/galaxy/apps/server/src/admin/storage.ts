import { statfs } from 'node:fs/promises';
import { type AdminStorage, STORAGE_TABLES_SHOWN } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';

export type Disk = { totalBytes: number; freeBytes: number };
export type StorageDeps = { db: Kysely<DB>; now: () => Date; disk: () => Promise<Disk | null> };

/** The disk the server runs on (its root: in the container, the host's disk that holds it); null when unreadable. */
export async function serverDisk(path = '/'): Promise<Disk | null> {
  try {
    const s = await statfs(path);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/**
 * «Almacenamiento» (admins only, reading): the database and the game's schema in it, the server's disk, the galaxies
 * alive and disintegrated, and the game's biggest tables. Sizes come from Postgres's own functions; Postgres returns
 * them as bigint strings.
 */
export async function adminStorage(deps: StorageDeps): Promise<AdminStorage> {
  const { db } = deps;
  const [sizes, galaxies, tables, disk] = await Promise.all([
    sql<{ db: string; game: string }>`
      select pg_database_size(current_database()) as db,
             (select coalesce(sum(pg_total_relation_size(c.oid)), 0)
                from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'galaxy' and c.relkind in ('r', 'p', 'm')) as game`.execute(db),
    sql<{ live: number; disintegrated: number; bytes: string }>`
      select count(*) filter (where disintegrated_at is null)::int as live,
             count(*) filter (where disintegrated_at is not null)::int as disintegrated,
             pg_total_relation_size('galaxy.galaxies') as bytes
        from galaxy.galaxies`.execute(db),
    sql<{ name: string; rows: string | null; bytes: string; index_bytes: string }>`
      select c.relname as name,
             case when c.reltuples < 0 then null else c.reltuples::bigint end as rows,
             pg_total_relation_size(c.oid) as bytes,
             pg_indexes_size(c.oid) as index_bytes
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'galaxy' and c.relkind in ('r', 'p', 'm')
       order by pg_total_relation_size(c.oid) desc, c.relname
       limit ${STORAGE_TABLES_SHOWN}`.execute(db),
    deps.disk(),
  ]);
  const s = sizes.rows[0]!;
  const g = galaxies.rows[0]!;
  return {
    readAt: deps.now().toISOString(),
    database: { bytes: Number(s.db), gameBytes: Number(s.game) },
    disk,
    galaxies: { live: g.live, disintegrated: g.disintegrated, bytes: Number(g.bytes) },
    tables: tables.rows.map((t) => ({ name: t.name, rows: t.rows === null ? null : Number(t.rows), bytes: Number(t.bytes), indexBytes: Number(t.index_bytes) })),
  };
}
