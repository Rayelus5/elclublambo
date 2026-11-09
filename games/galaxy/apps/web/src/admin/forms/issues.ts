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
};

const PREFIXED: Record<string, (rest: string) => string> = {
  lab_duplicate: (id) => `Hay dos nodos «${id}»`,
  lab_requires: (id) => `El nodo «${id}» necesita uno que no existe`,
  lab_cycle: (id) => `El nodo «${id}» se necesita a sí mismo en cadena`,
  lab_payout_cap: (c) => `Las mejoras de pago de ${c === 'coins' ? 'monedas' : c === 'dust' ? 'polvo' : 'material'} suman más de la mitad`,
};

export function issueText(message: string): string {
  if (CODES[message]) return CODES[message];
  const [code, rest] = message.split(':', 2);
  if (code && rest !== undefined && PREFIXED[code]) return PREFIXED[code](rest);
  return message;
}

/** The issues by path («list.0.target»), translated. */
export function issuesByPath(issues: { path: string; message: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const i of issues) map.set(i.path, [...(map.get(i.path) ?? []), issueText(i.message)]);
  return map;
}
