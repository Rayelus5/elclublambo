import type { ElementId } from './content/types';

/**
 * What happened during one `step`, for the renderer (effects), the sound and the HUD. The list is emptied at the
 * start of every step; a frame that runs several steps reads them after each one.
 */
export type SimEvent =
  | { t: 'hit'; x: number; y: number; amount: number; crit: boolean; element: ElementId | null }
  | { t: 'kill'; x: number; y: number; enemy: string; elite: boolean }
  | { t: 'hurt'; probe: number; amount: number }
  | { t: 'pickup'; probe: number; kind: 'xp' | 'coin' | 'dust' | 'repair'; value: number }
  | { t: 'levelUp'; probe: number; level: number }
  | { t: 'fire'; weapon: string; x: number; y: number }
  | { t: 'telegraph'; kind: 'charge' | 'burst' | 'explode'; x: number; y: number; angle: number; ticks: number; radius: number }
  | { t: 'bossSpawn'; boss: string; layer: number }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDown'; x: number; y: number }
  | { t: 'beaconOpen'; x: number; y: number }
  | { t: 'beaconClosed' }
  | { t: 'layer'; layer: number }
  | { t: 'extracted' }
  | { t: 'probeDown'; probe: number }
  | { t: 'element'; x: number; y: number; element: ElementId };
