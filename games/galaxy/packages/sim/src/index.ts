// @galaxy/sim: the deterministic run simulation (GDD §5, §18.4). Isomorphic: no DOM, no Node APIs, no clocks.
export { SIM_VERSION, TICK_HZ, ticks } from './version';
export { Rng } from './math/rng';
export { ANGLE_STEPS, angleTo, cosA, degToSteps, sinA } from './math/trig';
export { diminish } from './math/stack';
export * from './content/index';
export * from './types';
export type { SimEvent } from './events';
export { createSim, step } from './sim';
export { runSummary, stateHash } from './summary';
export { SpatialGrid } from './world/grid';
export { createPool, type Pool } from './world/pool';
export * from './world/pools';
export { deriveStats, refreshStats, relicHooks, type StatBonus } from './systems/stats';
export { applyOffer, offerFor } from './systems/upgrades';
export { gainXp, xpFor } from './systems/xp';
export { dealDamage, killEnemy } from './systems/combat';
export {
  angleDiff,
  ELITE_CODE,
  fireFoeBullet,
  hitsFront,
  nearestProbe,
  NO_SCALE,
  probesCentre,
  spawnEnemy,
  spawnPoint,
  STATE,
  statusHooks,
  updateEnemies,
  type Scale,
} from './systems/enemies';
export { curseOf, direct, layerSeconds, relocate, scaleAt } from './systems/director';
export { dropPickup } from './systems/pickups';
export { hurtProbe, PROBE_RADIUS, shieldCapacity } from './systems/probes';
export {
  AREA,
  fireWeapons,
  hitArea,
  nearestEnemies,
  persistentFor,
  SHOT,
  shotHooks,
  spawnArea,
  spawnShot,
  updateAreas,
  updateShots,
  weaponDef,
} from './systems/weapons';
export {
  applyElement,
  critBonus,
  damageFactor,
  elementCode,
  elementOf,
  invertNearby,
  plainDamage,
  relicElement,
  resolveElement,
  tickStatuses,
} from './systems/elements';
export { describeRelic, relicBonuses, relicSkill, relicVision, updateRelics, type RelicSkill } from './systems/relics';
export { bossDef, spawnBoss, updateBoss } from './systems/boss';
export { nextLayer, onBossDown, updateLayer } from './systems/layers';
export { hudSnapshot, type HudSnapshot } from './snapshot';
export { decodeLog, encodeLog, fromBase64, logTicks, replay, toBase64 } from './recording';
export { botInput, botPick } from './bot';
