import type { ConfigValue } from '../config/registry';

// The station's rooms (GDD §10; M4a plan rulings 2–3). Each room is a tool that opens its screen. The tools that the
// game already has work from the start; the refinery works at level 1 (without it there are no components to repair
// anything with); the antenna starts broken and is repaired with components; the rooms of later milestones stay «en
// reparación». Only the refinery and the antenna have levels in M4a; the Laboratorio (M4b-2) is repaired once.

export const ROOM_IDS = ['scanner', 'planetarium', 'lab', 'hangar', 'collider', 'comms', 'refinery', 'antenna', 'archive', 'trophies'] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export type StationConfig = ConfigValue<'station'>;

/** How each room starts and whether it can be upgraded now. */
export const ROOMS: Record<RoomId, { kind: 'tool' | 'machine' | 'future'; initial: number }> = {
  scanner: { kind: 'tool', initial: 1 },
  planetarium: { kind: 'tool', initial: 1 },
  lab: { kind: 'machine', initial: 0 },
  hangar: { kind: 'tool', initial: 1 },
  collider: { kind: 'tool', initial: 1 },
  comms: { kind: 'tool', initial: 1 },
  refinery: { kind: 'machine', initial: 1 },
  antenna: { kind: 'machine', initial: 0 },
  archive: { kind: 'tool', initial: 1 },
  trophies: { kind: 'tool', initial: 1 },
};

export interface RoomCost {
  components: number;
  coins: number;
}

export interface RoomStatus {
  /** working: opens its screen; broken: repairable now; future: arrives with a later milestone. */
  state: 'working' | 'broken' | 'future';
  level: number;
  maxLevel: number;
  /**
   * The cost of the next level (the repair, from level 0), or null at the top or when it cannot be repaired yet; and
   * what that level gives a machine (its rate, and the refinery's queue), so the panel can compare it with now.
   */
  next: { cost: RoomCost; gives?: { rate: number; capacity?: number } } | null;
}

/** The levels of a machine: index i is level i + 1 and its cost is what reaching it costs. */
function machineLevels(id: RoomId, cfg: StationConfig): readonly { cost: RoomCost }[] {
  return id === 'refinery' ? cfg.refinery : id === 'antenna' ? cfg.antenna.levels : id === 'lab' ? cfg.lab.levels : [];
}

export function roomStatus(id: RoomId, level: number, cfg: StationConfig): RoomStatus {
  const room = ROOMS[id];
  if (room.kind === 'future') return { state: 'future', level: 0, maxLevel: 0, next: null };
  if (room.kind === 'tool') return { state: 'working', level: 1, maxLevel: 1, next: null };
  const levels = machineLevels(id, cfg);
  const at = levels[level] as { cost: RoomCost; rate?: number; queue?: number } | undefined;
  const gives = at?.rate === undefined ? undefined : { rate: at.rate, ...(at.queue === undefined ? {} : { capacity: at.queue }) };
  const next = at ? { cost: { ...at.cost }, ...(gives ? { gives } : {}) } : null;
  return { state: level === 0 ? 'broken' : 'working', level, maxLevel: levels.length, next };
}
