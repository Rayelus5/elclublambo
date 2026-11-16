import { type ConfigValue, configIssues, configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { ConfigForm, NumberInput, type Options, type Widgets } from '../forms/ConfigForm';
import { placeOf } from '../forms/humanDiff';
import { issueText } from '../forms/issues';
import { emptyOf, getIn, itemsOf, setIn, slugOf, unwrap } from '../forms/schema';
import { describeContent } from './descriptors';
import { uniqueId } from './ids';

// The «Crear…» wizards (the content editor, 2026-11-16, P9): a new entry of the run content in steps. First its name
// and what it is based on (a copy of a similar entry, so only what makes it different is changed); then one step per
// section of its fields (the descriptors' sections, the texts last); then what it needs to be part of the game — where
// an enemy comes out, in which sectors a Núcleo is a form, a weapon's evolution, a sector's or a probe's unlock and a
// sector's pay (those two in the sectors and probes keys, in the same draft) —; last, a review with its problems. It
// is added to the draft: publishing stays the draft's own step.

const t = copy.admin.content;
const w = t.wizard;
type Value = Record<string, unknown>;
type Entry = { id: string; name?: string } & Value;
type SectorEntry = { id: string; name: string; boss?: string; season?: boolean; bossCycle?: string[]; spawns?: Spawn[] } & Value;

export type WizardKind = 'enemigo' | 'pasiva' | 'reaccion' | 'anomalia' | 'conjunto' | 'nucleo' | 'sector' | 'arma' | 'sonda';
interface KindDef {
  id: keyof typeof w.title;
  /** Where its list is in the content. */
  path: string[];
  /** Where the editor shows it afterwards. */
  zona: string;
  lista?: string;
  /** What it needs besides its own fields. */
  needs?: 'spawns' | 'forms' | 'evolution' | 'sectorUnlock' | 'probeUnlock';
}
export const WIZARDS: Record<WizardKind, KindDef> = {
  enemigo: { id: 'enemy', path: ['enemies'], zona: 'fauna', lista: 'enemies', needs: 'spawns' },
  nucleo: { id: 'core', path: ['bosses'], zona: 'nucleos', lista: 'bosses', needs: 'forms' },
  sector: { id: 'sector', path: ['sectors'], zona: 'sectores', lista: 'sectors', needs: 'sectorUnlock' },
  arma: { id: 'weapon', path: ['weapons'], zona: 'arsenal', lista: 'weapons', needs: 'evolution' },
  sonda: { id: 'probe', path: ['probes'], zona: 'sondas', lista: 'probes', needs: 'probeUnlock' },
  pasiva: { id: 'passive', path: ['passives'], zona: 'arsenal', lista: 'passives' },
  reaccion: { id: 'reaction', path: ['elements', 'reactions'], zona: 'elementos' },
  anomalia: { id: 'anomaly', path: ['anomalies'], zona: 'reglas', lista: 'anomalies' },
  conjunto: { id: 'set', path: ['relics', 'sets'], zona: 'reliquias' },
};
export const isWizardKind = (k: string | null): k is WizardKind => !!k && Object.hasOwn(WIZARDS, k);

/** What a wizard writes in other keys of the draft (a sector's unlock and pay, a probe's unlock): entries to add. */
export interface CompanionField {
  key: 'sectors' | 'probes';
  field: string;
  patch: Record<string, unknown>;
}
export interface Companions {
  sectors: ConfigValue<'sectors'> | null;
  probes: ConfigValue<'probes'> | null;
}

type Spawn = { enemy: string; from: number; weight: number; group: [number, number] };
type Step = { id: string; label: string; keys?: string[] };
type SectorStat = 'bossKills' | 'maxDepth' | 'extractions';
type ProbeStat = 'runs' | 'bossKills' | 'maxDepth' | 'extractions' | 'kills';
const SECTOR_STATS: SectorStat[] = ['bossKills', 'maxDepth', 'extractions'];
const PROBE_STATS: ProbeStat[] = ['runs', 'bossKills', 'maxDepth', 'extractions', 'kills'];

/** The schema of one entry of the list at `path`. */
function itemSchema(path: string[]): JsonSchema {
  let node: JsonSchema = configJsonSchema('content');
  for (const k of path) node = unwrap(unwrap(node).node.properties?.[k] ?? {}).node;
  return unwrap(itemsOf(node)).node;
}
const entriesAt = (value: Value, path: string[]): Entry[] => {
  const at = getIn(value, path);
  return (Array.isArray(at) ? at : []).filter((x): x is Entry => !!x && typeof x === 'object' && typeof (x as Entry).id === 'string');
};

export function CreateWizard({
  kind,
  value,
  options,
  widgets,
  companions,
  onAdd,
  onCancel,
}: {
  kind: WizardKind;
  value: Value;
  options: Options;
  widgets: Widgets;
  /** The sectors and probes keys as the draft has them (live, with the draft's own changes). */
  companions: Companions;
  /** The draft with the new entry, where to see it, and what it writes in other keys. */
  onAdd: (next: Value, where: { zona: string; lista?: string; id: string }, extra: CompanionField[]) => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const def = WIZARDS[kind];
  const pattern = `${def.path.join('.')}[]`;
  const item = useMemo(() => itemSchema(def.path), [def.path]);
  const list = useMemo(() => entriesAt(value, def.path), [value, def.path]);
  const sectors = useMemo(() => entriesAt(value, ['sectors']) as SectorEntry[], [value]);
  const weapons = useMemo(() => entriesAt(value, ['weapons']), [value]);
  const passives = useMemo(() => entriesAt(value, ['passives']), [value]);
  const taken = (id: string) => list.some((e) => e.id === id);
  const [entry, setEntry] = useState<Entry>(() => ({ ...(emptyOf(item) as Entry), name: '', id: uniqueId('', taken) }));
  const [step, setStep] = useState('base');
  // An enemy's spawns, by sector; the sectors where a new Núcleo is a form.
  const [placed, setPlaced] = useState<Record<string, Spawn>>({});
  const [forms, setForms] = useState<string[]>([]);
  // A weapon's evolution: its name and the passive it asks for.
  const [evo, setEvo] = useState<{ name: string; passive: string; model: Entry | null }>({ name: '', passive: '', model: null });
  // A sector's unlock and pay, a probe's unlock.
  const normal = sectors.filter((s) => !s.season);
  const [unlock, setUnlock] = useState<{ sector: string; stat: string; value: number | undefined; pay: number | undefined }>(() => ({
    sector: normal.at(-1)?.id ?? '',
    stat: def.needs === 'probeUnlock' ? 'runs' : 'bossKills',
    value: def.needs === 'probeUnlock' ? 5 : 1,
    pay: 1,
  }));

  const steps: Step[] = useMemo(() => {
    const out: Step[] = [{ id: 'base', label: w.base }];
    // A new base weapon is neither an evolution nor a variant: its own evolution is a step of its own.
    const skip = new Set(['id', 'name', ...(def.needs === 'evolution' ? ['evolution', 'variant'] : [])]);
    const keys = Object.keys(item.properties ?? {}).filter((k) => !skip.has(k));
    if (keys.length === 0) out.push({ id: 'data', label: w.data });
    else {
      const sections = new Map<string, string[]>();
      for (const k of keys) {
        const section = describeContent(`${pattern}.${k}`)?.section ?? w.otherData;
        sections.set(section, [...(sections.get(section) ?? []), k]);
      }
      // In their order, the texts last: what it says comes once what it is and does is settled.
      const texts = t.textsSection;
      const ordered = [...sections].sort(([a], [b]) => Number(a === texts) - Number(b === texts));
      for (const [label, ks] of ordered) out.push({ id: `s:${label}`, label, keys: ks });
    }
    if (def.needs === 'spawns' || def.needs === 'forms') out.push({ id: 'placement', label: w.placement });
    if (def.needs === 'evolution') out.push({ id: 'evolution', label: w.evolution });
    if (def.needs === 'sectorUnlock' || def.needs === 'probeUnlock') out.push({ id: 'unlock', label: w.unlock });
    out.push({ id: 'review', label: w.review });
    return out;
  }, [item, pattern, def.needs]);

  // Where it goes in its list: a normal sector before the season's (the order of the sectors is their difficulty).
  const where = def.needs === 'sectorUnlock' && !entry.season ? (sectors.findIndex((s) => s.season) + 1 || sectors.length + 1) - 1 : list.length;
  // The weapon's evolution: its model's (a copy) or the weapon at its last level, one level, from the new weapon.
  const evolution: Entry | null = useMemo(() => {
    if (def.needs !== 'evolution' || !evo.name || !evo.passive) return null;
    const model = evo.model ? (structuredClone(evo.model) as Entry) : ({ ...structuredClone(entry), levels: [((entry.levels as unknown[]) ?? []).at(-1)].filter(Boolean) } as Entry);
    const rest: Entry = { ...model };
    delete rest.variant;
    const used = (id: string) => list.some((e) => e.id === id) || id === entry.id;
    return { ...rest, kind: entry.kind, name: evo.name, id: uniqueId(slugOf(evo.name), used), evolution: { from: entry.id, requires: { passive: evo.passive } } };
  }, [def.needs, evo, entry, list]);

  // The draft as it would be with the new entry and what it brings along.
  const next = useMemo(() => {
    const own = [...list.slice(0, where), entry, ...list.slice(where), ...(evolution ? [evolution] : [])];
    let doc = setIn(value, def.path, own) as Value;
    if (def.needs === 'spawns')
      doc = { ...doc, sectors: sectors.map((s) => (placed[s.id] ? { ...s, spawns: [...(Array.isArray(s.spawns) ? s.spawns : []), { ...placed[s.id]!, enemy: entry.id }] } : s)) };
    if (def.needs === 'forms')
      doc = { ...doc, sectors: sectors.map((s) => (forms.includes(s.id) ? { ...s, bossCycle: [...(s.bossCycle ?? (s.boss ? [s.boss] : [])), entry.id] } : s)) };
    return doc;
  }, [value, def.path, def.needs, list, where, entry, evolution, sectors, placed, forms]);

  const pathOf = (i: number) => `${def.path.join('.')}.${i}`;
  const at = pathOf(where);
  const evoAt = evolution ? pathOf(list.length + 1) : null;
  // What it brings along in the sectors: its own spawns and forms (a problem elsewhere in a sector is not its own).
  const ownPaths = useMemo(() => {
    const out: string[] = [];
    sectors.forEach((s, i) => {
      if (def.needs === 'spawns' && placed[s.id]) out.push(`sectors.${i}.spawns.${Array.isArray(s.spawns) ? s.spawns.length : 0}`);
      if (def.needs === 'forms' && forms.includes(s.id)) out.push(`sectors.${i}.bossCycle`);
    });
    return out;
  }, [sectors, def.needs, placed, forms]);
  // The checks run a moment behind the keys (the content is about 180 KB).
  const checked = useDeferredValue(next);
  const issues = useMemo(
    () =>
      configIssues('content', checked).filter(
        (i) =>
          i.path === at ||
          i.path.startsWith(`${at}.`) ||
          (evoAt && (i.path === evoAt || i.path.startsWith(`${evoAt}.`))) ||
          ownPaths.some((p) => i.path === p || i.path.startsWith(`${p}.`)),
      ),
    [checked, at, evoAt, ownPaths],
  );
  const mine = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const i of issues) {
      if (i.path !== at && !i.path.startsWith(`${at}.`)) continue;
      const rel = i.path === at ? '' : i.path.slice(at.length + 1);
      out.set(rel, [...(out.get(rel) ?? []), issueText(i.message, next)]);
    }
    return out;
  }, [issues, at, next]);

  // What is still missing for it to be part of the game.
  const missing: string[] = [];
  if (def.needs === 'spawns' && Object.keys(placed).length === 0) missing.push(w.needsPlacement);
  if (def.needs === 'forms' && forms.length === 0) missing.push(w.needsForms);
  if (def.needs === 'evolution' && !evolution) missing.push(w.needsEvolution);
  if (def.needs === 'sectorUnlock' && !entry.season && !unlock.sector) missing.push(w.needsUnlock);
  if ((def.needs === 'sectorUnlock' && !entry.season && !companions.sectors) || (def.needs === 'probeUnlock' && !companions.probes)) missing.push(w.needsCompanions);
  const countFor = (s: Step) => {
    if (s.id === 'review') return issues.length + missing.length;
    if (s.id === 'placement' || s.id === 'evolution' || s.id === 'unlock') return missing.length;
    return s.keys ? issues.filter((i) => s.keys!.some((k) => i.path === `${at}.${k}` || i.path.startsWith(`${at}.${k}.`))).length : 0;
  };
  const schema = configJsonSchema('content');

  function rename(name: string) {
    setEntry((e) => ({ ...e, name, id: uniqueId(slugOf(name), taken) }));
  }
  function base(from: string) {
    const source = list.find((e) => e.id === from);
    const start = source ? (structuredClone(source) as Entry) : (emptyOf(item) as Entry);
    // A copy says its own things (or the game's for it), and a new sector is a normal one.
    delete start.lore;
    delete start.radio;
    delete start.hazardNames;
    if (def.needs === 'sectorUnlock') start.season = false;
    setEntry({ ...start, name: entry.name, id: entry.id });
    if (def.needs === 'spawns' && source) {
      // Where the model comes out, the new one comes out too (a starting point; it can be changed).
      const own: Record<string, Spawn> = {};
      for (const s of sectors) {
        const sp = (Array.isArray(s.spawns) ? s.spawns : []).find((x) => x.enemy === source.id);
        if (sp) own[s.id] = structuredClone(sp);
      }
      if (Object.keys(own).length > 0) setPlaced(own);
    }
    if (def.needs === 'evolution' && source) {
      // The model's evolution, if it has one, is where the new one's starts.
      const model = weapons.find((x) => (x.evolution as { from?: string } | undefined)?.from === source.id) ?? null;
      const needs = (model?.evolution as { requires?: { passive?: string } } | undefined)?.requires?.passive ?? '';
      setEvo((e) => ({ ...e, model, passive: e.passive || needs }));
    }
  }
  function add() {
    const extra: CompanionField[] = [];
    const count = Math.max(1, Math.round(unlock.value ?? 1));
    if (def.needs === 'sectorUnlock' && !entry.season) {
      extra.push({ key: 'sectors', field: 'unlocks', patch: { [entry.id]: { sector: unlock.sector, stat: unlock.stat, value: count } } });
      extra.push({ key: 'sectors', field: 'pay', patch: { [entry.id]: Math.min(3, Math.max(0.1, unlock.pay ?? 1)) } });
    }
    if (def.needs === 'probeUnlock') extra.push({ key: 'probes', field: 'unlocks', patch: { [entry.id]: { stat: unlock.stat, value: count } } });
    onAdd(next, { zona: def.zona, lista: def.lista, id: entry.id }, extra);
  }
  const baseOptions = (def.needs === 'evolution' ? list.filter((e) => !e.evolution && !e.variant) : list).map((e) => ({
    value: e.id,
    label: e.name ?? e.id,
    image: options[def.path.join('.')]?.find((o) => o.value === e.id)?.image,
  }));
  const index = steps.findIndex((s) => s.id === step);
  const current = steps[index] ?? steps[0]!;
  const num = (v: string, min = 0) => Math.max(min, Number(v.replace(',', '.')) || 0);

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
          const n = countFor(s);
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
            <Select id={`${ids}-b`} size="sm" block value="" placeholder={w.fromScratch} options={baseOptions} onChange={base} />
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

      {current.id === 'placement' && def.needs === 'spawns' ? (
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
                        <input type="number" min={0} value={sp.from} onChange={(e) => setPlaced((p) => ({ ...p, [s.id]: { ...sp, from: num(e.target.value) } }))} />
                      </label>
                      <label>
                        {w.weight}
                        <input type="number" min={0} step={0.1} value={sp.weight} onChange={(e) => setPlaced((p) => ({ ...p, [s.id]: { ...sp, weight: num(e.target.value) } }))} />
                      </label>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {current.id === 'placement' && def.needs === 'forms' ? (
        <div className="ce-wizard-place">
          <p className="panel-note">{w.formsHint}</p>
          <ul>
            {sectors.map((s) => (
              <li key={s.id}>
                <label className="ce-ack">
                  <input type="checkbox" checked={forms.includes(s.id)} onChange={(e) => setForms((f) => (e.target.checked ? [...f, s.id] : f.filter((x) => x !== s.id)))} />
                  <span>{s.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {current.id === 'evolution' ? (
        <div className="cf-grid">
          <p className="panel-note ce-wizard-wide">{w.evolutionHint}</p>
          <div className="cf-field">
            <label htmlFor={`${ids}-en`}>{w.evolutionName}</label>
            <input id={`${ids}-en`} type="text" maxLength={60} value={evo.name} onChange={(e) => setEvo((x) => ({ ...x, name: e.target.value }))} />
            {evolution ? <small className="cf-hint">{w.id(evolution.id)}</small> : null}
          </div>
          <div className="cf-field">
            <label htmlFor={`${ids}-ep`}>{w.evolutionNeeds}</label>
            <Select
              id={`${ids}-ep`}
              size="sm"
              block
              value={evo.passive}
              placeholder={w.pickPassive}
              options={passives.map((p) => ({ value: p.id, label: p.name ?? p.id, image: options['passives']?.find((o) => o.value === p.id)?.image }))}
              onChange={(v) => setEvo((x) => ({ ...x, passive: v }))}
            />
          </div>
        </div>
      ) : null}

      {current.id === 'unlock' ? (
        <div className="cf-grid">
          <p className="panel-note ce-wizard-wide">{def.needs === 'sectorUnlock' ? w.sectorUnlockHint : w.probeUnlockHint}</p>
          {def.needs === 'sectorUnlock' ? (
            <div className="cf-field">
              <label htmlFor={`${ids}-us`}>{w.unlockAfter}</label>
              <Select id={`${ids}-us`} size="sm" block value={unlock.sector} options={normal.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setUnlock((u) => ({ ...u, sector: v }))} />
            </div>
          ) : null}
          <div className="cf-field">
            <label htmlFor={`${ids}-ut`}>{w.unlockStat}</label>
            <Select
              id={`${ids}-ut`}
              size="sm"
              block
              value={unlock.stat}
              options={(def.needs === 'sectorUnlock' ? SECTOR_STATS : PROBE_STATS).map((s) => ({ value: s, label: w.stats[s] }))}
              onChange={(v) => setUnlock((u) => ({ ...u, stat: v }))}
            />
          </div>
          <div className="cf-field">
            <label htmlFor={`${ids}-uv`}>{w.unlockValue}</label>
            <NumberInput id={`${ids}-uv`} value={unlock.value} info={{ label: w.unlockValue }} onChange={(v) => setUnlock((u) => ({ ...u, value: v }))} />
          </div>
          {def.needs === 'sectorUnlock' ? (
            <div className="cf-field">
              <label htmlFor={`${ids}-up`}>{w.pay}</label>
              <NumberInput id={`${ids}-up`} value={unlock.pay} info={{ label: w.pay, unit: 'factor' }} onChange={(v) => setUnlock((u) => ({ ...u, pay: v }))} />
              <small className="cf-hint">{w.payHint}</small>
            </div>
          ) : null}
        </div>
      ) : null}

      {current.id === 'review' ? (
        <div className="ce-wizard-review">
          {missing.map((m) => (
            <p key={m} className="field-error">
              {m}
            </p>
          ))}
          {issues.length === 0 && missing.length === 0 ? <p className="panel-note">{w.noProblems}</p> : null}
          {issues.length > 0 ? (
            <ul className="admin-issues">
              {issues.map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  <b>{placeOf('content', schema, next, i.path, describeContent) || i.path}</b> {issueText(i.message, next)}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="lip pill pill-solar" disabled={issues.length > 0 || missing.length > 0 || !entry.name} onClick={add}>
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
