import type { ConfigKey, JsonSchema } from '@galaxy/shared';
import { createContext, type ReactNode, useContext, useId, useState } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { fmtNumber, fmtUtc, fromLocalInput, itemSummary, scaleOf, tidy, toLocalInput } from './format';
import { type FieldInfo, fieldInfo, itemName, UNIT_SUFFIX, valueName } from './labels';
import { discriminatorOf, emptyOf, getIn, kindOf, liveIds, optionOf, parseNumber, type Path, pathKey, setIn, slugOf, unwrap } from './schema';

// A config key as a form (polish phase 4), drawn from its JSON Schema: numbers with their unit and range, switches,
// choices with Spanish names, dates in the admin's time, lists of cards (add, duplicate, move, remove), named entries,
// and the kind of an effect choosing its fields. Each field shows its own problems; the checks across fields show on
// their group.

export type Option = { value: string; label: string };
export type Options = Partial<Record<'anomalies' | 'sectors' | 'probes', Option[]>>;

interface Ctx {
  cfgKey: ConfigKey;
  root: unknown;
  set: (path: Path, value: unknown) => void;
  issues: Map<string, string[]>;
  options: Options;
  /** The ids this form wrote from a name: they keep following it until published. */
  autoIds: Set<string>;
  /** The ids published, by list («list[]|fisura»): shown, never changed. */
  locked: Set<string>;
}
const FormCtx = createContext<Ctx | null>(null);
const useForm = () => useContext(FormCtx)!;

function Problems({ path }: { path: Path }) {
  const list = useForm().issues.get(pathKey(path));
  if (!list?.length) return null;
  return (
    <ul className="cf-problems" role="alert">
      {list.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  );
}


function rangeHint(node: JsonSchema, info: FieldInfo): string | null {
  const lo = node.minimum ?? node.exclusiveMinimum;
  const hi = node.maximum ?? node.exclusiveMaximum;
  // Huge technical caps say nothing to an admin.
  if (lo === undefined || hi === undefined || hi >= 1_000_000) return null;
  const s = scaleOf(info);
  return `De ${fmtNumber(tidy(lo * s))} a ${fmtNumber(tidy(hi * s))}`;
}

/** A number typed in Spanish (comma or point), kept as text while it is being typed. */
function NumberInput({ id, value, info, onChange, label, invalid }: { id: string; value: unknown; info: FieldInfo; onChange: (v: number | undefined) => void; label?: string; invalid?: boolean }) {
  const s = scaleOf(info);
  const shown = typeof value === 'number' ? String(tidy(value * s)).replace('.', ',') : '';
  const [text, setText] = useState(shown);
  const [seen, setSeen] = useState(shown);
  // A value changed from outside (a version loaded, an item moved) replaces what is typed.
  if (shown !== seen) {
    setSeen(shown);
    setText(shown);
  }
  const suffix = info.unit ? UNIT_SUFFIX[info.unit] : null;
  return (
    <span className="cf-number">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = parseNumber(raw);
          const next = parsed === undefined ? undefined : tidy(parsed / s);
          setSeen(typeof next === 'number' ? String(tidy(next * s)).replace('.', ',') : '');
          onChange(next);
        }}
      />
      {suffix ? <span className="cf-suffix">{suffix}</span> : null}
    </span>
  );
}

