import { MIN_FAMILIES } from '@galaxy/sim';

// What a config draft has wrong, said for an admin (polish phase 4). Zod's own messages arrive in Spanish already; the
// checks the schemas add across fields arrive as codes, translated here.

const CODES: Record<string, string> = {
  must_sum_to_1: 'Los porcentajes tienen que sumar 100 %',
  hard_before_soft: 'La legendaria segura no puede llegar antes de que empiece a subir la suerte',
  duplicate_banner_id: 'Hay dos escáneres con el mismo identificador',
  event_needs_featured_and_own_signals: 'Un escáner de evento necesita un rasgo destacado y pagarse con las señales de su evento («signal:<evento>»)',
  daily_shape: 'Tiene que haber un tramo de pago más que horas',
  daily_hours_increasing: 'Las horas tienen que ir de menos a más',
  daily_multipliers_decreasing: 'Cada tramo tiene que pagar igual o menos que el anterior',
  refinery_levels_increasing: 'Cada nivel de la refinería tiene que dar igual o más que el anterior',
  antenna_levels_increasing: 'Cada nivel de la antena tiene que dar igual o más que el anterior',
  account_levels_increasing: 'Cada nivel tiene que pedir más experiencia que el anterior',
  season_tiers_increasing: 'Cada rango tiene que pedir más puntos que el anterior',
  season_dates: 'La temporada tiene que terminar después de empezar',
  lab_fusion_cap: 'Los descuentos de fusión del laboratorio suman más de la mitad',
  'minPrice grows with the tier': 'El precio mínimo tiene que crecer con la rareza',
  'maxPrice is at least the legendary floor': 'El precio máximo no puede ser menor que el mínimo de una legendaria',
  // The run content's own checks (the content editor, 2026-11-16).
  group_order: 'El mínimo del grupo no puede ser mayor que el máximo',
  props_dust_range: 'El polvo máximo no puede ser menor que el mínimo',
  satellites_window: 'El último momento en que puede salir no puede ser antes que el primero',
  satellites_chances: 'Cada satélite de más tiene que ser igual o menos probable que el anterior',
  events_slot: 'Cada hueco del calendario tiene que terminar después de empezar',
  dash_too_fast: 'El dash es demasiado rápido: recorre demasiada distancia de golpe',
  reserved_id: 'Ese identificador está reservado: elige otro',
};

/** The collections of the run content, as an admin names them. */
const CATALOGS: Record<string, string> = {
  probes: 'las sondas',
  weapons: 'las armas',
  passives: 'las pasivas',
  enemies: 'los enemigos',
  elites: 'los élites',
  bosses: 'los Núcleos',
  sectors: 'los sectores',
  anomalies: 'las anomalías',
};

/** The value at a dotted path («sectors.0.spawns.2.enemy») of the content being checked. */
function valueAt(root: unknown, path: string): unknown {
  let at: unknown = root;
  for (const part of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

const PREFIXED: Record<string, (rest: string, root: unknown) => string> = {
  content_dup: (catalog) => `Hay dos entradas con el mismo identificador en ${CATALOGS[catalog] ?? catalog}`,
  content_ref: (path, root) => `Apunta a «${String(valueAt(root, path) ?? '')}», que no existe`,
  content_evolution: () =>
    'La evolución no vale: su arma base tiene que existir, ser del mismo tipo y no ser otra evolución, con una sola evolución por arma; la evolución tiene un solo nivel y su pasiva tiene que existir',
  content_variant: () => 'La variante no vale: su arma base tiene que ser un arma normal del mismo tipo, sin evolución propia, y solo una variante por nivel',
  content_reaction: () => 'La reacción tiene que unir dos elementos distintos, y cada pareja solo puede tener una reacción',
  content_set: () => 'Los tramos del conjunto tienen que pedir cada vez más reliquias',
  content_phases: () => 'Las fases tienen que empezar con la vida llena y bajar en orden',
  content_cycle: () => 'El ciclo de Núcleos tiene que empezar por el Núcleo del propio sector',
  content_art: (id) => `El dibujo «${id}» no existe en el juego: elige uno de la galería`,
  lab_duplicate: (id) => `Hay dos nodos «${id}»`,
  lab_requires: (id) => `El nodo «${id}» necesita uno que no existe`,
  lab_cycle: (id) => `El nodo «${id}» se necesita a sí mismo en cadena`,
  lab_payout_cap: (c) => `Las mejoras de pago de ${c === 'coins' ? 'monedas' : c === 'dust' ? 'polvo' : 'material'} suman más de la mitad`,
};

/** The run content's warnings (P7): allowed, probably not wanted; `arg` names what they are about. */
const WARNINGS: Record<string, (arg: string) => string> = {
  sector_hp_order: (prev) => `Sus enemigos no aguantan más que en ${prev}, el sector anterior: los sectores van de más fácil a más difícil`,
  sector_core_order: (prev) => `Su Núcleo no hace más daño que en ${prev}, el sector anterior`,
  season_not_hardest: () => 'El sector de temporada debería ser el más duro de todos',
  sector_families: (n) => `Solo mezcla ${n} familias de enemigos; un sector normal debería tener al menos ${MIN_FAMILIES}`,
  weapon_no_evolution: () => 'Esta arma no evoluciona en ninguna',
  enemy_unused: () => 'No sale en ningún sector ni la invoca o la suelta nadie',
  boss_unused: () => 'Ningún sector lo usa',
  events_sector_unknown: (id) => `Tiene pesos para el sector «${id}», que no existe`,
  sector_no_unlock: (name) => `${name} no tiene condición de desbloqueo: estará abierto para todos desde el principio`,
  sector_no_pay: (name) => `${name} no tiene paga propia: pagará como un sector normal`,
  season_sector_not_live: (name) => `${name} es de temporada, pero la temporada viva usa otro sector: nadie podrá jugarlo`,
  probe_no_unlock: (name) => `${name} no tiene condición de desbloqueo: la tendrán todos desde el principio`,
};

export function warningText(w: { code: string; arg?: string }): string {
  return WARNINGS[w.code]?.(w.arg ?? '') ?? w.code;
}

/** `root`: the value being checked, so a wrong reference can be named (the run content). */
export function issueText(message: string, root?: unknown): string {
  if (CODES[message]) return CODES[message];
  const [code, rest] = message.split(':', 2);
  if (code && rest !== undefined && PREFIXED[code]) return PREFIXED[code](rest, root);
  return message;
}

/** The issues by path («list.0.target»), translated. */
export function issuesByPath(issues: { path: string; message: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const i of issues) map.set(i.path, [...(map.get(i.path) ?? []), issueText(i.message)]);
  return map;
}
