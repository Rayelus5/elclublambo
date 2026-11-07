/**
 * Version of the simulation rules. A recorded run replays only with the same version: bump it whenever a change makes
 * the same seed and inputs play differently (GDD §5.7, §14.7).
 */
export const SIM_VERSION = '1.0.0';

/** Fixed simulation rate (GDD §18.4). */
export const TICK_HZ = 60;

/** Seconds of content data → whole ticks. */
export function ticks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}