function Toggle({ id, on, onChange, label }: { id: string; on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={on} aria-label={label} className={`admin-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <span aria-hidden="true" />
    </button>
  );
}

/** One scalar field: label, control, hint and its problems. */
function Scalar({ node, path, pattern, optional }: { node: JsonSchema; path: Path; pattern: string; optional: boolean }) {
  const { cfgKey, root, set, options, issues, autoIds, locked } = useForm();
  const id = useId();
  const info = fieldInfo(cfgKey, pattern);
  const invalid = issues.has(pathKey(path));
  const { node: n, nullable } = unwrap(node);
  const kind = kindOf(n);
  const value = getIn(root, path);
  const parentPath = path.slice(0, -1);
  // The pattern of the item this field belongs to («list[].goals[]»), where its id is known as published or not.
  const itemPattern = pattern.slice(0, pattern.lastIndexOf('.'));
  const isLocked = (id: unknown) => typeof id === 'string' && locked.has(`${itemPattern}|${id}`);
  const change = (v: unknown) => {
    // The id of a new item follows its name until someone writes it by hand. A published id never moves: it names
    // what players already have (claims, progress, pity).
    const parent = getIn(root, parentPath) as Record<string, unknown> | undefined;
    const follows = path.at(-1) === 'name' && typeof v === 'string' && parent && typeof parent.id === 'string' && !isLocked(parent.id) && (parent.id === '' || autoIds.has(parent.id));
    if (follows) {
      const id = slugOf(v);
      autoIds.add(id);
      set(parentPath, { ...parent, name: v, id });
    } else set(path, v);
  };
  // A published id is shown as it is.
  if (path.at(-1) === 'id' && isLocked(value)) {
    return (
      <div className="cf-field cf-k-fixed">
        <span className="cf-label">{info.label}</span>
        <span className="cf-locked">
          <Icon name="lock" />
          <span>{String(value)}</span>
        </span>
        <small className="cf-hint">{copy.admin.config.idLocked}</small>
      </div>
    );
  }
  const choices = info.options ? options[info.options] : undefined;
  let control: ReactNode;
  let hint = info.hint ?? null;

  if (kind === 'boolean') control = <Toggle id={id} on={value === true} onChange={change} label={info.label} />;
  else if (kind === 'number') {
    control = <NumberInput id={id} value={value} info={info} onChange={change} invalid={invalid} />;
    hint = hint ?? rangeHint(n, info);
  } else if (kind === 'enum' || choices) {
    const list: Option[] = choices ?? (n.enum ?? []).map((v) => ({ value: String(v), label: valueName(v) }));
    const known = list.some((o) => o.value === value) || value === null || value === undefined;
    control = (
      <Select
        id={id}
        size="sm"
        block
        value={value === null || value === undefined ? '' : String(value)}
        options={[
          ...(nullable || optional ? [{ value: '', label: 'Ninguno' }] : []),
          ...(!known ? [{ value: String(value), label: String(value) }] : []),
          ...list,
        ]}
        onChange={(v) => change(v === '' ? (nullable ? null : undefined) : v)}
      />
    );
  } else if (kind === 'datetime') {
    const iso = typeof value === 'string' ? value : '';
    control = <input id={id} type="datetime-local" value={iso ? toLocalInput(iso) : ''} onChange={(e) => change(fromLocalInput(e.target.value))} />;
    hint = iso ? `En UTC: ${fmtUtc(iso)}` : hint;
  } else if (kind === 'fixed') control = <output id={id}>{valueName(n.const)}</output>;
  else {
    const isId = n.pattern === '^[a-z0-9-]{1,32}$';
    control = (
      <input
        id={id}
        type="text"
        value={typeof value === 'string' ? value : ''}
        maxLength={n.maxLength}
        spellCheck={!isId}
        onChange={(e) => {
          const raw = isId ? e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') : e.target.value;
          change(raw === '' && (nullable || optional) ? (nullable ? null : undefined) : raw);
        }}
      />
    );
  }
  return (
    <div className={`cf-field cf-k-${kind}`}>
      <label htmlFor={id}>{info.label}</label>
      {control}
      {hint ? <small className="cf-hint">{hint}</small> : null}
      {optional && value !== undefined && kind !== 'enum' && !choices ? (
        <button type="button" className="cf-link" onClick={() => change(undefined)}>
          Quitar {info.label.toLowerCase()}
        </button>
      ) : null}
      <Problems path={path} />
    </div>
  );
}

/** A fixed row of numbers (one per rarity, per level…) or a growing one. */
function Row({ node, path, pattern }: { node: JsonSchema; path: Path; pattern: string }) {
  const { cfgKey, root, set } = useForm();
  const id = useId();
  const info = fieldInfo(cfgKey, pattern);
  const value = (getIn(root, path) as unknown[] | undefined) ?? [];
  const item = unwrap(node.items ?? {}).node;
  const fixed = node.minItems !== undefined && node.minItems === node.maxItems;
  return (
    <fieldset className="cf-field cf-row">
      <legend>{info.label}</legend>
      <div className="cf-row-items">
        {value.map((v, i) => {
          const name = itemName(info, i) ?? `${i + 1}`;
          return (
            <span key={i} className="cf-row-item">
              <small>{name}</small>
              <NumberInput id={`${id}-${i}`} value={v} info={info} label={`${info.label}: ${name}`} onChange={(x) => set([...path, i], x)} />
            </span>
          );
        })}
        {!fixed ? (
          <span className="cf-row-tools">
            <button type="button" className="cf-icon-btn" aria-label={`Añadir a ${info.label}`} disabled={node.maxItems !== undefined && value.length >= node.maxItems} onClick={() => set(path, [...value, value.at(-1) ?? emptyOf(item)])}>
              <Icon name="plus" />
            </button>
            <button type="button" className="cf-icon-btn" aria-label={`Quitar el último de ${info.label}`} disabled={value.length <= (node.minItems ?? 0)} onClick={() => set(path, value.slice(0, -1))}>
              <Icon name="trash" />
            </button>
          </span>
        ) : null}
      </div>
      {info.hint ? <small className="cf-hint">{info.hint}</small> : null}
      <Problems path={path} />
    </fieldset>
  );
}

/** Words, one per line. */
function Words({ path, pattern }: { path: Path; pattern: string }) {
  const { cfgKey, root, set } = useForm();
  const id = useId();
  const info = fieldInfo(cfgKey, pattern);
  const value = (getIn(root, path) as string[] | undefined) ?? [];
  const [text, setText] = useState(value.join('\n'));
  const [seen, setSeen] = useState(value.join('\n'));
  const shown = value.join('\n');
  if (shown !== seen) {
    setSeen(shown);
    setText(shown);
  }
  return (
    <div className="cf-field cf-words">
      <label htmlFor={id}>{info.label}</label>
      <textarea
        id={id}
        rows={Math.min(10, Math.max(3, value.length + 1))}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.split('\n').map((w) => w.trim()).filter(Boolean);
          setSeen(next.join('\n'));
          set(path, next);
        }}
      />
      {info.hint ? <small className="cf-hint">{info.hint}</small> : null}
      <Problems path={path} />
    </div>
  );
}

/** The fields of an object: scalars side by side, groups and lists across. */
function Fields({ node, path, pattern }: { node: JsonSchema; path: Path; pattern: string }) {
  const { root, set, cfgKey } = useForm();
  const value = getIn(root, path) as Record<string, unknown> | undefined;
  return (
    <div className="cf-grid">
      {Object.entries(node.properties ?? {}).map(([k, child]) => {
        const p = [...path, k];
        const pat = pattern ? `${pattern}.${k}` : k;
        const optional = !node.required?.includes(k) && child.default === undefined && unwrap(child).node.default === undefined;
        // An optional group or date not set: a button adds it.
        if (optional && value?.[k] === undefined && kindOf(unwrap(child).node) !== 'enum') {
          const info = fieldInfo(cfgKey, pat);
          return (
            <div key={k} className="cf-field cf-absent">
              <span className="cf-absent-label">{info.label}</span>
              <button type="button" className="lip pill small" onClick={() => set(p, emptyOf(child))}>
                <Icon name="plus" />
                <span>Añadir</span>
              </button>
            </div>
          );
        }
        return <Node key={k} node={child} path={p} pattern={pat} optional={optional} />;
      })}
    </div>
  );
}

function Group({ node, path, pattern, optional }: { node: JsonSchema; path: Path; pattern: string; optional: boolean }) {
  const { cfgKey, set } = useForm();
  const info = fieldInfo(cfgKey, pattern);
  return (
    <fieldset className="cf-group">
      <legend>{info.label}</legend>
      {info.hint ? <p className="cf-hint">{info.hint}</p> : null}
      <Problems path={path} />
      <Fields node={node} path={path} pattern={pattern} />
      {optional ? (
        <button type="button" className="lip pill small cf-remove-group" onClick={() => set(path, undefined)}>
          <Icon name="trash" />
          <span>Quitar {info.label.toLowerCase()}</span>
        </button>
      ) : null}
    </fieldset>
  );
}

function Variant({ node, path, pattern }: { node: JsonSchema; path: Path; pattern: string }) {
  const { cfgKey, root, set } = useForm();
  const id = useId();
  const info = fieldInfo(cfgKey, pattern);
  const value = getIn(root, path) as Record<string, unknown> | undefined;
  const d = discriminatorOf(node);
  const option = optionOf(node, value);
  if (!d || !option) return null;
  const rest = { ...option, properties: Object.fromEntries(Object.entries(option.properties ?? {}).filter(([k]) => k !== d)) };
  return (
    <fieldset className="cf-group">
      <legend>{info.label}</legend>
      <div className="cf-grid">
        <div className="cf-field cf-k-enum">
          <label htmlFor={id}>{fieldInfo(cfgKey, `${pattern}.${d}`).label}</label>
          <Select
            id={id}
            size="sm"
            block
            value={String(value?.[d] ?? '')}
            options={node.oneOf!.map((o) => ({ value: String(o.properties![d]!.const), label: valueName(o.properties![d]!.const) }))}
            onChange={(v) => set(path, emptyOf(node.oneOf!.find((o) => o.properties?.[d]?.const === v)!))}
          />
        </div>
      </div>
      {Object.keys(rest.properties).length ? <Fields node={rest} path={path} pattern={pattern} /> : null}
      <Problems path={path} />
    </fieldset>
  );
}

function List({ node, path, pattern }: { node: JsonSchema; path: Path; pattern: string }) {
  const { cfgKey, root, set, issues } = useForm();
  const info = fieldInfo(cfgKey, pattern);
  const value = (getIn(root, path) as unknown[] | undefined) ?? [];
  const item = node.items ?? {};
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) => setOpen((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])));
  const move = (i: number, by: number) => {
    const next = [...value];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set(path, next);
    setOpen(new Set());
  };
  const full = node.maxItems !== undefined && value.length >= node.maxItems;
  // Items named by their place (levels, ranks) are only added or removed at the end; the rest move freely.
  const positional = !!info.items;
  const fixed = node.minItems !== undefined && node.minItems === node.maxItems;
  const noun = info.noun ?? 'elemento';
  const withId = (x: unknown) => {
    // A copy needs its own id (a new item gets it from its name).
    if (!x || typeof x !== 'object' || typeof (x as { id?: unknown }).id !== 'string' || !(x as { id: string }).id) return x;
    const base = (x as { id: string }).id.replace(/-\d+$/, '');
    const taken = new Set(value.map((v) => (v as { id?: string })?.id));
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return { ...(x as object), id: `${base}-${n}`.slice(0, 32) };
  };
  return (
    <section className="cf-list" aria-label={info.label}>
      <header className="cf-list-head">
        <h4>{info.label}</h4>
        <span className="cf-count">{value.length}</span>
      </header>
      {info.hint ? <p className="cf-hint">{info.hint}</p> : null}
      <Problems path={path} />
      <ol>
        {value.map((x, i) => {
          const name = itemSummary(info, x, i);
          const hasProblems = [...issues.keys()].some((k) => k === pathKey([...path, i]) || k.startsWith(`${pathKey([...path, i])}.`));
          return (
            <li key={i} className={`cf-card${open.has(i) ? ' open' : ''}${hasProblems ? ' bad' : ''}`}>
              <div className="cf-card-head">
                <button type="button" className="cf-card-title" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
                  <Icon name={open.has(i) ? 'up' : 'down'} />
                  <span>{name}</span>
                  {hasProblems ? <Icon name="alert" label="Tiene problemas" /> : null}
                </button>
                {!positional ? (
                  <span className="cf-card-tools">
                    <button type="button" className="cf-icon-btn" aria-label={`Subir ${name}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" />
                    </button>
                    <button type="button" className="cf-icon-btn" aria-label={`Bajar ${name}`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                      <Icon name="down" />
                    </button>
                    <button
                      type="button"
                      className="cf-icon-btn"
                      aria-label={`Duplicar ${name}`}
                      disabled={full}
                      onClick={() => {
                        set(path, [...value.slice(0, i + 1), withId(structuredClone(x)), ...value.slice(i + 1)]);
                        setOpen(new Set([i + 1]));
                      }}
                    >
                      <Icon name="copy" />
                    </button>
                    <button
                      type="button"
                      className="cf-icon-btn danger"
                      aria-label={`Quitar ${name}`}
                      disabled={value.length <= (node.minItems ?? 0)}
                      onClick={() => {
                        set(path, value.filter((_, j) => j !== i));
                        setOpen(new Set());
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </span>
                ) : !fixed && i === value.length - 1 && value.length > (node.minItems ?? 0) ? (
                  <span className="cf-card-tools">
                    <button type="button" className="cf-icon-btn danger" aria-label={`Quitar ${name}`} onClick={() => set(path, value.slice(0, -1))}>
                      <Icon name="trash" />
                    </button>
                  </span>
                ) : null}
              </div>
              {open.has(i) ? (
                <div className="cf-card-body">
                  <Node node={item} path={[...path, i]} pattern={`${pattern}[]`} optional={false} bare />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {!fixed ? (
        <button
          type="button"
          className="lip pill small cf-add"
          disabled={full}
          onClick={() => {
            set(path, [...value, withId(emptyOf(item))]);
            setOpen(new Set([value.length]));
          }}
        >
          <Icon name="plus" />
          <span>Añadir {noun}</span>
        </button>
      ) : null}
    </section>
  );
}

function Record_({ node, path, pattern }: { node: JsonSchema; path: Path; pattern: string }) {
  const { cfgKey, root, set, options } = useForm();
  const id = useId();
  const info = fieldInfo(cfgKey, pattern);
  const value = (getIn(root, path) as Record<string, unknown> | undefined) ?? {};
  const child = node.additionalProperties as JsonSchema;
  const choices: Option[] =
    (info.options ? options[info.options] : undefined) ?? (node.propertyNames?.enum ?? []).map((v) => ({ value: String(v), label: valueName(v) }));
  const free = choices.filter((o) => !(o.value in value));
  const [adding, setAdding] = useState('');
  const nameOf = (k: string) => choices.find((o) => o.value === k)?.label ?? valueName(k);
  const scalar = !['object', 'variant', 'list', 'record'].includes(kindOf(unwrap(child).node));
  return (
    <section className="cf-list" aria-label={info.label}>
      <header className="cf-list-head">
        <h4>{info.label}</h4>
        <span className="cf-count">{Object.keys(value).length}</span>
      </header>
      {info.hint ? <p className="cf-hint">{info.hint}</p> : null}
      <Problems path={path} />
      <ul className={scalar ? 'cf-entries' : undefined}>
        {Object.keys(value).map((k) => (
          <li key={k} className={scalar ? 'cf-entry' : 'cf-card open'}>
            <div className="cf-card-head">
              <span className="cf-card-title static">{nameOf(k)}</span>
              <button
                type="button"
                className="cf-icon-btn danger"
                aria-label={`Quitar ${nameOf(k)}`}
                onClick={() => {
                  const next = { ...value };
                  delete next[k];
                  set(path, next);
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
            <div className={scalar ? undefined : 'cf-card-body'}>
              <Node node={child} path={[...path, k]} pattern={`${pattern}.*`} optional={false} bare />
            </div>
          </li>
        ))}
      </ul>
      <div className="cf-add-entry">
        {choices.length ? (
          <Select
            aria-label={`Elegir qué añadir a ${info.label}`}
            id={id}
            size="sm"
            value={adding}
            placeholder="Elige…"
            options={free}
            onChange={setAdding}
          />
        ) : (
          <input aria-label={`Identificador nuevo en ${info.label}`} id={id} type="text" value={adding} onChange={(e) => setAdding(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} />
        )}
        <button
          type="button"
          className="lip pill small"
          disabled={!adding || adding in value}
          onClick={() => {
            set(path, { ...value, [adding]: emptyOf(child) });
            setAdding('');
          }}
        >
          <Icon name="plus" />
          <span>Añadir</span>
        </button>
      </div>
    </section>
  );
}

/** Any node: the right control for its kind. `bare` draws an object's fields without its own frame (inside a card). */
function Node({ node, path, pattern, optional, bare = false }: { node: JsonSchema; path: Path; pattern: string; optional: boolean; bare?: boolean }) {
  const n = unwrap(node).node;
  switch (kindOf(n)) {
    case 'object':
      return bare ? <Fields node={n} path={path} pattern={pattern} /> : <Group node={n} path={path} pattern={pattern} optional={optional} />;
    case 'variant':
      return <Variant node={n} path={path} pattern={pattern} />;
    case 'list':
      return <List node={n} path={path} pattern={pattern} />;
    case 'record':
      return <Record_ node={n} path={path} pattern={pattern} />;
    case 'row':
      return <Row node={n} path={path} pattern={pattern} />;
    case 'words':
      return <Words path={path} pattern={pattern} />;
    case 'unknown':
      return null;
    default:
      return <Scalar node={node} path={path} pattern={pattern} optional={optional} />;
  }
}

export function ConfigForm({
  cfgKey,
  schema,
  value,
  onChange,
  issues,
  options,
  prefix = '',
  autoIds,
  live,
}: {
  cfgKey: ConfigKey;
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  issues: Map<string, string[]>;
  options: Options;
  /** Where `value` sits in its key, for the labels («list[]»: one event of the events' list). */
  prefix?: string;
  /** Ids written from names, kept by whoever outlives this form (a wizard's steps). */
  autoIds?: Set<string>;
  /** What is published (the whole key): its ids are locked. */
  live?: unknown;
}) {
  const [own] = useState(() => new Set<string>());
  const ctx: Ctx = { cfgKey, root: value, set: (path, v) => onChange(setIn(value, path, v)), issues, options, autoIds: autoIds ?? own, locked: liveIds(live) };
  return (
    <FormCtx.Provider value={ctx}>
      <div className="cf-form">
        <Problems path={[]} />
        <Fields node={schema} path={[]} pattern={prefix} />
      </div>
    </FormCtx.Provider>
  );
}
