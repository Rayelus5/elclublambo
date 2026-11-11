import type { HudSnapshot } from '@galaxy/sim';
import type { CSSProperties } from 'react';
import { copy } from '../../copy/es';
import type { Camera } from '../stage/camera';
import { edgePoint } from '../stage/edge';

// Boss bar, beacon marker and PERKINS on the radio (DESIGN_SYSTEM §8 quinquies).

export function BossBar({ boss }: { boss: NonNullable<HudSnapshot['boss']> }) {
  const p = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
  return (
    <div className="hud-boss" role="group" aria-label={`${boss.title}: ${boss.name}`}>
      <span className="hud-boss-title">{boss.title}</span>
      <b className="hud-boss-name">{boss.name}</b>
      <div className="hud-boss-bar" role="progressbar" aria-label={boss.name} aria-valuemin={0} aria-valuemax={Math.round(boss.maxHp)} aria-valuenow={Math.round(boss.hp)} style={{ '--p': `${p}%` } as CSSProperties}>
        <i />
      </div>
    </div>
  );
}

/** The beacon: a marker at the screen edge pointing at it when it is off screen, or a label over it. */
export function BeaconMarker({ beacon, camera, width, height }: { beacon: NonNullable<HudSnapshot['beacon']>; camera: Camera | null; width: number; height: number }) {
  const zoom = camera?.zoom ?? 2;
  // Measured from where the camera looks (a teammate's probe while out until the next layer), else from my probe.
  const dx = camera ? beacon.x - camera.x : beacon.dx;
  const dy = camera ? beacon.y - camera.y : beacon.dy;
  const { x, y, angle, inside } = edgePoint({ width, height, bars: camera?.bars ?? 0 }, dx * zoom, dy * zoom - 40, 56);
  const holding = beacon.hold > 0 && beacon.hold < beacon.holdNeeded;
  const distance = Math.round(Math.hypot(beacon.dx, beacon.dy));
  return (
    <div className={`hud-beacon${inside ? ' here' : ''}`} style={{ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` } as CSSProperties}>
      {!inside && <span className="hud-beacon-arrow" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }} />}
      <span className="hud-beacon-label">
        <b>{holding ? copy.arena.extracting : copy.arena.reachBeacon}</b>
        <span>{holding ? `${Math.round((beacon.hold / beacon.holdNeeded) * 100)} %` : `${copy.arena.beaconLeft(Math.ceil(beacon.left))} · ${copy.arena.beaconDistance(distance)}`}</span>
      </span>
    </div>
  );
}

export function Radio({ text, onClose }: { text: string; onClose: () => void }) {
  const [who, ...rest] = text.split(': ');
  return (
    <div className="hud-radio lip panel" role="status" aria-label="PERKINS">
      <span className="hud-radio-who">
        {who}
        <span className="sr-only">: </span>
      </span>
      <p>{rest.join(': ')}</p>
      <button type="button" className="hud-radio-close" onClick={onClose} aria-label={copy.arena.closeRadio}>
        ×
      </button>
    </div>
  );
}
