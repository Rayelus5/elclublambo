import type { ElementId } from './content/types';

/**
 * What happened during one `step`, for the renderer (effects), the sound and the HUD. The list is emptied at the
 * start of every step; a frame that runs several steps reads them after each one.
 */
export type SimEvent =
  | { t: 'hit'; x: number; y: number; amount: number; crit: boolean; element: ElementId | null }
  | { t: 'kill'; x: number; y: number; enemy: string; elite: boolean }
  | { t: 'hurt'; probe: number; amount: number }
  | { t: 'pickup'; probe: number; kind: 'xp' | 'coin' | 'dust' | 'repair' | 'magnet' | 'component'; value: number }
  /** A breakable prop of the ground broke (systems/props.ts). */
  | { t: 'propBreak'; x: number; y: number; look: number }
  /** A dash (a quirk's jump, a comet's charge): from (fx, fy) to (tx, ty) over `ticks` (0: instant), for the effects. */
  | { t: 'dash'; probe: number; kind: 'quirk' | 'comet'; fx: number; fy: number; tx: number; ty: number; ticks: number }
  | { t: 'levelUp'; probe: number; level: number }
  | { t: 'evolve'; probe: number; from: string; to: string }
  | { t: 'fire'; weapon: string; x: number; y: number }
  /**
   * A warning before a strike. Nov plan B4: `laser` is a beam `radius` long from (x, y) along `angle` that will turn `arc`
   * steps (signed); `closing` is a ring of `radius` around (x, y) closing in, its way out `arc` steps wide around `angle`.
   */
  | {
      t: 'telegraph';
      kind: 'charge' | 'burst' | 'explode' | 'lance' | 'blink' | 'laser' | 'closing';
      x: number;
      y: number;
      angle: number;
      ticks: number;
      radius: number;
      arc?: number;
    }
  /** A healer's or corruptor's pulse (GDD §5.5). */
  | { t: 'support'; x: number; y: number; range: number; effect: 'heal' | 'shield' }
  /** A warned teleport has landed (fauna or a Core). */
  | { t: 'blink'; fx: number; fy: number; tx: number; ty: number }
  /** A warned blast (a Core's mines) has gone off. */
  | { t: 'blast'; x: number; y: number; radius: number }
  | { t: 'bossSpawn'; boss: string; layer: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDown'; x: number; y: number }
  | { t: 'beaconOpen'; x: number; y: number }
  | { t: 'beaconClosed' }
  | { t: 'layer'; layer: number }
  | { t: 'extracted' }
  | { t: 'probeDown'; probe: number }
  /** Co-op: a fallen probe is back on its feet (`by`: who revived it), out until the next layer, back in, away. */
  | { t: 'probeRevived'; probe: number; by: number }
  | { t: 'probeOut'; probe: number }
  | { t: 'probeBack'; probe: number }
  | { t: 'presence'; probe: number; life: 'up' | 'away' | 'left' }
  /** Co-op: the time to pick ran out and a card was taken for the player. */
  | { t: 'offerAuto'; probe: number; index: number }
  | { t: 'element'; x: number; y: number; element: ElementId }
  | { t: 'reaction'; id: string; x: number; y: number }
  | { t: 'quirk'; probe: number; kind: string }
  /** Fase cuántica (Nov plan B2): a hit went through the probe without harm. */
  | { t: 'evade'; probe: number };
