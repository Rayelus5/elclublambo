import type { Content, HudSnapshot } from '@galaxy/sim';
import type { CSSProperties } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { spriteDataUrl } from '../sprites';

// The run's HUD (DESIGN_SYSTEM §8 quinquies): experience across the top, life and level on the left, time and layer
// in the middle, loot and pause on the right, the build along the bottom. Read a few times per second from the
// simulation, never every frame.

const pct = (v: number, max: number) => ({ '--p': `${Math.max(0, Math.min(100, max > 0 ? (v / max) * 100 : 0))}%` }) as CSSProperties;

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Kit({ items, content, kind }: { items: { id: string; level: number }[]; content: Content; kind: 'weapon' | 'passive' }) {
  const label = kind === 'weapon' ? copy.arena.weapons : copy.arena.passives;
  return (
    <ul className={`hud-kit-row ${kind}`} aria-label={label}>
      {items.map((it) => {
        const def = kind === 'weapon' ? content.weapons.find((w) => w.id === it.id) : content.passives.find((p) => p.id === it.id);
        if (!def) return null;
        return (
          <li key={it.id} className="hud-kit-item" title={`${def.name} · ${copy.arena.level(it.level)}`}>
            <img src={spriteDataUrl(def.icon, 3)} alt="" width={36} height={36} />
            <span className="sr-only">{`${def.name}, ${copy.arena.level(it.level).toLowerCase()}`}</span>
            <b aria-hidden="true">{it.level}</b>
          </li>
        );
      })}
    </ul>
  );
}

export function Hud({ hud, content, onPause, announce }: { hud: HudSnapshot; content: Content; onPause: () => void; announce: string }) {
  const hp = Math.max(0, Math.round(hud.hp));
  const maxHp = Math.round(hud.maxHp);
  const low = hud.hp <= hud.maxHp * 0.3;
  const phaseText = hud.phase === 'waves' ? copy.arena.coreIn(clockText(hud.phaseLeft)) : hud.phase === 'boss' ? copy.arena.core : copy.arena.beaconLeft(Math.ceil(hud.phaseLeft));
  return (
    <div className="arena-hud">
      <div className="hud-xp" role="progressbar" aria-label={copy.arena.xp} aria-valuemin={0} aria-valuemax={hud.xpNext} aria-valuenow={Math.floor(hud.xp)} style={pct(hud.xp, hud.xpNext)}>
        <i />
      </div>
      <div className="hud-top">
        <div className="hud-vitals lip panel">
          <span className="hud-level">{copy.arena.levelShort(hud.level)}</span>
          <div className={`hud-hp${low ? ' low' : ''}`} role="progressbar" aria-label={copy.arena.hp} aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp} style={pct(hp, maxHp)}>
            <i />
            {hud.shield > 0 && <s style={pct(hud.shield, hud.maxHp)} />}
            <b>
              {hp}
              <small>/{maxHp}</small>
            </b>
          </div>
        </div>
        <div className="hud-center lip panel">
          <span className="hud-time" aria-label={`${copy.arena.time} ${clockText(hud.tick / 60)}`}>
            {clockText(hud.tick / 60)}
          </span>
          <span className="hud-layer">{copy.arena.layer(hud.layer)}</span>
          <span className={`hud-phase ${hud.phase}`}>{phaseText}</span>
        </div>
        <div className="hud-right lip panel">
          <span className="hud-res coin" role="img" aria-label={`${Math.floor(hud.loot.coins)} ${copy.arena.coins.toLowerCase()}`}>
            <Icon name="coin" />
            <b aria-hidden="true">{Math.floor(hud.loot.coins)}</b>
          </span>
          <span className="hud-res dust" role="img" aria-label={`${Math.floor(hud.loot.dust)} de ${copy.arena.dust.toLowerCase()}`}>
            <Icon name="dust" />
            <b aria-hidden="true">{Math.floor(hud.loot.dust)}</b>
          </span>
          <span className="hud-res kills" role="img" aria-label={`${hud.kills} ${copy.arena.kills.toLowerCase()}`}>
            <Icon name="target" />
            <b aria-hidden="true">{hud.kills}</b>
          </span>
          <button type="button" className="lip pill icon hud-pause" onClick={onPause} aria-label={copy.arena.pauseButton}>
            <Icon name="pause" />
          </button>
        </div>
      </div>
      <div className="hud-kit">
        <Kit items={hud.weapons} content={content} kind="weapon" />
        <Kit items={hud.passives} content={content} kind="passive" />
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
