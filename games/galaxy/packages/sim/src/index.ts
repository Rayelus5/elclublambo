// @galaxy/sim: the deterministic run simulation (GDD §5, §18.4). Isomorphic: no DOM, no Node APIs, no clocks.
export { SIM_VERSION, TICK_HZ, ticks } from './version';
export { Rng } from './math/rng';
export { ANGLE_STEPS, angleTo, cosA, degToSteps, sinA } from './math/trig';
export { diminish } from './math/stack';
export * from './content/index';
