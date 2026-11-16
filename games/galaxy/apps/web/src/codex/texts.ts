import type { BossDef, Content, EnemyDef, SectorDef } from '@galaxy/sim';
import { copy } from '../copy/es';

// The texts tied to a sector, a Núcleo or an enemy (the content editor, 2026-11-16, P8): the content's own when it has
// them (an admin writes them in the panel, so a new entry is never mute), else the game's, as they always were (the
// Códice's approved lore, docs/LORE.md v1, and PERKINS's lines in copy/es.ts).

export const SECTOR_TEXT: Record<string, string> = {
  'outer-nebula': 'El borde, el primero que devoró la Estática. Gas rosado lleno de ácaros y células que se parten. Aquí empiezan todas las sondas.',
  'frost-rings': 'Un sistema de anillos helados donde la Estática ralentiza todo, hasta la luz. Los témpanos flotan con algo dentro.',
  'hollow-reef': 'Un arrecife de coral espacial vaciado por dentro. Lo que antes filtraba polvo estelar ahora dispara.',
  'broken-forge': 'Una vieja fundición de estrellas. Sus máquinas siguen trabajando sin nadie que las mande, y lo que forjan ya no es metal.',
  'signal-rift': 'Una grieta abierta en el cielo esta temporada. De ella sale la Señal. Todo lo que vive aquí parece repetir algo.',
};
export const CORE_TEXT: Record<string, string> = {
  hive: 'Una colmena de ácaros que dejó de tener reina y empezó a tener hambre.',
  glacier: 'Congela el tiempo a su alrededor para proteger lo que incuba.',
  anemone: 'Antes filtraba la luz del arrecife; ahora la bebe.',
  anvil: 'La máquina que daba forma a las estrellas. Sigue golpeando, aunque ya no haya nada que forjar.',
  'echo-core': 'Aparece en las capas más hondas de cualquier sector. Repite los movimientos de las sondas que perdió.',
  signal: 'No ataca como una criatura: emite. Quien la escucha demasiado tiempo empieza a entenderla.',
  // Nov plan B4: the second and third forms.
  'hive-swarm': 'Cuando la Colmena se queda sin ácaros, fabrica más. El nido entero se mueve contigo, y se cierra a tu alrededor.',
  'hive-queen': 'La Colmena por fin tiene reina. No es de los suyos: es lo que la Estática imaginó que debía ser una reina.',
  'glacier-egg': 'Lo que la Madre Glaciar protegía. Algo se mueve dentro y ya sabe apuntar.',
  'glacier-daughter': 'Rompió el huevo y heredó el frío de su madre. Vuela en círculos, como si buscara algo que no recuerda.',
  'anemone-spore': 'La Anémona Rey abrió sus brazos y floreció. Cada espora que suelta quiere ser otro arrecife.',
  'anemone-maw': 'Lo que queda cuando el arrecife se ha bebido toda su luz: una boca. Y escupe lo que bebió.',
  'anvil-hammer': 'El martillo que el Yunque esperaba. Golpea el suelo a compás, cada vez más cerca.',
  'anvil-furnace': 'El horno que encendía estrellas. No tiene ojos, y no le hacen falta para cortar.',
  'echo-choir': 'Ya no repite a una sonda perdida: repite a tres a la vez. Cantan desafinadas.',
  'echo-mirror': 'Si lo miras, te ves a ti. Si te miras demasiado tiempo, empiezas a moverte como él.',
  'signal-carrier': 'La Señal deja de esconderse y emite en una sola dirección. PERKINS dice que es una frecuencia de prueba.',
  'signal-answer': 'Una sola letra en braille, grabada en algo que no es piedra. PERKINS sabe leerla. No quiere.',
};
export const BEAST_TEXT: Record<string, string> = {
  mite: 'La primera forma de la Estática: pequeña, rápida y nunca sola.',
  cell: 'Al romperla se convierte en dos. El Archivo recomienda no romperla cerca de casa.',
  cellet: 'Lo que queda de una célula partida, y no es poco.',
  ray: 'Planea en silencio y embiste cuando la miras.',
  spitter: 'Un coral que aprendió a escupir.',
  shell: 'Lo que queda de algo que se escondió demasiado tiempo.',
  splinter: 'Fragmentos de algo más grande que aún no ha llegado.',
  narwhal: 'Carga en línea recta con un cuerno de hielo que no se derrite.',
  beacon: 'Antes guiaba a las naves por los anillos; ahora las atrae.',
  geode: 'Hermosa por dentro. No la abras.',
  floe: 'Hielo a la deriva con algo que late dentro.',
  polyp: 'Crece donde nadie mira.',
  jelly: 'Deja un rastro que confunde a los sensores.',
  urchin: 'Se protege como siempre, pero ahora sus púas vuelan.',
  eel: 'Recorre el arrecife como una chispa con hambre.',
  colony: 'Muchos que actúan como uno.',
  ember: 'Chispas de la forja que se niegan a apagarse.',
  ram: 'Una máquina de derribo que ya no distingue paredes de sondas.',
  sentry: 'Defendía la forja. Sigue defendiéndola, de ti.',
  golem: 'Lo que la forja tira, la Estática lo recoge y lo pone a andar.',
  welder: 'Repara a los suyos con una paciencia inquietante.',
  crucible: 'Funde lo que toca y lo devuelve hostil.',
  glitch: 'Un error que aprendió a moverse.',
  wraith: 'Una sonda perdida que aún cree que está en misión.',
  cantor: 'Su canto refuerza a los que lo rodean.',
};

/** A sector's Códice text. */
export function sectorLore(s: SectorDef): string {
  return s.lore ?? SECTOR_TEXT[s.id] ?? s.description ?? '';
}

/** A Núcleo's Códice text. */
export function coreLore(b: BossDef): string {
  return b.lore ?? CORE_TEXT[b.id] ?? '';
}

/** An enemy's bestiary text, or none (no entry). */
export function beastLore(e: EnemyDef): string | undefined {
  return e.lore ?? BEAST_TEXT[e.id];
}

/** PERKINS's line on the first run in a sector, or none. */
export function sectorRadio(content: Content, id: string): string | undefined {
  return content.sectors.find((s) => s.id === id)?.radio ?? copy.arena.radio.sectors[id];
}

/** PERKINS's line the first time a Núcleo (or one of its forms) shows up, or none. */
export function coreRadio(content: Content, id: string): string | undefined {
  return content.bosses.find((b) => b.id === id)?.radio ?? copy.arena.radio.bosses[id];
}
