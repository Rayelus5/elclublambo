import { type Content, type DebugGrant, EVENT_KINDS, type EventKind } from '@galaxy/sim';
import { type MouseEvent, useMemo, useState } from 'react';
import { copy } from '../../copy/es';
import { grantOptions, searchGrants } from './grant-options';

// The admin debug mode's side panel (2026-11-15): speed, what to see, actions on the run and any upgrade. Not modal:
// the run goes on behind it. Every button lets go of the focus once pressed, so Enter or Space (the run's keys) never
// press it again.

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8] as const;

const t = copy.arena.debug;

/** A click that drops the focus first. */
const press = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.blur();
  fn();
};

export interface Owned {
  weapons: { id: string; level: number }[];
  passives: { id: string; level: number }[];
}

export function DebugPanel({
  content,
  speed,
  onSpeed,
  hitboxes,
  onHitboxes,
  info,
  onInfo,
  god,
  onGod,
  paused,
  onPause,
  onResume,
  choosing,
  test,
  draft,
  owned,
  onLevel,
  onHeal,
  onClear,
  onCore,
  onLayer,
  onEvent,
  onGrant,
  replacing,
  onCancelReplace,
  notice,
  onClose,
}: {
  content: Content;
  speed: number;
  onSpeed: (s: number) => void;
  hitboxes: boolean;
  onHitboxes: (on: boolean) => void;
  info: boolean;
  onInfo: (on: boolean) => void;
  god: boolean;
  onGod: (on: boolean) => void;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  /** The level-up cards are open: the actions wait. */
  choosing: boolean;
  test: boolean;
  draft: boolean;
  owned: Owned;
  onLevel: (n: number) => void;
  onHeal: () => void;
  onClear: () => void;
  onCore: () => void;
  onLayer: () => void;
  /** Brings an in-run event now (2026-11-16). */
  onEvent: (kind: EventKind) => void;
  onGrant: (g: DebugGrant) => void;
  /** An upgrade waiting for the slot it replaces (the slots were full). */
  replacing: DebugGrant | null;
  onCancelReplace: () => void;
  notice: string | null;
  onClose: () => void;
}) {
  const options = useMemo(() => grantOptions(content), [content]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const found = searchGrants(options, query);
  const choose = (key: string, max: number) => {
    setPicked(key);
    setLevel(max);
  };
  const chosen = options.find((o) => `${o.kind}:${o.id}` === picked) ?? null;
  const name = (kind: 'weapon' | 'passive', id: string) => (kind === 'weapon' ? content.weapons.find((w) => w.id === id)?.name : content.passives.find((p) => p.id === id)?.name) ?? id;
  const slots = replacing ? (replacing.kind === 'passive' ? owned.passives.map((s) => name('passive', s.id)) : owned.weapons.map((w) => name('weapon', w.id))) : [];

  return (
    <aside className="debug-panel" aria-label={t.title}>
      <header className="debug-head">
        <h2>{t.title}</h2>
        {test ? <span className="debug-badge">{t.badge}</span> : null}
        {draft ? <span className="debug-badge draft">{t.draft}</span> : null}
        <button type="button" className="debug-x" aria-label={t.close} onClick={press(onClose)}>
          ×
        </button>
      </header>
      <p className="debug-hint">{t.hint}</p>

      <section className="debug-section" aria-label={t.speed}>
        <h3>{t.speed}</h3>
        <div className="debug-row speeds">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className="debug-chip" aria-pressed={speed === s} onClick={press(() => onSpeed(s))}>
              {t.speedValue(s)}
            </button>
          ))}
        </div>
      </section>

      <section className="debug-section" aria-label={t.view}>
        <h3>{t.view}</h3>
        <div className="debug-row">
          <button type="button" className="debug-chip" aria-pressed={info} onClick={press(() => onInfo(!info))}>
            {t.info}
          </button>
          <button type="button" className="debug-chip" aria-pressed={hitboxes} onClick={press(() => onHitboxes(!hitboxes))}>
            {t.hitboxes}
          </button>
        </div>
      </section>

      <section className="debug-section" aria-label={t.play}>
        <h3>{t.play}</h3>
        {choosing ? <p className="debug-note">{t.choosing}</p> : null}
        <div className="debug-row">
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(() => onLevel(1))}>
            {t.levelUp(1)}
          </button>
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(() => onLevel(5))}>
            {t.levelUp(5)}
          </button>
          <button type="button" className="debug-chip" aria-pressed={god} onClick={press(() => onGod(!god))}>
            {t.god}
          </button>
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(onHeal)}>
            {t.heal}
          </button>
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(onClear)}>
            {t.clear}
          </button>
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(onCore)}>
            {t.core}
          </button>
          <button type="button" className="debug-btn" disabled={choosing} onClick={press(onLayer)}>
            {t.layer}
          </button>
          <button type="button" className="debug-btn" onClick={press(paused ? onResume : onPause)}>
            {paused ? t.resume : t.pause}
          </button>
        </div>
      </section>

      <section className="debug-section" aria-label={t.events}>
        <h3>{t.events}</h3>
        <div className="debug-row">
          {EVENT_KINDS.map((k) => (
            <button key={k} type="button" className="debug-btn" disabled={choosing} onClick={press(() => onEvent(k))}>
              {copy.arena.events[k].name}
            </button>
          ))}
        </div>
      </section>

      <section className="debug-section" aria-label={t.grant}>
        <h3>{t.grant}</h3>
        {replacing ? (
          <div className="debug-replace" role="group" aria-label={t.replaceTitle}>
            <p>{t.replaceTitle}</p>
            {slots.map((label, i) => (
              <button key={`${label}-${i}`} type="button" className="debug-btn" onClick={press(() => onGrant({ ...replacing, replace: i }))}>
                {label}
              </button>
            ))}
            <button type="button" className="debug-btn ghost" onClick={press(onCancelReplace)}>
              {t.cancel}
            </button>
          </div>
        ) : (
          <>
            <input type="search" className="debug-search" aria-label={t.search} placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="debug-list" role="listbox" aria-label={t.grant}>
              {found.map((o) => {
                const key = `${o.kind}:${o.id}`;
                return (
                  <li
                    key={key}
                    role="option"
                    aria-selected={picked === key}
                    tabIndex={0}
                    onClick={(e) => {
                      // Let go of the focus, like the buttons: Space must stay the dash.
                      e.currentTarget.blur();
                      choose(key, o.maxLevel);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      e.stopPropagation();
                      choose(key, o.maxLevel);
                    }}
                  >
                    <span>{o.name}</span>
                    <small>{t.kinds[o.kind]}</small>
                  </li>
                );
              })}
            </ul>
            <div className="debug-row">
              <label className="debug-level">
                <span>{t.level}</span>
                <input
                  type="number"
                  min={1}
                  max={chosen?.maxLevel ?? 1}
                  value={level}
                  disabled={!chosen || chosen.maxLevel === 1}
                  onChange={(e) => setLevel(Math.max(1, Math.min(chosen?.maxLevel ?? 1, Math.floor(Number(e.target.value) || 1))))}
                />
              </label>
              <button type="button" className="debug-btn give" disabled={!chosen || choosing} onClick={press(() => chosen && onGrant({ kind: chosen.kind, id: chosen.id, level }))}>
                {t.give}
              </button>
            </div>
          </>
        )}
      </section>
      {notice ? (
        <p className="debug-notice" role="status">
          {notice}
        </p>
      ) : null}
    </aside>
  );
}
