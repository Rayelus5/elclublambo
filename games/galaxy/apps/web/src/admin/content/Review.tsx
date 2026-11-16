import { type ConfigKey, configJsonSchema, parseConfig } from '@galaxy/shared';
import type { BotRun, Content, ContentWarning } from '@galaxy/sim';
import { useEffect, useId, useRef, useState } from 'react';
import { copy } from '../../copy/es';
import { Select } from '../../ui/Select';
import { placeOf } from '../forms/humanDiff';
import { warningText } from '../forms/issues';
import { describeContent } from './descriptors';
import { type QuickResult, runQuickSim } from './quicksim';

// Reviewing a draft before publishing it (the content editor, 2026-11-16, P7): the warnings (allowed, probably not
// wanted), where the change will show, and a quick check where the bot plays the same seeds with what is published and
// with the draft.

const t = copy.admin.content;
type Value = Record<string, unknown>;

export function Warnings({ warnings, content, acked, onAck }: { warnings: ContentWarning[]; content: Value; acked: boolean; onAck: (on: boolean) => void }) {
  const id = useId();
  const schema = configJsonSchema('content');
  return (
    <section className="lip panel" aria-label={t.warnings}>
      <h3>{t.warnings}</h3>
      {warnings.length === 0 ? (
        <p className="panel-note">{t.noWarnings}</p>
      ) : (
        <>
          <ul className="admin-issues ce-warnings">
            {warnings.map((w) => (
              <li key={`${w.code}:${w.path}`}>
                <b>{placeOf('content', schema, content, w.path, describeContent) || w.path}</b> {warningText(w)}
              </li>
            ))}
          </ul>
          <label className="ce-ack" htmlFor={`${id}-a`}>
            <input id={`${id}-a`} type="checkbox" checked={acked} onChange={(e) => onAck(e.target.checked)} />
            <span>{t.ackWarnings}</span>
          </label>
        </>
      )}
    </section>
  );
}

/** Where a change to each part of the content is seen. */
const SCREENS: Partial<Record<string, readonly string[]>> = {
  probes: ['runs', 'hangar'],
  weapons: ['runs', 'hangar', 'workshop'],
  passives: ['runs'],
  enemies: ['runs', 'codex'],
  elites: ['runs'],
  bosses: ['runs', 'hangar', 'codex'],
  sectors: ['runs', 'hangar', 'codex'],
  relics: ['runs', 'hangar'],
};

export function Impact({ fields }: { fields: string[] }) {
  const screens = [...new Set(fields.flatMap((f) => SCREENS[f] ?? ['runs']))].map((s) => t.screens[s as keyof typeof t.screens]);
  return (
    <div className="ce-impact">
      {screens.length ? <p>{t.impact(screens)}</p> : null}
      <p className="panel-note">{t.inProgressKeep}</p>
    </div>
  );
}

const SEEDS = ['101', '202', '303'];
const MAX_MINUTES = 8;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export function QuickSim({ live, doc, ready }: { live: Content; doc: Value; ready: boolean }) {
  const id = useId();
  const named = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is { id: string; name: string } => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');
  const sectors = named(doc.sectors);
  const probes = named(doc.probes);
  const [sector, setSector] = useState(sectors[0]?.id ?? '');
  const [probe, setProbe] = useState(probes[0]?.id ?? '');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<QuickResult | null>(null);
  const [failed, setFailed] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  // Closing the draft stops the bot: nothing keeps playing in the background.
  useEffect(() => () => cancel.current?.(), []);

  function start() {
    let draft: Content;
    try {
      draft = parseConfig('content' as ConfigKey, doc) as Content;
    } catch {
      setFailed(true);
      return;
    }
    const hasBoth = live.sectors.some((s) => s.id === sector) && live.probes.some((p) => p.id === probe);
    setFailed(false);
    setResult(null);
    setProgress({ done: 0, total: SEEDS.length * (hasBoth ? 2 : 1) });
    const job = runQuickSim({ live: hasBoth ? live : null, draft, sector, probe, seeds: SEEDS, maxMinutes: MAX_MINUTES }, (done, total) => setProgress({ done, total }));
    cancel.current = job.cancel;
    job.promise.then(
      (r) => {
        setResult(r);
        setProgress(null);
      },
      (e: unknown) => {
        setProgress(null);
        if (!(e instanceof Error && e.message === 'cancelled')) setFailed(true);
      },
    );
  }

  const rows: { key: keyof typeof t.quickSimRows; of: (runs: BotRun[]) => string }[] = [
    { key: 'minutes', of: (runs) => fmt(mean(runs.map((r) => r.minutes))) },
    { key: 'layer', of: (runs) => fmt(mean(runs.map((r) => r.layer))) },
    { key: 'boss', of: (runs) => t.outOf(runs.filter((r) => r.beatBoss).length, runs.length) },
    { key: 'died', of: (runs) => t.outOf(runs.filter((r) => r.end === 'died').length, runs.length) },
  ];
  return (
    <section className="lip panel ce-quicksim" aria-label={t.quickSim}>
      <h3>{t.quickSim}</h3>
      <p className="panel-note">{t.quickSimHint(SEEDS.length, MAX_MINUTES)}</p>
      <div className="ce-quicksim-pick">
        <label htmlFor={`${id}-s`}>{t.quickSimSector}</label>
        <Select id={`${id}-s`} size="sm" block value={sector} options={sectors.map((s) => ({ value: s.id, label: s.name }))} onChange={setSector} />
        <label htmlFor={`${id}-p`}>{t.quickSimProbe}</label>
        <Select id={`${id}-p`} size="sm" block value={probe} options={probes.map((p) => ({ value: p.id, label: p.name }))} onChange={setProbe} />
      </div>
      {progress ? (
        <div className="ce-quicksim-run" role="status">
          <span>{t.quickSimProgress(progress.done, progress.total)}</span>
          <button type="button" className="lip pill small" onClick={() => cancel.current?.()}>
            {t.quickSimCancel}
          </button>
        </div>
      ) : (
        <button type="button" className="lip pill small" disabled={!ready || !sector || !probe} onClick={start}>
          {t.quickSimRun}
        </button>
      )}
      {!ready ? <p className="panel-note">{t.quickSimBlocked}</p> : null}
      {failed ? <p className="field-error">{t.quickSimFailed}</p> : null}
      {result ? (
        <table className="ce-quicksim-table">
          <caption>{t.quickSimTable}</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">{t.published}</th>
              <th scope="col">{t.draftSide}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{t.quickSimRows[row.key]}</th>
                <td>{result.live ? row.of(result.live) : '—'}</td>
                <td>{row.of(result.draft)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
