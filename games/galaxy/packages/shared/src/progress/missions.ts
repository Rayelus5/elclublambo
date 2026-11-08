import { z } from 'zod';

// Missions and achievements (GDD §12.1, §12.3, §14.1; M7a): what is counted, the missions of each period, the
// achievements with their titles and frames, and what the missions screen shows.

/** What missions and achievements count, where it happens (`depth` keeps the deepest, the rest add up). */
export const MISSION_STATS = ['runs', 'minutes', 'kills', 'bossKills', 'extractions', 'depth', 'pulls', 'legendaries', 'fusions', 'disintegrations', 'components'] as const;
export type MissionStat = (typeof MISSION_STATS)[number];
export type MissionCounts = Partial<Record<MissionStat, number>>;

/** The frames an achievement can give (a ring round the avatar). */
export const FRAMES = ['bronze', 'silver', 'gold', 'nebula', 'abyss', 'crown'] as const;
export type Frame = (typeof FRAMES)[number];

const id = z.string().regex(/^[a-z0-9-]{1,32}$/);
const count = z.number().int().min(0).max(10_000_000).default(0);
export const missionRewardSchema = z.object({ coins: count, dust: count, signal: z.number().int().min(0).max(100).default(0), xp: count, points: z.number().int().min(0).max(100_000).default(0) }).strict();
export const missionSchema = z.object({ id, name: z.string().trim().min(1).max(60), stat: z.enum(MISSION_STATS), target: z.number().int().min(1).max(10_000_000), reward: missionRewardSchema }).strict();
export const achievementSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(120),
    stat: z.enum(MISSION_STATS),
    target: z.number().int().min(1).max(10_000_000),
    tier: z.enum(['bronze', 'silver', 'gold']),
    reward: z
      .object({ signal: z.number().int().min(0).max(100).default(0), points: z.number().int().min(0).max(100_000).default(0), title: z.string().trim().min(1).max(30).nullable().default(null), frame: z.enum(FRAMES).nullable().default(null) })
      .strict(),
  })
  .strict();
export type Mission = z.infer<typeof missionSchema>;

/**
 * Events (GDD §13.2, §14.3; M7e-1): goals for a limited time, each one personal or of the clan (its members' runs add
 * up, and each member collects its reward once). They can pay the event's own signals, `signal:<event id>`, that buy
 * pulls on its event scanner.
 */
export const eventRewardSchema = missionRewardSchema.extend({ eventSignals: z.number().int().min(0).max(100).default(0) }).strict();
export type EventReward = z.output<typeof eventRewardSchema>;
export const eventGoalSchema = z
  .object({ id, name: z.string().trim().min(1).max(60), stat: z.enum(MISSION_STATS), target: z.number().int().min(1).max(10_000_000), scope: z.enum(['personal', 'clan']).default('personal'), reward: eventRewardSchema })
  .strict();
export type EventGoal = z.output<typeof eventGoalSchema>;
export const eventSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    goals: z
      .array(eventGoalSchema)
      .min(1)
      .max(12)
      .refine((l) => new Set(l.map((g) => g.id)).size === l.length, 'Hay dos metas con el mismo id'),
  })
  .strict()
  .refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), 'Termina antes de empezar')
  .refine((e) => Date.parse(e.endsAt) - Date.parse(e.startsAt) <= 31 * 86_400_000, 'Dura más de 31 días');
export type GameEvent = z.output<typeof eventSchema>;

/** The events running at `now` (start included, end not). */
export function activeEvents(list: readonly GameEvent[], now: Date): GameEvent[] {
  const t = now.getTime();
  return list.filter((e) => t >= Date.parse(e.startsAt) && t < Date.parse(e.endsAt));
}
export type Achievement = z.infer<typeof achievementSchema>;

