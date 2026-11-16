import { configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { spriteDataUrl } from '../../arena/sprites';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { ConfigForm, type Options } from '../forms/ConfigForm';
import { issueText } from '../forms/issues';
import { emptyOf, itemsOf, liveIds, slugOf, unwrap } from '../forms/schema';
import { AREAS, type AreaDesc, describeContent as describe, DESCRIPTORS, VOCABS } from './descriptors';

// The content editor (2026-11-16, P4): the run content edited the way an admin thinks of it. Areas (Arsenal, Fauna,
// Núcleos…) hold their top-level fields; a list of things with ids (weapons, enemies, sectors…) is a searchable list
// beside the form of the chosen one, anything else a form of its own. Every field is named and explained by the
// descriptors; what is published cannot be removed. The view is in the address (zona, lista, id) so it can be shared.

const t = copy.admin.content;

type Entity = { id: string; name?: string } & Record<string, unknown>;
type Value = Record<string, unknown>;

const isEntityList = (v: unknown): v is Entity[] => Array.isArray(v) && v.length > 0 && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');

/** The choices the forms offer: every vocabulary, and the entities the draft has now (by id, with their names). */
function choicesOf(value: Value): Options {
  const out: Options = {};
  for (const [name, vocab] of Object.entries(VOCABS)) out[`vocab:${name}`] = Object.entries(vocab ?? {}).map(([v, term]) => ({ value: v, label: term.label }));
  for (const key of ['weapons', 'passives', 'enemies', 'bosses', 'sectors', 'probes', 'anomalies']) {
    const list = value[key];
    if (isEntityList(list)) out[key] = list.map((e) => ({ value: e.id, label: e.name ? `${e.name}` : e.id }));
  }
  return out;
}

/** An entity's picture in the lists: its sprite or icon, or none. */
function thumbOf(key: string, e: Entity, value: Value): string | null {
  let id: unknown = e.sprite ?? e.icon;
  if (key === 'sectors') id = (value.bosses as Entity[] | undefined)?.find((b) => b.id === e.boss)?.sprite;
  if (typeof id !== 'string') return null;
  try {
    return spriteDataUrl(id, 2);
  } catch {
    return null;
  }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The areas, and «Otros» for top-level fields no area names yet. */
function areasFor(value: Value): AreaDesc[] {
  const placed = new Set(AREAS.flatMap((a) => a.keys as string[]));
  const rest = Object.keys(value).filter((k) => !placed.has(k));
  return rest.length ? [...AREAS, { id: 'otros', title: t.others, summary: t.othersSummary, icon: 'list', keys: rest as AreaDesc['keys'] }] : [...AREAS];
}

export function ContentEditor({ value, live, onChange, issues }: { value: Value; live: Value; onChange: (next: Value) => void; issues: { path: string; message: string }[] }) {
  const [params, setParams] = useSearchParams();
  const schema = configJsonSchema('content');
  const areas = useMemo(() => areasFor(value), [value]);
  const area = areas.find((a) => a.id === params.get('zona')) ?? areas[0]!;
  const keys = area.keys as string[];
  const wanted = params.get('id');
  // The list asked for, else the one holding the entity asked for, else the area's first.
  const key = keys.find((k) => k === params.get('lista')) ?? (wanted ? keys.find((k) => isEntityList(value[k]) && value[k].some((e) => e.id === wanted)) : undefined) ?? keys[0]!;
  const options = useMemo(() => choicesOf(value), [value]);
  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };
  const node = unwrap(schema.properties?.[key] ?? {}).node;
  const isList = node.type === 'array' && unwrap(itemsOf(node)).node.type === 'object';
  return (
    <div className="ce">
      <div className="ce-areas" role="tablist" aria-label={t.areas}>
        {areas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === area.id} className="ce-area" onClick={() => go({ zona: a.id, lista: null, id: null })}>
            <Icon name={a.icon} />
            <span>{a.title}</span>
          </button>
        ))}
      </div>
      <p className="panel-note ce-summary">{area.summary}</p>
      {keys.length > 1 ? (
        <div className="ce-lists" role="tablist" aria-label={area.title}>
          {keys.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === key} className="lip pill small" onClick={() => go({ lista: k, id: null })}>
              {DESCRIPTORS[k]?.label ?? k}
            </button>
          ))}
        </div>
      ) : null}
      {isList ? (
        <EntityPanel
          key={key}
          field={key}
          node={node}
          value={value}
          live={live}
          options={options}
          issues={issues}
          selected={wanted}
          onSelect={(id) => go({ lista: key, id })}
          onChange={(list) => onChange({ ...value, [key]: list })}
        />
      ) : (
        <section className="lip panel ce-object" aria-label={DESCRIPTORS[key]?.label ?? key}>
          <ConfigForm
            cfgKey="content"
            schema={{ type: 'object', properties: { [key]: schema.properties![key]! } }}
            value={{ [key]: value[key] }}
            onChange={(next) => onChange({ ...value, [key]: (next as Value)[key] })}
            issues={issuesUnder(issues, '', value)}
            options={options}
            describe={describe}
            live={live}
          />
        </section>
      )}
    </div>
  );
}

