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
  const distance = Math.round(Math.hypot(dx, dy));
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

export type MarkedEvent = { kind: 'satellite' | HudSnapshot['events'][number]['kind']; dx: number; dy: number; left?: number; progress?: number };

/**
 * Something to go for in the run (an abandoned satellite, SIM 1.10.0; the in-run events, 2026-11-16): off screen, an
 * arrow at the screen edge with its name, what to do, how far it is and, when it runs out, the seconds it has left. On
 * screen it says nothing (the stage draws it), but an abandoned ship being looted shows how far along it is.
 */
export function EventMarker({ event, camera, width, height }: { event: MarkedEvent; camera: Camera | null; width: number; height: number }) {
  const zoom = camera?.zoom ?? 2;
  const { x, y, angle, inside } = edgePoint({ width, height, bars: camera?.bars ?? 0 }, event.dx * zoom, event.dy * zoom - (event.kind === 'wreck' ? 34 : 0), 56);
  const looting = event.kind === 'wreck' && (event.progress ?? 0) > 0;
  if (inside && !looting) return null;
  const t = copy.arena.events[event.kind];
  const distance = Math.round(Math.hypot(event.dx, event.dy));
  const details = looting
    ? copy.arena.events.looting(Math.round((event.progress ?? 0) * 100))
    : [t.hint, copy.arena.beaconDistance(distance), event.left !== undefined && event.kind !== 'wreck' ? copy.arena.events.left(Math.ceil(event.left)) : null].filter(Boolean).join(' · ');
  return (
    <div className={`hud-event ${event.kind}${inside ? ' here' : ''}`} style={{ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` } as CSSProperties}>
      {!inside && <span className="hud-event-arrow" aria-hidden="true" style={{ transform: `rotate(${angle}rad)` }} />}
      <span className="hud-event-label">
        <b>{t.name}</b>
        <span>{details}</span>
      </span>
    </div>
  );
}

/** The markers of a snapshot: its satellite and its events. */
export function EventMarkers({ hud, camera, width, height }: { hud: Pick<HudSnapshot, 'satellite' | 'events'>; camera: Camera | null; width: number; height: number }) {
  return (
    <>
      {hud.satellite && <EventMarker event={{ kind: 'satellite', ...hud.satellite }} camera={camera} width={width} height={height} />}
      {hud.events.map((e, k) => (
        <EventMarker key={`${e.kind}-${k}`} event={e} camera={camera} width={width} height={height} />
      ))}
    </>
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
