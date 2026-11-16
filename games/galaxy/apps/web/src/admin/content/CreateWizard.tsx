import { configIssues, configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { useId, useMemo, useState } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { ConfigForm, type Options, type Widgets } from '../forms/ConfigForm';
import { placeOf } from '../forms/humanDiff';
import { issueText } from '../forms/issues';
import { emptyOf, getIn, itemsOf, setIn, slugOf, unwrap } from '../forms/schema';
import { describeContent } from './descriptors';
import { uniqueId } from './ids';

// The «Crear…» wizards (the content editor, 2026-11-16, P9a): a new enemy, passive, reaction, anomaly or relic set in
// steps. First its name and what it is based on (a copy of a similar entry, so only what makes it different is
// changed); then one step per section of its fields (the descriptors' sections); an enemy also says where it comes
// out; last, a review with its problems. It is added to the draft — publishing stays the draft's own step.

const t = copy.admin.content;
const w = t.wizard;
type Value = Record<string, unknown>;
type Entry = { id: string; name?: string } & Value;

export type WizardKind = 'enemigo' | 'pasiva' | 'reaccion' | 'anomalia' | 'conjunto';
interface KindDef {
  id: keyof typeof w.title;
  /** Where its list is in the content. */
  path: string[];
  /** Where the editor shows it afterwards. */
  zona: string;
  lista?: string;
  /** An enemy says in which sectors it comes out. */
  placement?: boolean;
}
export const WIZARDS: Record<WizardKind, KindDef> = {
  enemigo: { id: 'enemy', path: ['enemies'], zona: 'fauna', lista: 'enemies', placement: true },
  pasiva: { id: 'passive', path: ['passives'], zona: 'arsenal', lista: 'passives' },
  reaccion: { id: 'reaction', path: ['elements', 'reactions'], zona: 'elementos' },
  anomalia: { id: 'anomaly', path: ['anomalies'], zona: 'reglas', lista: 'anomalies' },
  conjunto: { id: 'set', path: ['relics', 'sets'], zona: 'reliquias' },
};
export const isWizardKind = (k: string | null): k is WizardKind => !!k && Object.hasOwn(WIZARDS, k);

type Spawn = { enemy: string; from: number; weight: number; group: [number, number] };
type Step = { id: string; label: string; keys?: string[] };

/** The schema of one entry of the list at `path`. */
function itemSchema(path: string[]): JsonSchema {
  let node: JsonSchema = configJsonSchema('content');
  for (const k of path) node = unwrap(unwrap(node).node.properties?.[k] ?? {}).node;
  return unwrap(itemsOf(node)).node;
}

export function CreateWizard({
  kind,
  value,
  options,
  widgets,
  onAdd,
  onCancel,
}: {
  kind: WizardKind;
  value: Value;
  options: Options;
  widgets: Widgets;
  /** The draft with the new entry, and where to see it. */
  onAdd: (next: Value, where: { zona: string; lista?: string; id: string }) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const def = WIZARDS[kind];
  const pattern = `${def.path.join('.')}[]`;
  const item = useMemo(() => itemSchema(def.path), [def.path]);
  const list = useMemo(() => {
    const at = getIn(value, def.path);
    return (Array.isArray(at) ? at : []).filter((x): x is Entry => !!x && typeof x === 'object' && typeof (x as Entry).id === 'string');
  }, [value, def.path]);
  const sectors = useMemo(() => (Array.isArray(value.sectors) ? (value.sectors as ({ id: string; name: string; spawns?: Spawn[] } & Value)[]) : []), [value.sectors]);
  const taken = (id: string) => list.some((e) => e.id === id);
  const [entry, setEntry] = useState<Entry>(() => ({ ...(emptyOf(item) as Entry), name: '', id: uniqueId('', taken) }));
  const [placed, setPlaced] = useState<Record<string, Spawn>>({});
  const [step, setStep] = useState('base');

  // One step per section of its fields (all in one when the entry is a choice of shapes, like a relic set).
  const steps: Step[] = useMemo(() => {
    const out: Step[] = [{ id: 'base', label: w.base }];
    const keys = Object.keys(item.properties ?? {}).filter((k) => k !== 'id' && k !== 'name');
    if (keys.length === 0) out.push({ id: 'data', label: w.data });
    else {
      const sections = new Map<string, string[]>();
      for (const k of keys) {
        const section = describeContent(`${pattern}.${k}`)?.section ?? w.otherData;
        sections.set(section, [...(sections.get(section) ?? []), k]);
      }
      // In their order, the texts last: what it says comes once what it is and does is settled.
      const texts = copy.admin.content.textsSection;
      const ordered = [...sections].sort(([a], [b]) => Number(a === texts) - Number(b === texts));
      for (const [label, ks] of ordered) out.push({ id: `s:${label}`, label, keys: ks });
    }
    if (def.placement) out.push({ id: 'placement', label: w.placement });
    out.push({ id: 'review', label: w.review });
    return out;
  }, [item, pattern, def.placement]);

  // The draft as it would be: the new entry at the end of its list, and its spawns in the sectors chosen.
  const next = useMemo(() => {
    let doc = setIn(value, def.path, [...list, entry]) as Value;
    if (def.placement) {
      doc = {
        ...doc,
        sectors: sectors.map((s) => (placed[s.id] ? { ...s, spawns: [...(Array.isArray(s.spawns) ? s.spawns : []), { ...placed[s.id]!, enemy: entry.id }] } : s)),
      };
    }
    return doc;
  }, [value, def.path, def.placement, list, entry, sectors, placed]);
  const at = `${def.path.join('.')}.${list.length}`;
  const issues = useMemo(() => configIssues('content', next).filter((i) => i.path === at || i.path.startsWith(`${at}.`) || (def.placement && i.path.startsWith('sectors.') && i.path.includes('.spawns.'))), [next, at, def.placement]);
  const mine = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const i of issues) {
      if (!i.path.startsWith(at)) continue;
      const rel = i.path === at ? '' : i.path.slice(at.length + 1);
      out.set(rel, [...(out.get(rel) ?? []), issueText(i.message, next)]);
    }
    return out;
  }, [issues, at, next]);
  const unplaced = !!def.placement && Object.keys(placed).length === 0;
  const countFor = (s: Step) => (s.keys ? issues.filter((i) => s.keys!.some((k) => i.path === `${at}.${k}` || i.path.startsWith(`${at}.${k}.`))).length : 0);
  const schema = configJsonSchema('content');

  function rename(name: string) {
    setEntry((e) => ({ ...e, name, id: uniqueId(slugOf(name), taken) }));
  }
  function base(from: string) {
    const source = list.find((e) => e.id === from);
    const start = source ? (structuredClone(source) as Entry) : (emptyOf(item) as Entry);
    setEntry({ ...start, name: entry.name, id: entry.id });
    if (def.placement && source) {
      // Where the model comes out, the new one comes out too (a starting point; it can be changed).
      const own: Record<string, Spawn> = {};
      for (const s of sectors) {
        const sp = (Array.isArray(s.spawns) ? s.spawns : []).find((x) => x.enemy === source.id);
        if (sp) own[s.id] = structuredClone(sp);
      }
      if (Object.keys(own).length > 0) setPlaced(own);
    }
  }
  const index = steps.findIndex((s) => s.id === step);
  const current = steps[index] ?? steps[0]!;

  return (
    <section className="lip panel ce-wizard" aria-labelledby={`${ids}-t`}>
      <header className="ce-wizard-head">
        <h2 id={`${ids}-t`}>{w.title[def.id]}</h2>
        <button type="button" className="lip pill small" onClick={onCancel}>
          <Icon name="back" />
          <span>{w.cancel}</span>
        </button>
      </header>
      <div className="tabs admin-tabs ce-wizard-steps" role="tablist" aria-label={w.steps}>
        {steps.map((s) => {
          const n = s.id === 'review' ? issues.length + (unplaced ? 1 : 0) : s.id === 'placement' ? (unplaced ? 1 : 0) : countFor(s);
          return (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === current.id} onClick={() => setStep(s.id)}>
              {s.label}
              {n > 0 ? <span className="admin-chip bad">{n}</span> : null}
            </button>
          );
        })}
      </div>

      {current.id === 'base' ? (
        <div className="cf-grid">
          <div className="cf-field">
            <label htmlFor={`${ids}-n`}>{w.name}</label>
            <input id={`${ids}-n`} type="text" maxLength={60} value={entry.name ?? ''} onChange={(e) => rename(e.target.value)} />
            <small className="cf-hint">{w.id(entry.id)}</small>
          </div>
          <div className="cf-field">
            <label htmlFor={`${ids}-b`}>{w.basedOn}</label>
            <Select
              id={`${ids}-b`}
              size="sm"
              block
              value=""
              placeholder={w.fromScratch}
              options={list.map((e) => ({ value: e.id, label: e.name ?? e.id, image: options[def.path.join('.')]?.find((o) => o.value === e.id)?.image }))}
              onChange={base}
            />
            <small className="cf-hint">{w.basedOnHint}</small>
          </div>
        </div>
      ) : null}

      {current.id === 'data' || current.keys ? (
        <ConfigForm
          cfgKey="content"
          schema={current.keys ? { ...item, properties: Object.fromEntries(current.keys.map((k) => [k, item.properties![k]!])), required: item.required?.filter((k) => current.keys!.includes(k)) } : item}
          value={entry}
          onChange={(v) => setEntry(v as Entry)}
          issues={mine}
          options={options}
          prefix={pattern}
          describe={describeContent}
          widgets={widgets}
        />
      ) : null}

      {current.id === 'placement' ? (
        <div className="ce-wizard-place">
          <p className="panel-note">{w.placementHint}</p>
          <ul>
            {sectors.map((s) => {
              const sp = placed[s.id];
              return (
                <li key={s.id}>
                  <label className="ce-ack">
                    <input
                      type="checkbox"
                      checked={!!sp}
                      onChange={(e) =>
                        setPlaced((p) => {
                          const copyOf = { ...p };
                          if (e.target.checked) copyOf[s.id] = { enemy: entry.id, from: 0, weight: 1, group: [1, 3] };
                          else delete copyOf[s.id];
                          return copyOf;
                        })
                      }
                    />
                    <span>{s.name}</span>
                  </label>
                  {sp ? (
                    <span className="ce-wizard-spawn">
                      <label>
                        {w.from}
                        <input type="number" min={0} value={sp.from} onChange={(e) => setPlaced((p) => ({ ...p, [s.id]: { ...sp, from: Math.max(0, Number(e.target.value) || 0) } }))} />
                      </label>
                      <label>
                        {w.weight}
                        <input type="number" min={0} step={0.1} value={sp.weight} onChange={(e) => setPlaced((p) => ({ ...p, [s.id]: { ...sp, weight: Math.max(0, Number(e.target.value) || 0) } }))} />
                      </label>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {current.id === 'review' ? (
        <div className="ce-wizard-review">
          {unplaced ? <p className="field-error">{w.needsPlacement}</p> : null}
          {issues.length === 0 && !unplaced ? <p className="panel-note">{w.noProblems}</p> : null}
          {issues.length > 0 ? (
            <ul className="admin-issues">
              {issues.map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  <b>{placeOf('content', schema, next, i.path, describeContent) || i.path}</b> {issueText(i.message, next)}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="lip pill pill-solar" disabled={issues.length > 0 || unplaced || !entry.name} onClick={() => onAdd(next, { zona: def.zona, lista: def.lista, id: entry.id })}>
            <Icon name="plus" />
            <span>{w.add}</span>
          </button>
        </div>
      ) : (
        <div className="ce-wizard-nav">
          {index > 0 ? (
            <button type="button" className="lip pill small" onClick={() => setStep(steps[index - 1]!.id)}>
              {w.prev}
            </button>
          ) : null}
          <button type="button" className="lip pill small" onClick={() => setStep(steps[index + 1]!.id)}>
            {w.next}
          </button>
        </div>
      )}
    </section>
  );
}
