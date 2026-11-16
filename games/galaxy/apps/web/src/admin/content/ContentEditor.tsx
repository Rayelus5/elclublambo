import { ART_FIELDS, configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { type Content, type ContentRef, type RefKind, usesOf } from '@galaxy/sim';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { ConfigForm, type Options, type Widgets } from '../forms/ConfigForm';
import { placeOf } from '../forms/humanDiff';
import { issueText } from '../forms/issues';
import { emptyOf, itemsOf, liveIds, slugOf, unwrap } from '../forms/schema';
import { artUrl } from './art';
import { AREAS, type AreaDesc, describeContent as describe, DESCRIPTORS, VOCABS } from './descriptors';
import { PhaseTimeline, ReactionMatrix, SpawnTimeline, WeightBars } from './Charts';
import { LevelTable } from './LevelTable';
import { SpritePicker } from './SpritePicker';
import { TEXT_PATTERNS, TextFallback } from './TextFallback';

// The content editor (2026-11-16, P4): the run content edited the way an admin thinks of it. Areas (Arsenal, Fauna,
// Núcleos…) hold their top-level fields; a list of things with ids (weapons, enemies, sectors…) is a searchable list
// beside the form of the chosen one, anything else a form of its own. Every field is named and explained by the
// descriptors; what is published cannot be removed. The view is in the address (zona, lista, id) so it can be shared.

const t = copy.admin.content;

type Entity = { id: string; name?: string } & Record<string, unknown>;
type Value = Record<string, unknown>;

/** Fields replaced by the editor's own controls: every drawing is picked from the gallery. */
const WIDGETS: Widgets = {
  ...Object.fromEntries(Object.keys(ART_FIELDS).map((p) => [p, SpritePicker])),
  'weapons[].levels': LevelTable,
  'bosses[].phases': PhaseTimeline,
  'sectors[].spawns': SpawnTimeline,
  'events.weights': WeightBars,
  'elements.reactions': ReactionMatrix,
  ...Object.fromEntries(TEXT_PATTERNS.map((p) => [p, TextFallback])),
};

/** The lists whose entries the content names elsewhere (refs): what is used cannot go. */
const REF_KINDS: Partial<Record<string, RefKind>> = { weapons: 'weapons', passives: 'passives', enemies: 'enemies', bosses: 'bosses' };

/** Where an entry is named, or nothing while the draft is not a whole content (its JSON being edited). */
function usesIn(value: Value, field: string, id: string): ContentRef[] {
  const kind = REF_KINDS[field];
  if (!kind) return [];
  try {
    return usesOf(value as unknown as Content, kind, id);
  } catch {
    return [];
  }
}

/** An entry of a list of things with ids (a draft's JSON may hold anything else, which is left out). */
const isEntity = (x: unknown): x is Entity => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string';
const entitiesOf = (v: unknown): Entity[] => (Array.isArray(v) ? v.filter(isEntity) : []);

/** A free id from `base`: itself, else «base-2», «base-3»… cut so it never passes 32 letters. */
export function uniqueId(base: string, taken: (id: string) => boolean): string {
  const root = (base || 'nueva-entrada').slice(0, 32);
  if (!taken(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = `${root.slice(0, 32 - suffix.length)}${suffix}`;
    if (!taken(id)) return id;
  }
}

const isEntityList = (v: unknown): v is Entity[] => Array.isArray(v) && v.length > 0 && v.every((x) => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');

/** Vocabularies of behaviours written in code: a new one is a programmer's job, which the choice says. */
const CODE_VOCABS = new Set(['weaponKind', 'special', 'quirk', 'behavior', 'bossPattern', 'reactionEffect', 'phenomenon', 'biome', 'eventKind', 'supportEffect']);

/** The choices the forms offer: every vocabulary (named and explained), and the draft's entities (named, drawn). */
function choicesOf(value: Value): Options {
  const out: Options = {};
  for (const [name, vocab] of Object.entries(VOCABS)) {
    out[`vocab:${name}`] = [
      ...Object.entries(vocab ?? {}).map(([v, term]) => ({ value: v, label: term.label, hint: term.explain })),
      ...(CODE_VOCABS.has(name) ? [{ value: '__code', label: t.needsCode, disabled: true }] : []),
    ];
  }
  for (const key of ['weapons', 'passives', 'enemies', 'bosses', 'sectors', 'probes', 'anomalies']) {
    const list = value[key];
    if (isEntityList(list)) out[key] = list.map((e) => ({ value: e.id, label: e.name ? `${e.name}` : e.id, image: thumbOf(key, e, value) ?? undefined }));
  }
  return out;
}

/** An entity's picture in the lists: its sprite or icon, or none. */
function thumbOf(key: string, e: Entity, value: Value): string | null {
  let id: unknown = e.sprite ?? e.icon;
  if (key === 'sectors') id = entitiesOf(value.bosses).find((b) => b.id === e.boss)?.sprite;
  return typeof id === 'string' ? artUrl(id, 2) : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The areas, and «Otros» for fields of the content no area names yet (never a key the content does not have). */
function areasFor(): AreaDesc[] {
  const placed = new Set(AREAS.flatMap((a) => a.keys as string[]));
  const rest = Object.keys(configJsonSchema('content').properties ?? {}).filter((k) => !placed.has(k));
  return rest.length ? [...AREAS, { id: 'otros', title: t.others, summary: t.othersSummary, icon: 'list', keys: rest as AreaDesc['keys'] }] : [...AREAS];
}

export function ContentEditor({ value, live, onChange, issues }: { value: Value; live: Value; onChange: (next: Value) => void; issues: { path: string; message: string }[] }) {
  const [params, setParams] = useSearchParams();
  const schema = configJsonSchema('content');
  const areas = useMemo(() => areasFor(), []);
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
            widgets={WIDGETS}
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
  const list = entitiesOf(value[field]);
  const item = unwrap(itemsOf(node)).node;
  const [query, setQuery] = useState('');
  // The ids this editor made (a new entry, a copy): they follow the entry's name until someone writes one by hand.
  const [autoIds] = useState(() => new Set<string>());
  const published = useMemo(() => liveIds(live), [live]);
  const isPublished = (id: string) => published.has(`${field}[]|${id}`);
  const noun = DESCRIPTORS[`${field}[]`]?.noun ?? DESCRIPTORS[`${field}[]`]?.label?.toLowerCase() ?? t.entry;
  const shown = list.filter((e) => !query.trim() || fold(`${e.name ?? ''} ${e.id}`).includes(fold(query.trim())));
  const index = list.findIndex((e) => e.id === selected);
  const current = index >= 0 ? list[index]! : null;
  const uses = current ? usesIn(value, field, current.id) : [];
  const schema = configJsonSchema('content');
  const unique = (base: string) => {
    const id = uniqueId(base, (x) => list.some((e) => e.id === x));
    autoIds.add(id);
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
                  disabled={isPublished(current.id) || uses.length > 0}
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
            {isPublished(current.id) ? <p className="panel-note">{t.publishedStays}</p> : uses.length > 0 ? <p className="panel-note">{t.usedStays}</p> : null}
            {REF_KINDS[field] ? (
              uses.length === 0 ? (
                <p className="panel-note ce-uses">{t.unused}</p>
              ) : (
                <details className="ce-uses">
                  <summary>{t.usedIn(uses.length)}</summary>
                  <ul>
                    {uses.map((r) => (
                      <li key={r.path.join('.')}>{placeOf('content', schema, value, r.path.join('.'), describe)}</li>
                    ))}
                  </ul>
                </details>
              )
            ) : null}
            <ConfigForm
              cfgKey="content"
              schema={item}
              value={current}
              onChange={(next) => {
                const entity = next as Entity;
                onChange(list.map((e, k) => (k === index ? entity : e)));
                // A new entry's id follows its name, or is written by hand: the panel follows it.
                if (entity.id !== current.id) onSelect(entity.id);
              }}
              autoIds={autoIds}
              issues={issuesUnder(issues, `${field}.${index}`, value)}
              options={options}
              prefix={`${field}[]`}
              describe={describe}
              widgets={WIDGETS}
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