/** The issues under a path prefix («enemies.3»), keyed by the path inside it, in Spanish. */
function issuesUnder(issues: { path: string; message: string }[], prefix: string, root: Value): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const i of issues) {
    if (prefix && i.path !== prefix && !i.path.startsWith(`${prefix}.`)) continue;
    const rel = prefix ? i.path.slice(prefix.length + 1) : i.path;
    out.set(rel, [...(out.get(rel) ?? []), issueText(i.message, root)]);
  }
  return out;
}

/** A list of things with ids: search, pictures, the chosen one's form, add, duplicate and remove. */
function EntityPanel({
  field,
  node,
  value,
  live,
  options,
  issues,
  selected,
  onSelect,
  onChange,
}: {
  field: string;
  node: JsonSchema;
  value: Value;
  live: Value;
  options: Options;
  issues: { path: string; message: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (list: Entity[]) => void;
}) {
  const list = (value[field] as Entity[] | undefined) ?? [];
  const item = unwrap(itemsOf(node)).node;
  const [query, setQuery] = useState('');
  const published = useMemo(() => liveIds(live), [live]);
  const isPublished = (id: string) => published.has(`${field}[]|${id}`);
  const noun = DESCRIPTORS[`${field}[]`]?.noun ?? DESCRIPTORS[`${field}[]`]?.label?.toLowerCase() ?? t.entry;
  const shown = list.filter((e) => !query.trim() || fold(`${e.name ?? ''} ${e.id}`).includes(fold(query.trim())));
  const index = list.findIndex((e) => e.id === selected);
  const current = index >= 0 ? list[index]! : null;
  const unique = (base: string) => {
    let id = base || 'nueva-entrada';
    for (let n = 2; list.some((e) => e.id === id); n++) id = `${base}-${n}`.slice(0, 32);
    return id;
  };
  const withIssues = new Set(issues.filter((i) => i.path.startsWith(`${field}.`)).map((i) => Number(i.path.split('.')[1])));

  return (
    <div className="ce-panel">
      <div className="lip panel ce-list">
        <input type="search" className="ce-search" aria-label={t.search} placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul role="listbox" aria-label={t.entities} className="ce-items">
          {shown.map((e) => {
            const thumb = thumbOf(field, e, value);
            const k = list.indexOf(e);
            return (
              <li key={`${e.id}-${k}`} role="option" aria-selected={e.id === selected} tabIndex={0} className={`ce-item${withIssues.has(k) ? ' bad' : ''}`} onClick={() => onSelect(e.id)} onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onSelect(e.id)}>
                {thumb ? <img src={thumb} alt="" width={32} height={32} /> : <span className="ce-thumb-empty" aria-hidden="true" />}
                <span className="ce-item-text">
                  <b>{e.name ?? e.id}</b>
                  <small>{e.id}</small>
                </span>
                {!isPublished(e.id) ? <span className="admin-chip ok">{t.isNew}</span> : null}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 ? <p className="panel-note">{t.noMatches}</p> : null}
        <button
          type="button"
          className="lip pill small"
          onClick={() => {
            const fresh = emptyOf(item) as Entity;
            const name = t.newEntity;
            const entity = { ...fresh, ...(typeof fresh.name === 'string' || 'name' in (item.properties ?? {}) ? { name } : {}), id: unique(slugOf(name)) };
            onChange([...list, entity]);
            onSelect(entity.id);
          }}
        >
          <Icon name="plus" />
          <span>{t.add(noun)}</span>
        </button>
      </div>
      <div className="ce-detail">
        {current ? (
          <section className="lip panel ce-entity" aria-labelledby="ce-entity-title">
            <header className="ce-entity-head">
              {thumbOf(field, current, value) ? <img src={thumbOf(field, current, value)!} alt="" width={48} height={48} /> : null}
              <h2 id="ce-entity-title">{current.name ?? current.id}</h2>
              <div className="ce-entity-tools">
                <button
                  type="button"
                  className="lip pill small"
                  aria-label={t.duplicate(current.name ?? current.id)}
                  onClick={() => {
                    const name = t.copyOf(current.name ?? current.id).slice(0, 60);
                    const copyOf = { ...structuredClone(current), name, id: unique(slugOf(name)) };
                    onChange([...list.slice(0, index + 1), copyOf, ...list.slice(index + 1)]);
                    onSelect(copyOf.id);
                  }}
                >
                  <Icon name="copy" />
                  <span>{t.duplicateShort}</span>
                </button>
                <button
                  type="button"
                  className="lip pill small danger"
                  aria-label={t.remove(current.name ?? current.id)}
                  disabled={isPublished(current.id)}
                  onClick={() => {
                    onChange(list.filter((_, k) => k !== index));
                    onSelect('');
                  }}
                >
                  <Icon name="trash" />
                  <span>{t.removeShort}</span>
                </button>
              </div>
            </header>
            {isPublished(current.id) ? <p className="panel-note">{t.publishedStays}</p> : null}
            <ConfigForm
              cfgKey="content"
              schema={item}
              value={current}
              onChange={(next) => onChange(list.map((e, k) => (k === index ? (next as Entity) : e)))}
              issues={issuesUnder(issues, `${field}.${index}`, value)}
              options={options}
              prefix={`${field}[]`}
              describe={describe}
              live={live}
            />
          </section>
        ) : (
          <p className="panel-note ce-pick">{t.pick}</p>
        )}
      </div>
    </div>
  );
}
