import type { CoopPlayer } from '@galaxy/shared';
import type { Content, HudSnapshot } from '@galaxy/sim';
import { useEffect } from 'react';
import { describeOffer } from '../arena/hud/LevelUp';
import { spriteDataUrl } from '../arena/sprites';
import { TEAM_TINT } from '../arena/stage/stage';
import { copy } from '../copy/es';
import { typing } from '../ui/keys';

// The co-op HUD (multiplayer plan, phase 6): the cards without pause (a strip at the bottom: 1, 2 or 3 picks at once,
// a click too, and the time left before one is taken at random; the arrows keep moving the probe), the team (life
// and state of everyone), and the notices of falling and being out.

const t = copy.coop.arena;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** `onPick(i, seq)`: the card and the offer it was on, as shown (never a newer one the frame loop already has). */
export function CoopCards({ hud, content, pickSeconds, onPick }: { hud: HudSnapshot; content: Content; pickSeconds: number; onPick: (i: number, seq: number) => void }) {
  const offer = hud.offer;
  const seq = hud.coop?.offerSeq ?? 0;
  useEffect(() => {
    if (!offer) return;
    function onKey(e: KeyboardEvent): void {
      if (typing(e)) return;
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= offer!.length) {
        onPick(n - 1, seq);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offer, onPick, seq]);
  if (!offer) return null;
  const left = Math.ceil(hud.coop?.pickLeft ?? 0);
  const total = Math.max(1, pickSeconds);
  return (
    <section className="coop-cards" aria-label={t.cards}>
      <header>
        <b>{t.cards}</b>
        <span className="coop-cards-hint">{t.cardsHint}</span>
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
            <button key={`${o.kind}:${o.id}`} type="button" className={`lip panel coop-card${o.kind === 'evolve' ? ' evolve' : ''}`} onClick={() => onPick(i, seq)}>
              <span className="levelup-key" aria-hidden="true">
                {i + 1}
              </span>
              <img src={spriteDataUrl(d.icon, 3)} alt="" width={36} height={36} />
              <span className="coop-card-text">
                <b>{d.name}</b>
                {d.tag ? <small>{d.tag}</small> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function TeamPanel({ hud, players, slot }: { hud: HudSnapshot; players: CoopPlayer[]; slot: number }) {
  const team = hud.coop?.team ?? [];
  return (
    <aside className="coop-team" aria-label={t.team}>
      <ul>
        {team.map((m) => {
          const name = m.index === slot ? t.you : (players[m.index]?.username ?? '');
          const frac = m.maxHp > 0 ? Math.max(0, Math.min(1, m.hp / m.maxHp)) : 0;
          return (
            <li key={m.index} className={`coop-mate ${m.life}`} style={{ ['--mate' as string]: hex(TEAM_TINT[m.index % TEAM_TINT.length]!) }}>
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
