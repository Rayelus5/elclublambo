import type { CoopPlayer } from '@galaxy/shared';
import type { Content, HudSnapshot, Offer } from '@galaxy/sim';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { playUi } from '../audio/ui-sfx';
import { describeOffer } from '../arena/hud/LevelUp';
import { spriteDataUrl } from '../arena/sprites';
import { teamTint } from '../arena/stage/palette';
import { usePrefs } from '../settings/prefs';
import { copy } from '../copy/es';
import { CARD_GUARD_MS, cardKey, typing } from '../ui/keys';
import { useKeyLabels } from '../settings/keybinds';

// The co-op HUD (multiplayer plan, phase 6): the cards without pause (a strip at the bottom: 1, 2 or 3 picks at once,
// a click too, and the time left before one is taken at random; the arrows keep moving the probe), the team (life
// and state of everyone), and the notices of falling and being out.

const t = copy.coop.arena;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** How long a taken card takes to fly to the kit (ms; a short fade with reduced motion). */
export const CARD_FLY_MS = 520;
const CARD_FADE_MS = 160;

/**
 * The cards of a group run (the world never stops). `open`: whether my offer is up (and not yet answered); `onPick(i,
 * seq)`: the card and the offer it was on, as shown (never a newer one the frame loop already has). The pick goes at
 * once; the strip stays a moment while the card taken glows and flies to the kit, whatever the world does meanwhile.
 * Nothing counts in its first CARD_GUARD_MS (a dash or a shot pressed just as it opens).
 */