const m = (mid: string, name: string, stat: MissionStat, target: number, reward: Partial<z.input<typeof missionRewardSchema>>) => ({ id: mid, name, stat, target, reward });
export const DEFAULT_DAILY = [
  m('d-runs3', 'Juega 3 incursiones', 'runs', 3, { coins: 150, xp: 50, points: 10 }),
  m('d-kills300', 'Elimina 300 enemigos', 'kills', 300, { coins: 150, dust: 20, points: 10 }),
  m('d-boss1', 'Purga un Núcleo', 'bossKills', 1, { dust: 40, points: 15 }),
  m('d-extract1', 'Extrae una vez', 'extractions', 1, { coins: 200, points: 15 }),
  m('d-minutes20', 'Juega 20 minutos', 'minutes', 20, { coins: 120, xp: 60, points: 10 }),
  m('d-pull1', 'Haz una tirada', 'pulls', 1, { dust: 15, points: 5 }),
  m('d-depth2', 'Llega a la capa 2', 'depth', 2, { coins: 150, points: 10 }),
];
export const DEFAULT_WEEKLY = [
  m('w-runs15', 'Juega 15 incursiones', 'runs', 15, { coins: 800, signal: 1, points: 50 }),
  m('w-boss5', 'Purga 5 Núcleos', 'bossKills', 5, { dust: 200, signal: 1, points: 60 }),
  m('w-kills3000', 'Elimina 3.000 enemigos', 'kills', 3000, { coins: 900, points: 50 }),
  m('w-extract5', 'Extrae 5 veces', 'extractions', 5, { coins: 1000, signal: 1, points: 60 }),
  m('w-fuse2', 'Fusiona 2 veces', 'fusions', 2, { dust: 150, points: 30 }),
  m('w-components200', 'Recoge 200 componentes', 'components', 200, { coins: 600, points: 30 }),
];
export const DEFAULT_SEASON = [
  m('s-runs100', 'Juega 100 incursiones', 'runs', 100, { signal: 5, points: 300 }),
  m('s-boss40', 'Purga 40 Núcleos', 'bossKills', 40, { signal: 5, points: 400 }),
  m('s-depth5', 'Llega a la capa 5', 'depth', 5, { signal: 3, points: 300 }),
  m('s-legend3', 'Consigue 3 legendarias', 'legendaries', 3, { dust: 500, points: 200 }),
];
const a = (aid: string, name: string, description: string, stat: MissionStat, target: number, tier: 'bronze' | 'silver' | 'gold', reward: { signal: number; title?: string; frame?: Frame }) => ({
  id: aid,
  name,
  description,
  stat,
  target,
  tier,
  reward: { signal: reward.signal, points: tier === 'bronze' ? 20 : tier === 'silver' ? 50 : 120, title: reward.title ?? null, frame: reward.frame ?? null },
});
export const DEFAULT_ACHIEVEMENTS = [
  a('a-first-run', 'Primer despegue', 'Juega tu primera incursión', 'runs', 1, 'bronze', { signal: 1, title: 'Cadete' }),
  a('a-legend1', 'Primera legendaria', 'Consigue una galaxia legendaria', 'legendaries', 1, 'bronze', { signal: 1, frame: 'bronze' }),
  a('a-runs50', 'Veterano', 'Juega 50 incursiones', 'runs', 50, 'silver', { signal: 2, title: 'Veterano', frame: 'silver' }),
  a('a-boss10', 'Purgador', 'Purga 10 Núcleos', 'bossKills', 10, 'silver', { signal: 2, title: 'Purgador' }),
  a('a-kills10k', 'Exterminador', 'Elimina 10.000 enemigos', 'kills', 10_000, 'silver', { signal: 2, title: 'Exterminador' }),
  a('a-fuse10', 'Alquimista', 'Fusiona 10 veces', 'fusions', 10, 'silver', { signal: 2, title: 'Alquimista' }),
  a('a-extract25', 'Siempre vuelvo', 'Extrae 25 veces', 'extractions', 25, 'silver', { signal: 2, title: 'Superviviente' }),
  a('a-depth5', 'Abismo', 'Llega a la capa 5', 'depth', 5, 'gold', { signal: 3, title: 'Abisal', frame: 'abyss' }),
  a('a-boss100', 'Azote de Núcleos', 'Purga 100 Núcleos', 'bossKills', 100, 'gold', { signal: 5, frame: 'nebula' }),
  a('a-runs500', 'Leyenda del ECN', 'Juega 500 incursiones', 'runs', 500, 'gold', { signal: 5, title: 'Leyenda del ECN', frame: 'gold' }),
];

/** FNV-1a of a string, for a draw that is the same for everyone in a period. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The `count` missions of a period: the pool ordered by a hash of the period and each id (the same for everyone). */
export function pickMissions<T extends { id: string }>(pool: readonly T[], count: number, period: string): T[] {
  return [...pool].sort((x, y) => fnv(`${period}:${x.id}`) - fnv(`${period}:${y.id}`) || x.id.localeCompare(y.id)).slice(0, Math.max(0, count));
}

/** The ISO week (YYYY-Www) of a calendar day YYYY-MM-DD. */
export function isoWeekOf(day: string): string {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export interface MissionView {
  id: string;
  name: string;
  stat: MissionStat;
  target: number;
  progress: number;
  claimed: boolean;
  reward: z.output<typeof missionRewardSchema>;
}
export interface MissionPeriodView {
  /** `d:<day>`, `w:<week>` or `s:<season>`: what a claim names. */
  period: string;
  /** When its missions change (null for the season's: they end with it). */
  endsAt: string | null;
  missions: MissionView[];
}
export interface AchievementView {
  id: string;
  name: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold';
  target: number;
  progress: number;
  unlocked: boolean;
  claimed: boolean;
  reward: Achievement['reward'];
}
export interface EventGoalView {
  id: string;
  name: string;
  stat: MissionStat;
  target: number;
  scope: 'personal' | 'clan';
  /** Yours, or your clan's for a clan goal (0 without a clan). */
  progress: number;
  claimed: boolean;
  reward: EventReward;
}
export interface EventView {
  id: string;
  name: string;
  description: string;
  endsAt: string;
  /** `e:<id>`: what a claim names. */
  period: string;
  goals: EventGoalView[];
  /** In a clan now (clan goals count only then). */
  inClan: boolean;
}
export interface MissionsView {
  daily: MissionPeriodView;
  weekly: MissionPeriodView;
  season: MissionPeriodView | null;
  /** The events running now (M7e-1). */
  events: EventView[];
  achievements: AchievementView[];
  /** How many missions and achievements are ready to collect. */
  ready: number;
  cosmetics: { titles: string[]; frames: Frame[]; title: string | null; frame: Frame | null };
}
export const cosmeticsSchema = z.object({ title: z.string().trim().min(1).max(30).nullable(), frame: z.enum(FRAMES).nullable() }).strict();
export const missionClaimParamsSchema = z.object({ period: z.string().regex(/^(d|w|s|e):[A-Za-z0-9-]{1,32}$/), id }).strict();
export const achievementClaimParamsSchema = z.object({ id }).strict();
