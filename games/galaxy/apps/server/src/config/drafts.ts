import {
  type ConfigKey,
  type ConfigValue,
  configIssues,
  configJsonSchema,
  DRAFT_KEYS,
  type DraftCheck,
  type DraftConflict,
  type DraftKey,
  type DraftSummary,
  type DraftView,
  mergeDraft,
  parseConfig,
  rebaseDraft,
  type Resolutions,
} from '@galaxy/shared';
import type { Kysely, Selectable } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { ConfigDraftsTable, DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import type { ConfigService } from './service';

// Config drafts on the server (the content editor, 2026-11-16, P2): a change to the run content — and to the sectors and
// probes keys a new sector or probe needs — kept as a draft any admin can resume, check, rebase, try in a test run and
// publish. Each save names the revision it was made on (two tabs never overwrite each other); each key keeps the live
// version it was first touched on, so a later publish is merged entity by entity before this one can go live.

type Row = Selectable<ConfigDraftsTable>;
type Fields = Partial<Record<DraftKey, Record<string, unknown>>>;
type Bases = Partial<Record<DraftKey, number>>;

export interface DraftService {
  list(): Promise<DraftSummary[]>;
  create(actor: AuditActor, title: string): Promise<DraftView>;
  get(id: string): Promise<DraftView>;
  setField(actor: AuditActor, id: string, change: { key: DraftKey; field: string; value: unknown; revision: number }): Promise<DraftView>;
  rename(actor: AuditActor, id: string, change: { title: string; revision: number }): Promise<DraftView>;
  check(id: string): Promise<DraftCheck>;
  rebase(actor: AuditActor, id: string, resolutions: Partial<Record<DraftKey, Resolutions>>): Promise<{ draft: DraftView; conflicts: DraftConflict[] }>;
  publish(actor: AuditActor, id: string, reason: string): Promise<{ versions: Record<string, number> }>;
  discard(actor: AuditActor, id: string): Promise<void>;
  /** The draft over what is live, for a test run: each key it changes, parsed (400 `draft_invalid` with its issues). */
  merged(id: string): Promise<{ content: ConfigValue<'content'>; sectors: ConfigValue<'sectors'>; probes: ConfigValue<'probes'> }>;
}

const fieldsOf = (row: Row) => (row.data ?? {}) as Fields;
const basesOf = (row: Row) => (row.base_versions ?? {}) as Bases;

export function createDraftService(deps: { db: Kysely<DB>; config: ConfigService }): DraftService {
  const { db, config } = deps;

  const liveVersions = async (): Promise<Record<string, number>> => Object.fromEntries((await config.latest()).map((r) => [r.key, r.version]));

  const names = async (ids: (string | null)[]) => {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = wanted.length ? await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', wanted).execute() : [];
    const map = new Map(rows.map((r) => [r.id, r.username]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  };

  function summary(row: Row, live: Record<string, number>, nameOf: (id: string | null) => string | null): DraftSummary {
    const data = fieldsOf(row);
    const bases = basesOf(row);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      revision: row.revision,
      fields: DRAFT_KEYS.flatMap((key) => Object.keys(data[key] ?? {}).map((field) => ({ key, field }))),
      createdBy: nameOf(row.created_by),
      updatedBy: nameOf(row.updated_by),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      stale: row.status === 'open' && DRAFT_KEYS.some((key) => data[key] && (bases[key] ?? 0) !== (live[key] ?? 0)),
    };
  }

  async function view(row: Row): Promise<DraftView> {
    const nameOf = await names([row.created_by, row.updated_by]);
    return {
      ...summary(row, await liveVersions(), nameOf),
      data: fieldsOf(row),
      baseVersions: basesOf(row),
      publishedVersions: (row.published_versions ?? null) as DraftView['publishedVersions'],
    };
  }

  async function load(id: string, trx: Kysely<DB> = db): Promise<Row> {
    const row = await trx.selectFrom('galaxy.config_drafts').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new HttpError(404, 'not_found');
    return row;
  }

  /** The stored value of `key` at `version` (its defaults before anything was published). */
  async function dataAt(key: ConfigKey, version: number): Promise<Record<string, unknown>> {
    if (version <= 0) return parseConfig(key, {}) as Record<string, unknown>;
    const v = await config.version(key, version);
    return (v?.data ?? parseConfig(key, {})) as Record<string, unknown>;
  }

  /** Each key the draft changes, three ways against what was published since it was made. */
  async function rebaseAll(row: Row, resolutions: Partial<Record<DraftKey, Resolutions>> = {}) {
    const live = await liveVersions();
    const data = fieldsOf(row);
    const bases = basesOf(row);
    const out: Fields = {};
    const conflicts: DraftConflict[] = [];
    for (const key of DRAFT_KEYS) {
      const mine = data[key];
      if (!mine) continue;
      const from = bases[key] ?? 0;
      const to = live[key] ?? 0;
      if (from === to) {
        out[key] = mine;
        continue;
      }
      const r = rebaseDraft(await dataAt(key, from), (await config.get(key)) as Record<string, unknown>, mine, resolutions[key] ?? {});
      out[key] = r.fields;
      conflicts.push(...r.conflicts.map((c) => ({ key, ...c })));
    }
    return { data: out, conflicts, live };
  }

  async function open(id: string, trx: Kysely<DB>): Promise<Row> {
    const row = await trx.selectFrom('galaxy.config_drafts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!row) throw new HttpError(404, 'not_found');
    if (row.status !== 'open') throw new HttpError(409, 'draft_closed');
    return row;
  }

  return {
    async list() {
      const rows = await db.selectFrom('galaxy.config_drafts').selectAll().where('status', '=', 'open').orderBy('updated_at', 'desc').execute();
      const live = await liveVersions();
      const nameOf = await names(rows.flatMap((r) => [r.created_by, r.updated_by]));
      return rows.map((r) => summary(r, live, nameOf));
    },

    async create(actor, title) {
      const row = await inTransaction(db, async (trx) => {
        const created = await trx
          .insertInto('galaxy.config_drafts')
          .values({ title, created_by: actor.id, updated_by: actor.id })
          .returningAll()
          .executeTakeFirstOrThrow();
        await writeAudit(trx, { actor, action: 'config.draft.created', targetType: 'config_draft', targetId: created.id, after: { title }, reason: title });
        return created;
      });
      return view(row);
    },

    async get(id) {
      return view(await load(id));
    },

    async setField(actor, id, change) {
      // Only a top-level field the key's schema has: the draft is merged over what is live field by field.
      const props = configJsonSchema(change.key).properties ?? {};
      if (!Object.hasOwn(props, change.field)) throw new HttpError(400, 'unknown_field');
      const live = await liveVersions();
      const row = await inTransaction(db, async (trx) => {
        const current = await open(id, trx);
        if (current.revision !== change.revision) throw new HttpError(409, 'draft_conflict');
        const data = structuredClone(fieldsOf(current));
        const bases = { ...basesOf(current) };
        const fields = { ...(data[change.key] ?? {}) };
        if (change.value === null || change.value === undefined) delete fields[change.field];
        else fields[change.field] = change.value;
        if (Object.keys(fields).length > 0) {
          data[change.key] = fields;
          // The version it is made on: the live one when the key is first touched.
          if (bases[change.key] === undefined) bases[change.key] = live[change.key] ?? 0;
        } else {
          delete data[change.key];
          delete bases[change.key];
        }
        return trx
          .updateTable('galaxy.config_drafts')
          .set({ data: JSON.stringify(data), base_versions: JSON.stringify(bases), revision: current.revision + 1, updated_by: actor.id, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      return view(row);
    },

    async rename(actor, id, change) {
      const row = await inTransaction(db, async (trx) => {
        const current = await open(id, trx);
        if (current.revision !== change.revision) throw new HttpError(409, 'draft_conflict');
        return trx
          .updateTable('galaxy.config_drafts')
          .set({ title: change.title, revision: current.revision + 1, updated_by: actor.id, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      return view(row);
    },

    async check(id) {
      const row = await load(id);
      const { data, conflicts, live } = await rebaseAll(row);
      const issues: DraftCheck['issues'] = [];
      for (const key of DRAFT_KEYS) {
        if (!data[key]) continue;
        const merged = mergeDraft(key, await config.get(key), data[key]);
        issues.push(...configIssues(key, merged).map((i) => ({ key, path: i.path, message: i.message })));
      }
      const bases = basesOf(row);
      const stale = DRAFT_KEYS.some((key) => fieldsOf(row)[key] && (bases[key] ?? 0) !== (live[key] ?? 0));
      return { issues, conflicts, stale };
    },

    async rebase(actor, id, resolutions) {
      const { data, conflicts, live } = await rebaseAll(await load(id), resolutions);
      if (conflicts.length > 0) return { draft: await view(await load(id)), conflicts };
      const row = await inTransaction(db, async (trx) => {
        const current = await open(id, trx);
        const bases = Object.fromEntries(DRAFT_KEYS.filter((k) => data[k]).map((k) => [k, live[k] ?? 0]));
        const updated = await trx
          .updateTable('galaxy.config_drafts')
          .set({ data: JSON.stringify(data), base_versions: JSON.stringify(bases), revision: current.revision + 1, updated_by: actor.id, updated_at: new Date() })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await writeAudit(trx, { actor, action: 'config.draft.rebased', targetType: 'config_draft', targetId: id, before: basesOf(current), after: bases, reason: current.title });
        return updated;
      });
      return { draft: await view(row), conflicts: [] };
    },

    async publish(actor, id, reason) {
      const row = await load(id);
      if (row.status !== 'open') throw new HttpError(409, 'draft_closed');
      const data = fieldsOf(row);
      const bases = basesOf(row);
      const items = DRAFT_KEYS.filter((key) => data[key]).map((key) => ({ key, data: data[key]!, baseVersion: bases[key] ?? 0 }));
      if (items.length === 0) throw new HttpError(400, 'draft_empty');
      // All its keys or none, each on the version it was made on (409 config_conflict: rebase first).
      const { versions } = await config.publishMany(items, actor, reason);
      await inTransaction(db, async (trx) => {
        await trx
          .updateTable('galaxy.config_drafts')
          .set({ status: 'published', published_versions: JSON.stringify(versions), closed_at: new Date(), updated_by: actor.id, updated_at: new Date() })
          .where('id', '=', id)
          .where('status', '=', 'open')
          .execute();
        await writeAudit(trx, { actor, action: 'config.draft.published', targetType: 'config_draft', targetId: id, after: versions, reason });
      });
      return { versions };
    },

    async discard(actor, id) {
      await inTransaction(db, async (trx) => {
        const current = await open(id, trx);
        await trx.updateTable('galaxy.config_drafts').set({ status: 'discarded', closed_at: new Date(), updated_by: actor.id, updated_at: new Date() }).where('id', '=', id).execute();
        await writeAudit(trx, { actor, action: 'config.draft.discarded', targetType: 'config_draft', targetId: id, before: { title: current.title }, reason: current.title });
      });
    },

    async merged(id) {
      const row = await load(id);
      if (row.status !== 'open') throw new HttpError(409, 'draft_closed');
      const data = fieldsOf(row);
      const out = {} as { content: ConfigValue<'content'>; sectors: ConfigValue<'sectors'>; probes: ConfigValue<'probes'> };
      const issues: DraftCheck['issues'] = [];
      for (const key of DRAFT_KEYS) {
        const merged = mergeDraft(key, await config.get(key), data[key] ?? {});
        const found = configIssues(key, merged);
        issues.push(...found.map((i) => ({ key, path: i.path, message: i.message })));
        if (found.length === 0) (out as Record<DraftKey, unknown>)[key] = parseConfig(key, merged);
      }
      if (issues.length > 0) throw new HttpError(400, 'draft_invalid', { issues });
      return out;
    },
  };
}
