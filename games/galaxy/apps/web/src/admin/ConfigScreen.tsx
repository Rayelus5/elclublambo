import { type ConfigKey, configIssues, configJsonSchema, DRAWN_FINISHES, expectedTierRates, type GachaSimulation, isConfigKey, mergeDraft, parseConfig, simulateGacha, TIERS } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type ConfigKeyRow, useConfigKeys, useConfigVersions, usePublishConfig } from '../api/config';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { EconomySimulator } from './EconomySimulator';
import { PublishFields } from './PublishFields';
import { ConfigForm, type Options } from './forms/ConfigForm';
import { humanDiff, placeOf } from './forms/humanDiff';
import { issuesByPath, issueText } from './forms/issues';
import { ADVANCED_KEYS, CATEGORIES, JSON_ONLY, KEY_INFO } from './forms/labels';
import { cellText } from './DataTable';

const t = copy.admin.config;
const SWITCHES = ['registrationOpen', 'maintenance', 'gacha', 'runs', 'market', 'trades', 'chat'] as const;
const pctFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x: number) => `${pctFmt.format(x * 100)} %`;
const oneDecimal = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The switches: each turns a part of the game on or off, with a reason and the password. */
function Switches({ features }: { features: Record<string, unknown> }) {
  const [pending, setPending] = useState<(typeof SWITCHES)[number] | null>(null);
  const publish = usePublishConfig('features');
  const action = (k: (typeof SWITCHES)[number]) => (features[k] === true ? t.switchOff(t.switches[k]) : t.switchOn(t.switches[k]));
  return (
    <section className="lip panel admin-switches" aria-label={t.switchesTitle}>
      <h2>{t.switchesTitle}</h2>
      <ul>
        {SWITCHES.map((k) => {
          const on = features[k] === true;
          return (
            <li key={k}>
              <button type="button" role="switch" aria-checked={on} aria-label={t.switches[k]} className={`admin-switch${on ? ' on' : ''}`} onClick={() => setPending(k)}>
                <span aria-hidden="true" />
              </button>
              <span>{t.switches[k]}</span>
              <small>{on ? t.on : t.off}</small>
            </li>
          );
        })}
      </ul>
      {pending ? (
        <Dialog
          title={action(pending)}
          onClose={() => {
            publish.reset();
            setPending(null);
          }}
          className="admin-dialog"
        >
          <PublishFields
            busy={publish.isPending}
            disabled={false}
            error={publish.error}
            label={action(pending)}
            onPublish={(reason, password) => publish.mutate({ data: { [pending]: features[pending] !== true }, reason, password }, { onSuccess: () => setPending(null) })}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

/** Configuración: the switches, then the game's settings by category, each key by its name (polish phase 4). */
export function ConfigScreen() {
  const keys = useConfigKeys();
  const features = keys.data?.find((k) => k.key === 'features')?.data ?? {};
  const rowOf = (key: ConfigKey) => keys.data?.find((k) => k.key === key);
  return (
    <section className="admin-page">
      <h1>{copy.admin.sections.config}</h1>
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {keys.data ? <Switches features={features} /> : null}
      {keys.data ? (
        <section className="cf-categories" aria-label={t.keysTitle}>
          {CATEGORIES.map((c) => (
            <article key={c.id} className={`lip panel cf-category${c.advanced ? ' advanced' : ''}`}>
              <header>
                <span className="cf-category-icon" aria-hidden="true">
                  <Icon name={c.icon} />
                </span>
                <div>
                  <h2>{c.title}</h2>
                  <p>{c.description}</p>
                </div>
              </header>
              <ul>
                {c.keys.map((k) => {
                  const row = rowOf(k);
                  return (
                    <li key={k}>
                      <Link to={`/admin/configuracion/${k}`}>
                        <b>{KEY_INFO[k].title}</b>
                        <small>{KEY_INFO[k].description}</small>
                      </Link>
                      <span className="cf-version">{row ? t.version(row.version) : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}

function Simulator({ cfg }: { cfg: ReturnType<typeof parseConfig<'gacha'>> }) {
  const id = useId();
  const [banner, setBanner] = useState(cfg.banners[0]?.id ?? '');
  const [drawn, setDrawn] = useState<{ of: string; run: GachaSimulation } | null>(null);
  const of = JSON.stringify(cfg);
  // A run belongs to the draft it was drawn with: another draft clears it, so «Salió» always matches «Esperado».
  const run = drawn?.of === of ? drawn.run : null;
  const expected = expectedTierRates(cfg);
  return (
    <section className="lip panel admin-sim" aria-label={t.sim.title}>
      <h2>{t.sim.title}</h2>
      <p className="panel-note">{t.sim.hint}</p>
      <div className="admin-filters">
        <label htmlFor={id}>
          <span>{t.sim.banner}</span>
          <select id={id} value={banner} onChange={(e) => setBanner(e.target.value)}>
            {cfg.banners.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {[1000, 10_000, 100_000].map((n) => (
          <button key={n} type="button" className="lip pill small" onClick={() => setDrawn({ of, run: simulateGacha(cfg, banner, n, 20261108n) })}>
            {t.sim.run(n)}
          </button>
        ))}
      </div>
      {run ? (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" aria-label={t.sim.title}>
              <thead>
                <tr>
                  <th scope="col">{t.sim.tier}</th>
                  <th scope="col">{t.sim.got}</th>
                  <th scope="col">{t.sim.expected}</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((tier, i) => (
                  <tr key={tier}>
                    <th scope="row" className={`tier-${tier}`}>
                      {copy.tiers[tier]}
                    </th>
                    <td>{pct(run.tiers[i]! / run.pulls)}</td>
                    <td>{pct(expected[i]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t.sim.every} {t.sim.pulls(oneDecimal.format(run.legendaryEvery))}
          </p>
          <p>{t.sim.longest(run.longestWithout)}</p>
          <p className="panel-note">
            {t.sim.finishes}: {DRAWN_FINISHES.map((f) => `${copy.finishes[f]} ${pct(run.finishes[f] / run.pulls)}`).join(', ')}
          </p>
        </>
      ) : null}
    </section>
  );
}

/** What the live content offers for the fields that pick a sector, an anomaly or a probe. */
function contentOptions(rows: ConfigKeyRow[] | undefined): Options {
  const content = (rows?.find((k) => k.key === 'content')?.data ?? DEFAULT_CONTENT) as {
    sectors?: { id: string; name: string }[];
    anomalies?: { id: string; name: string }[];
    probes?: { id: string; name: string }[];
  };
  const list = (xs: { id: string; name: string }[] | undefined) => (xs ?? []).map((x) => ({ value: x.id, label: x.name }));
  return { sectors: list(content.sectors), anomalies: list(content.anomalies), probes: list(content.probes) };
}

function Editor({ row, options }: { row: ConfigKeyRow; options: Options }) {
  const id = useId();
  const jsonOnly = JSON_ONLY.has(row.key);
  const advanced = ADVANCED_KEYS.has(row.key);
  const schema = configJsonSchema(row.key);
  // What the draft is made on: the version that was live when editing began (or was last published from here). If
  // someone else publishes meanwhile, the server refuses the draft (409) and this says so.
  const [base, setBase] = useState({ version: row.version, data: row.data });
  const [mode, setMode] = useState<'form' | 'json'>(jsonOnly ? 'json' : 'form');
  const [draft, setDraft] = useState<unknown>(row.data);
  const [text, setText] = useState(() => JSON.stringify(row.data, null, 2));
  const [done, setDone] = useState<number | null>(null);
  const versions = useConfigVersions(row.key);
  const publish = usePublishConfig(row.key);
  let parsed: unknown = draft;
  let jsonOk = true;
  if (mode === 'json') {
    try {
      parsed = JSON.parse(text);
    } catch {
      jsonOk = false;
    }
  }
  const merged = jsonOk ? mergeDraft(row.key, base.data, parsed) : undefined;
  const issues = jsonOk ? configIssues(row.key, merged) : [];
  const next = jsonOk && issues.length === 0 ? (parseConfig(row.key, merged) as Record<string, unknown>) : null;
  const names = Object.fromEntries(Object.values(options).flatMap((list) => (list ?? []).map((o) => [o.value, o.label])));
  const changes = next ? humanDiff(row.key, schema, base.data, next, names) : [];
  // Only the fields that change are sent, so nothing else published meanwhile is undone.
  const fields = next ? Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(base.data[k]) !== JSON.stringify(v))) : {};
  const moved = row.version !== base.version && !publish.isPending;
  const load = (data: unknown) => {
    setDraft(data);
    setText(JSON.stringify(data, null, 2));
  };
  const reloadLive = () => {
    setBase({ version: row.version, data: row.data });
    load(row.data);
    setDone(null);
    publish.reset();
  };
  const switchTo = (m: 'form' | 'json') => {
    if (m === mode) return;
    if (m === 'json') setText(JSON.stringify(draft, null, 2));
    else if (jsonOk) setDraft(merged);
    setMode(m);
  };
  return (
    <>
      {advanced ? (
        <p className="cf-warning" role="note">
          <Icon name="alert" />
          <span>{t.advancedNote}</span>
        </p>
      ) : null}
      {advanced && !jsonOnly ? (
        <div className="tabs cf-tabs" role="tablist" aria-label={t.modes}>
          <button type="button" role="tab" aria-selected={mode === 'form'} disabled={mode === 'json' && !jsonOk} onClick={() => switchTo('form')}>
            {t.formTab}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'json'} onClick={() => switchTo('json')}>
            {t.jsonTab}
          </button>
        </div>
      ) : null}
      <div className="cf-layout">
        <div className="cf-main">
          {mode === 'form' ? (
            <ConfigForm cfgKey={row.key} schema={schema} value={draft} onChange={setDraft} issues={issuesByPath(issues)} options={options} live={base.data} />
          ) : (
            <div className="field">
              <label htmlFor={id}>{t.editor}</label>
              <textarea
                id={id}
                className="admin-json"
                spellCheck={false}
                rows={22}
                value={text}
                aria-invalid={!jsonOk || issues.length > 0}
                aria-describedby={`${id}-checks`}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="hint">{t.editorHint}</p>
            </div>
          )}
        </div>
        <aside className="lip panel cf-aside admin-checks" id={`${id}-checks`} aria-live="polite">
          {!jsonOk ? (
            <p className="field-error">{t.invalidJson}</p>
          ) : issues.length ? (
            <section aria-label={t.issuesTitle}>
              <h2>{t.issuesTitle}</h2>
              <ul className="admin-issues">
                {issues.map((i) => (
                  <li key={`${i.path}:${i.message}`}>
                    {i.path ? <b>{placeOf(row.key, schema, merged, i.path) || i.path}</b> : null} {issueText(i.message)}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section aria-label={t.changesTitle}>
              <h2>{t.changesTitle}</h2>
              {changes.length ? (
                <ul className="admin-changes">
                  {changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="panel-note">{t.noChanges}</p>
              )}
            </section>
          )}
          {moved ? (
            <div className="admin-moved" role="status">
              <p>{t.moved(row.version)}</p>
              <button type="button" className="lip pill small" onClick={reloadLive}>
                {t.reloadLive}
              </button>
            </div>
          ) : null}
          {done ? (
            <p className="admin-done" role="status">
              {t.published(done)}
            </p>
          ) : null}
          <PublishFields
            busy={publish.isPending}
            disabled={!next || changes.length === 0}
            error={publish.error}
            onPublish={(reason, password) =>
              publish.mutate(
                { data: fields, baseVersion: base.version, reason, password },
                {
                  onSuccess: (r) => {
                    setDone(r.version);
                    if (next) {
                      setBase({ version: r.version, data: next });
                      load(next);
                    }
                  },
                },
              )
            }
          />
        </aside>
      </div>
      {row.key === 'gacha' && next ? <Simulator cfg={next as unknown as ReturnType<typeof parseConfig<'gacha'>>} /> : null}
      {(row.key === 'runs' || row.key === 'boosts') && next ? <EconomySimulator editing={row.key} draft={next} /> : null}
      <section className="lip panel admin-history" aria-label={t.history}>
        <h2>{t.history}</h2>
        {versions.data && versions.data.length === 0 ? <p className="panel-note">{t.noHistory}</p> : null}
        <ul>
          {[...(versions.data ?? [])].reverse().map((v) => (
            <li key={v.version}>
              <b>{t.version(v.version)}</b>
              <span>{v.author ? t.by(v.author, cellText('at', v.createdAt)) : cellText('at', v.createdAt)}</span>
              <span className="panel-note">{v.note}</span>
              <button type="button" className="lip pill small" aria-label={t.loadVersion(v.version)} onClick={() => load(mergeDraft(row.key, base.data, v.data))}>
                {t.loadVersion(v.version)}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** One key: its draft with live checks and the diff, publishing, its history and, for the gacha, the simulator. */
export function ConfigKeyScreen() {
  const { key = '' } = useParams();
  const keys = useConfigKeys();
  const row = isConfigKey(key) ? keys.data?.find((k) => k.key === (key as ConfigKey)) : undefined;
  return (
    <section className="admin-page">
      <Link to="/admin/configuracion" className="lip pill small">
        <Icon name="back" />
        <span>{t.back}</span>
      </Link>
      <h1>{row ? KEY_INFO[row.key].title : key}</h1>
      {row ? (
        <p className="panel-note cf-key-meta">
          {KEY_INFO[row.key].description}. {t.version(row.version)}. <code>{row.key}</code>
        </p>
      ) : null}
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {row ? <Editor key={row.key} row={row} options={contentOptions(keys.data)} /> : null}
    </section>
  );
}
