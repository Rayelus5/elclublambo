import { type ConfigKey, configIssues, expectedTierRates, FINISHES, type GachaSimulation, isConfigKey, mergeDraft, parseConfig, simulateGacha, TIERS } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { type ConfigKeyRow, useConfigKeys, useConfigVersions, usePublishConfig } from '../api/config';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { EconomySimulator } from './EconomySimulator';
import { cellText } from './DataTable';

const t = copy.admin.config;
const SWITCHES = ['registrationOpen', 'maintenance', 'gacha', 'runs', 'market', 'trades', 'chat'] as const;
const pctFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x: number) => `${pctFmt.format(x * 100)} %`;
const oneDecimal = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The issues the server found in a publish it refused (config_invalid), if any. */
function serverIssues(error: unknown): { path: string; message: string }[] {
  const issues = error instanceof ApiError ? error.details.issues : undefined;
  return Array.isArray(issues) ? (issues as { path: string; message: string }[]) : [];
}

/** Reason and the admin's password, then publish (DESIGN_SYSTEM §8 septendecies). */
function PublishFields({ busy, disabled, error, label = t.publish, onPublish }: { busy: boolean; disabled: boolean; error: unknown; label?: string; onPublish: (reason: string, password: string) => void }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const ready = !disabled && !busy && reason.trim().length >= 3 && password.length > 0;
  return (
    <form
      className="admin-publish"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onPublish(reason.trim(), password);
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-r`}>{copy.admin.fields.reason}</label>
        <div className="control">
          <input id={`${id}-r`} type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-p`}>{copy.admin.fields.password}</label>
        <div className="control">
          <input id={`${id}-p`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {error ? (
        <div className="field-error" role="alert">
          <p>{errorText(error, copy.errors)}</p>
          {serverIssues(error).length ? (
            <ul className="admin-issues">
              {serverIssues(error).map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  <code>{i.path || '·'}</code> {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <button type="submit" className="lip pill danger" disabled={!ready} aria-busy={busy || undefined}>
        {label}
      </button>
    </form>
  );
}

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

/** Configuración: the switches, then every key with its version and last change. */
export function ConfigScreen() {
  const keys = useConfigKeys();
  const features = keys.data?.find((k) => k.key === 'features')?.data ?? {};
  return (
    <section className="admin-page">
      <h1>{copy.admin.sections.config}</h1>
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {keys.data ? <Switches features={features} /> : null}
      {keys.data ? (
        <section className="lip panel admin-keys" aria-label={t.keysTitle}>
          <h2>{t.keysTitle}</h2>
          <ul>
            {keys.data.map((k) => (
              <li key={k.key}>
                <Link to={`/admin/configuracion/${k.key}`}>{k.key}</Link>
                <span>{t.version(k.version)}</span>
                <small>{k.author && k.createdAt ? t.by(k.author, cellText('at', k.createdAt)) : ''}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What a draft changes against what is live, by path: a value that changes, an entry that is added, and an entry that
 * is removed (said once for the whole entry). Arrays are compared whole.
 */
function diff(before: unknown, after: unknown, path = ''): string[] {
  if (!isObject(before) || !isObject(after)) {
    const [a, b] = [JSON.stringify(before), JSON.stringify(after)];
    return a === b ? [] : [t.changed(path, a ?? '—', b ?? '—')];
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((k) => {
    const p = path ? `${path}.${k}` : k;
    if (!(k in after)) return [t.removed(p)];
    if (!(k in before)) return [t.changed(p, '—', JSON.stringify(after[k]))];
    return diff(before[k], after[k], p);
  });
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
            {t.sim.finishes}: {FINISHES.map((f) => `${copy.finishes[f]} ${pct(run.finishes[f] / run.pulls)}`).join(', ')}
          </p>
        </>
      ) : null}
    </section>
  );
}

function Editor({ row }: { row: ConfigKeyRow }) {
  const id = useId();
  // What the draft is made on: the version that was live when editing began (or was last published from here). If
  // someone else publishes meanwhile, the server refuses the draft (409) and this says so.
  const [base, setBase] = useState({ version: row.version, data: row.data });
  const [text, setText] = useState(() => JSON.stringify(row.data, null, 2));
  const [done, setDone] = useState<number | null>(null);
  const versions = useConfigVersions(row.key);
  const publish = usePublishConfig(row.key);
  let parsed: unknown = undefined;
  let jsonOk = true;
  try {
    parsed = JSON.parse(text);
  } catch {
    jsonOk = false;
  }
  const merged = jsonOk ? mergeDraft(row.key, base.data, parsed) : undefined;
  const issues = jsonOk ? configIssues(row.key, merged) : [];
  const next = jsonOk && issues.length === 0 ? (parseConfig(row.key, merged) as Record<string, unknown>) : null;
  const changes = next ? diff(base.data, next) : [];
  // Only the fields that change are sent, so nothing else published meanwhile is undone.
  const fields = next ? Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(base.data[k]) !== JSON.stringify(v))) : {};
  const moved = row.version !== base.version && !publish.isPending;
  const reloadLive = () => {
    setBase({ version: row.version, data: row.data });
    setText(JSON.stringify(row.data, null, 2));
    setDone(null);
    publish.reset();
  };
  return (
    <>
      <div className="admin-editor">
        <div className="field">
          <label htmlFor={id}>{t.editor}</label>
          <textarea
            id={id}
            className="admin-json"
            spellCheck={false}
            rows={18}
            value={text}
            aria-invalid={!jsonOk || issues.length > 0}
            aria-describedby={`${id}-checks`}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="hint">{t.editorHint}</p>
        </div>
        <div className="admin-checks" id={`${id}-checks`} aria-live="polite">
          {!jsonOk ? (
            <p className="field-error">{t.invalidJson}</p>
          ) : issues.length ? (
            <section aria-label={t.issuesTitle}>
              <h2>{t.issuesTitle}</h2>
              <ul className="admin-issues">
                {issues.map((i) => (
                  <li key={`${i.path}:${i.message}`}>
                    <code>{i.path || '·'}</code> {i.message}
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
                    if (next) setBase({ version: r.version, data: next });
                  },
                },
              )
            }
          />
        </div>
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
              <button type="button" className="lip pill small" aria-label={t.loadVersion(v.version)} onClick={() => setText(JSON.stringify(v.data, null, 2))}>
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
      <h1>{key}</h1>
      {row ? <p className="panel-note">{t.version(row.version)}</p> : null}
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {row ? <Editor key={row.key} row={row} /> : null}
    </section>
  );
}
