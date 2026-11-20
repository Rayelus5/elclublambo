import type { WeaponKind, WeaponLevel } from './types';

/**
 * The numbers of a level each kind of weapon reads (the content editor, 2026-11-16, P6): the level table dims the
 * others. test/weapon-fields.test.ts proves it: changing a number a kind leaves out changes nothing in a run. A new kind,
 * or a kind that starts reading a number, updates this map in the same change.
 */
export const WEAPON_FIELDS: Record<WeaponKind, readonly (keyof WeaponLevel)[]> = {
  bolt: ['damage', 'cooldown', 'count', 'pierce', 'speed', 'range'],
  nova: ['damage', 'cooldown', 'area', 'knockback'],
  lance: ['damage', 'cooldown', 'count', 'pierce', 'speed', 'range'],
  orbit: ['damage', 'count', 'area', 'speed', 'interval'],
  trail: ['damage', 'cooldown', 'area', 'duration', 'interval'],
  ricochet: ['damage', 'cooldown', 'speed', 'bounces', 'range'],
  drone: ['damage', 'cooldown', 'count', 'speed', 'range'],
  beam: ['damage', 'cooldown', 'count', 'range', 'area', 'duration', 'interval'],
  cone: ['damage', 'cooldown', 'range', 'area', 'duration', 'interval'],
  radial: ['damage', 'cooldown', 'count', 'pierce', 'speed', 'range'],
  homing: ['damage', 'cooldown', 'count', 'speed', 'range', 'area'],
  mine: ['damage', 'cooldown', 'count', 'area', 'range', 'duration'],
  boomerang: ['damage', 'cooldown', 'count', 'speed', 'range', 'interval'],
  field: ['damage', 'cooldown', 'range', 'area', 'duration', 'interval', 'knockback'],
  strike: ['damage', 'cooldown', 'count', 'range', 'area', 'interval'],
  turret: ['damage', 'cooldown', 'count', 'duration', 'interval', 'range', 'speed'],
  harpoon: ['damage', 'cooldown', 'count', 'speed', 'range', 'knockback'],
  sling: ['damage', 'cooldown', 'count', 'speed', 'range', 'area'],
  decoy: ['damage', 'cooldown', 'count', 'duration', 'range', 'area'],
  lighthouse: ['damage', 'count', 'speed', 'range', 'area', 'interval'],
  mortar: ['damage', 'cooldown', 'count', 'speed', 'range', 'area', 'interval'],
};
