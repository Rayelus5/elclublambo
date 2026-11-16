import type { BossPhase } from '@galaxy/sim';
import { useId } from 'react';
import { copy } from '../../copy/es';
import { FormField, type WidgetProps } from '../forms/ConfigForm';
import { getIn } from '../forms/schema';
import { VOCABS } from './descriptors';

// What a list of numbers means, drawn above its editor (the content editor, 2026-11-16, P6): a Core's phases on its
// life bar, when each enemy of a sector comes and when its waves arrive, and each event's share of the draw. The
// engine's own controls stay underneath (FormField), so everything is still edited the usual way.

const t = copy.admin.content;

/** A Core's phases: the share of its life each one lasts, and the attacks of each. */
export function PhaseTimeline({ value, node, path, pattern }: WidgetProps) {
  const id = useId();
  const phases = (Array.isArray(value) ? value : []) as BossPhase[];
  const spans = phases.map((ph, i) => {
    const from = Math.round((ph.below ?? 0) * 100);
    const to = Math.round((phases[i + 1]?.below ?? 0) * 100);
    return { from, to, share: Math.max(1, from - to) };
  });
  return (
    <div className="cf-field ce-chart">
      <span id={`${id}-l`} className="cf-absent-label">
        {t.phasesTitle}
      </span>
      <div className="ce-lifebar" aria-hidden="true">
        {spans.map((s, i) => (
          <span key={i} className={`ce-life-${i % 4}`} style={{ flexGrow: s.share }}>
            {i + 1}
          </span>
        ))}
      </div>
      <ol className="ce-phase-cards" aria-label={t.phasesChart}>
        {phases.map((ph, i) => (
          <li key={i} className={`ce-life-${i % 4}`}>
            <b>{t.phaseSpan(i + 1, spans[i]!.from, spans[i]!.to)}</b>
            <span className="ce-chips">
              {(ph.patterns ?? []).map((p, k) => (
                <span key={k} className="ce-chip">
                  {VOCABS.bossPattern?.[p.kind]?.label ?? p.kind}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <FormField node={node} path={path} pattern={pattern} />
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A sector's first layer: from when each species comes (and how often, by its weight), and its waves. */
export function SpawnTimeline({ value, node, path, pattern, root, options }: WidgetProps) {
  const id = useId();
  const sector = (getIn(root, path.slice(0, -1)) ?? {}) as { layerSeconds?: number; waves?: { at: number; enemy: string; count: number }[] };
  const spawns = (Array.isArray(value) ? value : []) as { enemy: string; from: number; weight: number }[];
  const waves = sector.waves ?? [];
  const span = Math.max(1, sector.layerSeconds ?? 0, ...spawns.map((s) => s.from), ...waves.map((w) => w.at));
  const heaviest = Math.max(1e-6, ...spawns.map((s) => s.weight ?? 0));
  const enemy = (eid: string) => options['enemies']?.find((o) => o.value === eid);
  const at = (s: number) => `${Math.min(100, (s / span) * 100).toFixed(2)}%`;
  return (
    <div className="cf-field ce-chart">
      <span id={`${id}-l`} className="cf-absent-label">
        {t.spawnsTitle}
      </span>
      <div className="ce-tl">
        <ol className="ce-tl-rows" aria-label={t.spawnsChart}>
          {spawns.map((s, i) => {
            const e = enemy(s.enemy);
            const name = e?.label ?? s.enemy;
            return (
              <li key={i}>
                <span className="ce-tl-name" aria-hidden="true">
                  {e?.image ? <img src={e.image} alt="" width={20} height={20} /> : null}
                  {name}
                </span>
                <span className="ce-tl-track" aria-hidden="true">
                  <span className="ce-tl-bar" style={{ marginInlineStart: at(s.from), opacity: 0.35 + 0.65 * ((s.weight ?? 0) / heaviest) }} />
                </span>
                <span className="sr-only">{t.spawnFrom(name, s.from)}</span>
              </li>
            );
          })}
        </ol>
        <div className="ce-tl-waves-row">
          <span className="ce-tl-name" aria-hidden="true">
            {t.wavesLabel}
          </span>
          <ol className="ce-tl-track ce-tl-waves" aria-label={t.wavesChart}>
            {waves.map((w, i) => {
              const e = enemy(w.enemy);
              const text = t.waveAt(e?.label ?? w.enemy, w.at, w.count);
              return (
                <li key={i} style={{ insetInlineStart: at(w.at) }} title={text}>
                  {e?.image ? <img src={e.image} alt="" width={18} height={18} /> : <span className="ce-tl-dot" aria-hidden="true" />}
                  <span className="sr-only">{text}</span>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="ce-tl-axis" aria-hidden="true">
          <span>{clock(0)}</span>
          <span>{clock(span / 2)}</span>
          <span>{clock(span)}</span>
        </div>
      </div>
      <FormField node={node} path={path} pattern={pattern} />
    </div>
  );
}

/** The events' weights as their share of the draw. */
export function WeightBars({ value, node, path, pattern }: WidgetProps) {
  const id = useId();
  const weights = (value && typeof value === 'object' ? value : {}) as Record<string, number>;
  const total = Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
  return (
    <div className="cf-field ce-chart">
      <span id={`${id}-l`} className="cf-absent-label">
        {t.weightsTitle}
      </span>
      <ol className="ce-weights" aria-label={t.weightsChart}>
        {Object.entries(weights).map(([k, v]) => {
          const pct = Math.round(((v > 0 ? v : 0) / total) * 100);
          return (
            <li key={k}>
              <span className="ce-w-name">{`${VOCABS.eventKind?.[k]?.label ?? k} ${pct} %`}</span>
              <span className="ce-w-track" aria-hidden="true">
                <span className="ce-w-bar" style={{ inlineSize: `${pct}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      <FormField node={node} path={path} pattern={pattern} />
    </div>
  );
}

/** Which pairs of elements react, and how: one cell per pair (the upper half; the order of a pair does not matter). */
export function ReactionMatrix({ value, node, path, pattern }: WidgetProps) {
  const reactions = (Array.isArray(value) ? value : []) as { name?: string; id?: string; pair?: [string, string] }[];
  const elements = Object.entries(VOCABS.element ?? {});
  const named = (a: string, b: string) => reactions.find((r) => r.pair && ((r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a)));
  return (
    <div className="cf-field ce-chart">
      <div className="ce-matrix-scroll">
        <table className="ce-matrix">
          <caption>{t.reactionsChart}</caption>
          <thead>
            <tr>
              <td />
              {elements.slice(1).map(([id, term]) => (
                <th key={id} scope="col">
                  {term.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {elements.slice(0, -1).map(([a, ta], i) => (
              <tr key={a}>
                <th scope="row">{ta.label}</th>
                {elements.slice(1).map(([b, tb], j) => {
                  // Column j is element j + 1: only the pairs above the diagonal, each once.
                  if (j < i) return <td key={b} className="ce-matrix-off" aria-hidden="true" />;
                  const r = named(a, b);
                  return (
                    <td key={b} className={r ? 'on' : undefined} aria-label={r ? t.reactionCell(ta.label, tb.label, r.name ?? r.id ?? '') : t.reactionNone(ta.label, tb.label)}>
                      {r ? (r.name ?? r.id) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormField node={node} path={path} pattern={pattern} />
    </div>
  );
}
