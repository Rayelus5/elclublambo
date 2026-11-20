import type { Content } from '@galaxy/sim';
import type { IconName } from '../../../ui/Icon';
import type { FieldInfo } from '../../forms/labels';
import { part as arsenal } from './arsenal';
import { part as cores } from './cores';
import { part as elements } from './elements';
import { part as events } from './events';
import { part as fauna } from './fauna';
import { part as probes } from './probes';
import { part as relics } from './relics';
import { part as rules } from './rules';
import { part as sectors } from './sectors';
import { part as technical } from './technical';
import type { DescriptorPart, FieldDesc, Vocab, VocabName } from './types';

export type { DescriptorPart, FieldDesc, Term, Vocab, VocabName } from './types';

// The content editor's areas and descriptors (2026-11-16, P4): the run content split the way an admin thinks about it,
// every field named and explained (descriptors/*.ts). A top-level field no area names lands in «Otros», so what the game
// adds later still shows (and a test asks for its descriptors).

export interface AreaDesc {
  id: string;
  title: string;
  /** What the area holds, in a sentence (no final period). */
  summary: string;
  icon: IconName;
  /** The top-level fields of the content it edits, in order. */
  keys: (keyof Content)[];
}

export const AREAS: readonly AreaDesc[] = [
  { id: 'arsenal', title: 'Arsenal', summary: 'Armas, sus evoluciones y variantes, y las mejoras pasivas', icon: 'target', keys: ['weapons', 'passives'] },
  { id: 'sondas', title: 'Sondas', summary: 'Las naves que se juegan, su arma inicial y su rasgo', icon: 'probe', keys: ['probes'] },
  { id: 'fauna', title: 'Fauna', summary: 'Los enemigos, su comportamiento y sus élites', icon: 'radar', keys: ['enemies', 'elites'] },
  { id: 'nucleos', title: 'Núcleos', summary: 'Los jefes de cada capa, sus formas, fases y ataques', icon: 'comet', keys: ['bosses'] },
  { id: 'sectores', title: 'Sectores', summary: 'Los escenarios: su fauna, oleadas, dificultad, botín y su Núcleo', icon: 'compass', keys: ['sectors'] },
  { id: 'elementos', title: 'Elementos', summary: 'Los efectos elementales, sus marcas y las reacciones entre ellos', icon: 'fuse', keys: ['elements'] },
  { id: 'reliquias', title: 'Reliquias', summary: 'Los poderes de las galaxias equipadas: familias, fenómenos, conjuntos y fondos', icon: 'star', keys: ['relics'] },
  { id: 'eventos', title: 'Eventos de incursión', summary: 'Naves, cápsulas, cazarrecompensas, peligros, satélites y objetos rompibles', icon: 'bell', keys: ['events', 'satellites', 'props'] },
  {
    id: 'reglas',
    title: 'Reglas de la incursión',
    summary: 'Experiencia, topes de estadísticas, críticos, curación, la Estática, el dash y las anomalías',
    icon: 'sliders',
    keys: ['xp', 'caps', 'crit', 'hitCap', 'healing', 'stillness', 'dash', 'anomalies'],
  },
  { id: 'tecnico', title: 'Técnico', summary: 'Tamaños de la vista y límites del motor. Tócalos solo si sabes lo que haces', icon: 'gear', keys: ['arena', 'limits'] },
];

/** Where a top-level field lives (or «otros»). */
export function areaOf(key: string): string {
  return AREAS.find((a) => (a.keys as string[]).includes(key))?.id ?? 'otros';
}

export const PARTS: Record<string, DescriptorPart> = { arsenal, probes, fauna, cores, sectors, elements, relics, events, rules, technical };

/** Every field's description by pattern, from all the parts. */
export const DESCRIPTORS: Record<string, FieldDesc> = Object.assign({}, ...Object.values(PARTS).map((p) => p.fields));

/** Every vocabulary, from the part that owns it. */
export const VOCABS: Partial<Record<VocabName, Vocab>> = Object.assign({}, ...Object.values(PARTS).map((p) => p.vocabs ?? {}));

/** A field's description: its own, a variant's falling back to the plain field's, or none. */
export function describeField(pattern: string): FieldDesc | undefined {
  return DESCRIPTORS[pattern] ?? (pattern.includes('<') ? DESCRIPTORS[pattern.replace(/<[^>]*>/g, '')] : undefined);
}

/** The descriptors as the forms, «Qué cambia» and the problems read them: a vocabulary is a list of named choices. */
export function describeContent(pattern: string): FieldInfo | undefined {
  const d = describeField(pattern);
  if (!d) return undefined;
  return { ...d, options: d.vocab ? `vocab:${d.vocab}` : d.options };
}