export function CoopCards({
  hud,
  content,
  pickSeconds,
  onPick,
  open = true,
  reduced = false,
}: {
  hud: HudSnapshot;
  content: Content;
  pickSeconds: number;
  onPick: (i: number, seq: number) => void;
  open?: boolean;
  reduced?: boolean;
}) {
  const keys = useKeyLabels();
  const seq = hud.coop?.offerSeq ?? 0;
  const [taken, setTaken] = useState<{ offer: Offer[]; seq: number; index: number; fly: { x: number; y: number } } | null>(null);
  // The offer answered never shows again, whatever the HUD still says until the world moves on.
  const [answered, setAnswered] = useState(-1);
  const live = open && seq !== answered ? hud.offer : null;
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const shownAt = useRef(0);
  const showing = taken === null && live !== null;
  useEffect(() => {
    if (showing) shownAt.current = Date.now();
  }, [seq, showing]);
  const take = useCallback(
    (i: number) => {
      if (!live || taken || Date.now() - shownAt.current < CARD_GUARD_MS) return;
      // Where the kit is from the card: it flies there.
      const card = cards.current[i]?.getBoundingClientRect();
      const kit = document.querySelector('.hud-kit')?.getBoundingClientRect();
      const fly = card && kit ? { x: kit.left + 40 - (card.left + card.width / 2), y: kit.top + 10 - (card.top + card.height / 2) } : { x: 0, y: 60 };
      setTaken({ offer: live, seq, index: i, fly });
      setAnswered(seq);
      playUi('confirm');
      onPick(i, seq);
    },
    [live, onPick, seq, taken],
  );
  useEffect(() => {
    if (!taken) return;
    const id = setTimeout(() => setTaken(null), reduced ? CARD_FADE_MS : CARD_FLY_MS);
    return () => clearTimeout(id);
  }, [taken, reduced]);
  useEffect(() => {
    if (!live || taken) return;
    function onKey(e: KeyboardEvent): void {
      if (typing(e)) return;
      const n = cardKey(e.code);
      if (n >= 1 && n <= live!.length) {
        take(n - 1);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, take, taken]);
  const offer = taken ? taken.offer : live;
  if (!offer) return null;
  const left = Math.ceil(hud.coop?.pickLeft ?? 0);
  const total = Math.max(1, pickSeconds);
  return (
    <section
      className={`coop-cards${taken ? ' taking' : ''}`}
      aria-label={t.cards}
      style={taken ? ({ '--fly-x': `${Math.round(taken.fly.x)}px`, '--fly-y': `${Math.round(taken.fly.y)}px` } as CSSProperties) : undefined}
    >
      <header>
        <b>{t.cards}</b>
        <span className="coop-cards-hint">{t.cardsHint(keys)}</span>
        <span className="coop-cards-left" role="timer" aria-label={t.pickLeft(left)}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15" className="track" />
            <circle cx="18" cy="18" r="15" className="fill" style={{ strokeDasharray: `${Math.max(0, Math.min(1, left / total)) * 94.2} 94.2` }} />
          </svg>
          <span>{left}</span>
        </span>
      </header>
      <div className="coop-cards-row">
        {offer.map((o, i) => {
          const d = describeOffer(content, o);
          return (
            <button
              key={`${o.kind}:${o.id}`}
              ref={(el) => {
                cards.current[i] = el;
              }}
              type="button"
              className={`lip panel coop-card${o.kind === 'evolve' ? ' evolve' : o.level === 1 && o.kind !== 'heal' ? ' fresh' : ''}${taken?.index === i ? ' chosen' : ''}`}
              onClick={() => take(i)}
              aria-pressed={taken ? taken.index === i : undefined}
            >
              <span className="levelup-key" aria-hidden="true">
                {i + 1}
              </span>
              <img src={spriteDataUrl(d.icon, 4)} alt="" width={48} height={48} />
              <span className="coop-card-text">
                <b>{d.name}</b>
                {d.tag ? <small>{d.tag}</small> : null}
                {/* What it does, as in solo runs (Nov plan A1): clamped to three lines over the running world. */}
                <span className="coop-card-desc">{d.text}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function TeamPanel({ hud, players, slot }: { hud: HudSnapshot; players: CoopPlayer[]; slot: number }) {
  const cvd = usePrefs((p) => p.colorVision);
  const team = hud.coop?.team ?? [];
  return (
    <aside className="coop-team" aria-label={t.team}>
      <ul>
        {team.map((m) => {
          const name = m.index === slot ? t.you : (players[m.index]?.username ?? '');
          const frac = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
          return (
            <li key={m.index} className={`coop-mate ${m.life}`} style={{ ['--mate' as string]: hex(teamTint(m.index, cvd)) }}>
              <span className="coop-mate-name">
                <b>{name}</b>
                <small>{m.life === 'up' ? copy.social.level(m.level) : t.life[m.life]}</small>
              </span>
              <span className="coop-mate-hp" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={Math.round(m.maxHp)} aria-valuenow={Math.round(m.hp)}>
                <i style={{ inlineSize: `${frac * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="coop-team-hint">{copy.coop.marks.hint}</p>
    </aside>
  );
}

/** The teammates the camera can follow while I am out: those still in play (up, or down and waiting for a revive). */
export function spectatable(hud: HudSnapshot, me: number): number[] {
  return (hud.coop?.team ?? []).filter((q) => q.index !== me && (q.life === 'up' || q.life === 'down')).map((q) => q.index);
}

/**
 * Who the camera follows (phase 6c): nobody while I am in play (null: my own probe); out until the next layer, the
 * teammate already followed while they are still in play, else the first one up (else the first one in play).
 */
export function spectateTarget(hud: HudSnapshot, me: number, current: number | null): number | null {
  if (hud.coop?.life !== 'out') return null;
  const can = spectatable(hud, me);
  if (current !== null && can.includes(current)) return current;
  const up = (hud.coop.team ?? []).find((q) => q.index !== me && q.life === 'up');
  return up?.index ?? can[0] ?? null;
}

/** Out until the next layer: whom I am watching, and (with more than one in play) the arrows to switch. */
export function SpectateBar({
  hud,
  players,
  me,
  watching,
  onWatch,
}: {
  hud: HudSnapshot;
  players: CoopPlayer[];
  me: number;
  watching: number;
  onWatch: (slot: number) => void;
}) {
  const cvd = usePrefs((p) => p.colorVision);
  const can = spectatable(hud, me);
  const at = Math.max(0, can.indexOf(watching));
  const step = (d: number) => onWatch(can[(at + d + can.length) % can.length]!);
  const name = players[watching]?.username ?? '';
  return (
    <div className="coop-spectate" style={{ ['--tint' as string]: hex(teamTint(watching, cvd)) }}>
      {can.length > 1 ? (
        <button type="button" className="coop-spectate-arrow" aria-label={t.watchPrev} onClick={() => step(-1)}>
          ‹
        </button>
      ) : null}
      <span role="status">{t.watching(name)}</span>
      {can.length > 1 ? (
        <button type="button" className="coop-spectate-arrow" aria-label={t.watchNext} onClick={() => step(1)}>
          ›
        </button>
      ) : null}
    </div>
  );
}

/** What happens to me: fallen (with the time left) or out until the next layer. */
export function LifeNotice({ hud, downSeconds }: { hud: HudSnapshot; downSeconds: number }) {
  const c = hud.coop;
  if (!c || (c.life !== 'down' && c.life !== 'out')) return null;
  return (
    <div className={`coop-life ${c.life}`} role="status">
      {c.life === 'down' ? t.down(Math.max(0, Math.ceil(c.downLeft ?? downSeconds))) : t.out}
    </div>
  );
}
