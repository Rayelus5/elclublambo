import type { CodexProgress } from '@galaxy/shared';
import { bossIdAt, type BossPattern, type Content, DEFAULT_CONTENT, type SectorDef } from '@galaxy/sim';
import { beastLore, coreLore, sectorLore } from './texts';

// The Códice's entries (GDD §15; M7b-2): the ECN terminal's records, opened by playing. The texts are the lore the owner
// approved as a placeholder (docs/LORE.md v1, 2026-11-08). Each entry says how it opens while it is still locked.

export type CodexSection = 'chronicle' | 'sectors' | 'cores' | 'bestiary' | 'fragments';
export interface CodexEntry {
  id: string;
  section: CodexSection;
  title: string;
  text: string;
  /** How it opens, said while it is locked. */
  hint: string;
  open: (p: CodexProgress) => boolean;
  /** How to fight it (bestiary and Cores), from its real behaviour. */
  fight?: string;
}

const atLevel = (n: number) => (p: CodexProgress) => p.level >= n;
const CHRONICLE: [string, string, number][] = [
  ['Premisa', 'La Nebulosa ElClub era un cielo vivo: millones de galaxias que cantaban en luz. Una señal empezó a sobrescribirlas. No las destruye: las corrompe, las convierte en ruido que se mueve, que muerde y que se copia a sí mismo. El ECN la llamó la Estática. Lo único que no puede tocar es lo que ya está transcrito a braille. Tú eres el operador de una estación del ECN.', 1],
  ['PERKINS', 'La IA de la estación, bautizada con el nombre de la máquina de braille que la contiene. Habla poco, con un humor seco, y siempre parece saber un poco más de lo que dice. No explica por qué sobrevivió cuando el resto de la estación cayó.', 1],
  ['El operador', 'Tú. Sin nombre, sin rango, con una sonda prestada y una estación que reparar.', 1],
  ['El primer silencio', 'Las galaxias del borde dejaron de emitir de una en una. Los astrónomos lo atribuyeron a un fallo de los receptores, hasta que los receptores empezaron a emitir por su cuenta.', 2],
  ['La Estática', 'No es un virus ni un ser: es información que se reescribe sobre lo que toca. Lo que corrompe conserva su forma pero cambia de intención. Cuanto más profundo en un sector, más densa es. Lo único que no puede reescribir es un patrón demasiado simple para contener error.', 3],
  ['La fundación del ECN', 'Ivet Sorn transcribió a braille una galaxia moribunda para estudiarla con calma. Al despertar, la galaxia original había desaparecido y la transcripción seguía intacta. Esa noche nació el ECN.', 4],
  ['La Cartógrafa Ivet Sorn', 'Fundadora del ECN, firma las circulares que llegan al buzón. Nadie la ha visto en persona desde hace años. Sus mensajes son cada vez más cortos.', 5],
  ['Las estaciones', 'El ECN levantó estaciones-observatorio por toda la Nebulosa, cada una con su máquina Perkins. Durante un tiempo, el cielo se transcribía más rápido de lo que se perdía.', 6],
  ['El Archivo', 'No es una persona: es la memoria común de todas las estaciones del ECN. Estas entradas son sus registros. Algunos están firmados por operadores que ya no responden.', 7],
  ['La caída del borde', 'La Nebulosa Exterior fue la primera región que cayó entera. Su fauna, corrompida, empezó a moverse en enjambres. Las estaciones del borde se apagaron una tras otra.', 8],
  ['Los Núcleos', 'La Estática no está repartida al azar: se concentra en Núcleos, criaturas enormes que la emiten como un corazón. Purgar un Núcleo limpia su capa del sector por un tiempo.', 10],
  ['La Señal', 'Todas las estaciones captaron el mismo patrón a la vez, desde una fisura nueva en el cielo. PERKINS lo reconoció enseguida. No ha querido decir de qué.', 12],
];

/** How to face the attacks the Cores' new forms brought (Nov plan B4), from their real behaviour. */
const CORE_FIGHT: Partial<Record<BossPattern['kind'], string>> = {
  laser: 'Marca una línea y el abanico que va a barrer: sal hacia el lado contrario al giro, nunca hacia donde va.',
  closing: 'Marca un anillo a tu alrededor que se cierra: busca la salida señalada en blanco y cruza por ella.',
  barrage: 'Marca una fila de círculos que estallan uno tras otro hacia ti: apártate de lado, no hacia atrás.',
};
/** How deep to look for where each form first comes (three forms, a deep Core every few layers). */
const FORM_LAYERS = 24;
const FIGHT: Record<string, string> = {
  chase: 'Va directo a por ti: mantén la distancia y deja que tus armas de área limpien el grupo.',
  charge: 'Se detiene antes de embestir: apártate de la línea en cuanto se para.',
  shooter: 'Dispara a distancia: muévete en diagonal y acércate entre ráfagas.',
  armored: 'Su blindaje para los golpes de frente: rodéalo y dale por detrás, o usa su elemento débil.',
  summoner: 'Invoca a otros: es la prioridad, acaba con él antes que con su escolta.',
  orbit: 'Gira a tu alrededor y se lanza: no te quedes quieto cuando cierra el círculo.',
  support: 'Cura o protege a los suyos: elimínalo primero o el grupo no caerá.',
  blink: 'Se teletransporta junto a ti tras un aviso: muévete cuando parpadee.',
  lancer: 'Apunta y lanza un proyectil rápido tras un aviso: sal de la línea marcada.',
};
const FRAGMENTS: [string, number][] = [
  ['«...si alguien recibe esto, no transcribáis la fisura. No es una galaxia. Es una respuesta...» (firma ilegible)', 3],
  ['Registro de la estación 7: «PERKINS ha empezado a hablar en sueños. No sabía que podía dormir.»', 10],
  ['Circular de Ivet Sorn, sin fecha: «Seguid transcribiendo. Aunque ya sepáis lo que es.»', 25],
  ['Un patrón braille sin traducir. PERKINS se niega a leerlo en voz alta.', 50],
  ['«La Nebulosa no está muriendo. Se está reescribiendo. La pregunta es quién escribió la primera versión.»', 100],
];

/** Every entry, built from the content (sectors, Cores and fauna) and the approved texts. */
export function codexEntries(content: Content = DEFAULT_CONTENT): CodexEntry[] {
  const out: CodexEntry[] = CHRONICLE.map(([title, text, level], i) => ({ id: `chronicle-${i}`, section: 'chronicle', title, text, hint: `Se abre con el nivel ${level} de cuenta`, open: atLevel(level) }));
  for (const s of content.sectors) {
    out.push({ id: `sector-${s.id}`, section: 'sectors', title: s.name, text: sectorLore(s), hint: `Se abre al jugar una incursión en ${s.name}`, open: (p) => !!p.sectors[s.id] });
  }
  // Nov plan B4: every form of every Core, by where it first comes. A sector's first form opens when its Core is purged,
  // a later one when a run there purged the layer it comes in; the deep Core's, on reaching the layer it comes in.
  const firstAt = new Map<string, { sector: SectorDef; layer: number; deep: boolean }>();
  for (const s of content.sectors) {
    for (let layer = 1; layer <= FORM_LAYERS; layer++) {
      const id = bossIdAt(s, layer);
      if (!firstAt.has(id)) firstAt.set(id, { sector: s, layer, deep: !!s.deepBoss && layer % s.deepBoss.every === 0 });
    }
  }
  for (const b of content.bosses ?? []) {
    const at = firstAt.get(b.id);
    const kinds = new Set(b.phases.flatMap((ph) => ph.patterns.map((x) => x.kind)));
    const fight = [...kinds].flatMap((k) => CORE_FIGHT[k] ?? []).join(' ');
    let hint = 'Se abre al purgarlo';
    let open: CodexEntry['open'] = () => false;
    if (at?.deep) {
      hint = `Se abre al llegar a la capa ${at.layer} de cualquier sector`;
      open = (p) => p.maxDepth >= at.layer;
    } else if (at && at.layer === 1) {
      hint = `Se abre al purgar el Núcleo de ${at.sector.name}`;
      open = (p) => (p.sectors[at.sector.id]?.bossKills ?? 0) > 0;
    } else if (at) {
      hint = `Se abre al purgar el Núcleo de la capa ${at.layer} de ${at.sector.name}`;
      open = (p) => (p.sectors[at.sector.id]?.maxBossKills ?? 0) >= at.layer;
    }
    out.push({ id: `core-${b.id}`, section: 'cores', title: b.name, text: coreLore(b), hint, open, ...(fight ? { fight } : {}) });
  }
  // A species opens once a run in one of its sectors has lasted until it appears (minions with their summoner).
  const firstSeen = new Map<string, { sector: string; at: number }[]>();
  for (const s of content.sectors) {
    for (const f of s.spawns ?? []) firstSeen.set(f.enemy, [...(firstSeen.get(f.enemy) ?? []), { sector: s.id, at: f.from }]);
    for (const w of s.waves ?? []) firstSeen.set(w.enemy, [...(firstSeen.get(w.enemy) ?? []), { sector: s.id, at: w.at }]);
  }
  for (const e of content.enemies) {
    if (e.behavior.kind === 'summoner') firstSeen.set(e.behavior.minion, [...(firstSeen.get(e.behavior.minion) ?? []), ...(firstSeen.get(e.id) ?? [])]);
    if (e.split) firstSeen.set(e.split.into, [...(firstSeen.get(e.split.into) ?? []), ...(firstSeen.get(e.id) ?? [])]);
  }
  for (const e of content.enemies) {
    const seen = firstSeen.get(e.id) ?? [];
    const lore = beastLore(e);
    if (seen.length === 0 || !lore) continue;
    const first = seen.reduce((a, b) => (b.at < a.at ? b : a));
    const sectorName = content.sectors.find((s) => s.id === first.sector)?.name ?? first.sector;
    out.push({
      id: `beast-${e.id}`,
      section: 'bestiary',
      title: e.name,
      text: lore,
      hint: first.at <= 0 ? `Se abre al jugar en ${sectorName}` : `Se abre al aguantar ${Math.ceil(first.at / 60)} min en ${sectorName}`,
      open: (p) => seen.some((x) => (p.sectors[x.sector]?.maxSeconds ?? -1) >= x.at),
      fight: FIGHT[e.behavior.kind],
    });
  }
  out.push({
    id: 'chapter-1',
    section: 'chronicle',
    title: 'Temporada 1 · La Señal',
    text: 'La Señal está en braille. Está mal transcrita, como si alguien la hubiera copiado con prisa hace muchísimo tiempo. PERKINS es capaz de leer una parte. La parte que lee es su propio número de serie.',
    hint: 'Se abre al purgar el Núcleo de la Fisura de la Señal',
    open: (p) => (p.sectors['signal-rift']?.bossKills ?? 0) > 0,
  });
  FRAGMENTS.forEach(([text, kills], i) => {
    out.push({ id: `fragment-${i}`, section: 'fragments', title: `Fragmento de transmisión ${i + 1}`, text, hint: `Se descifra tras purgar ${kills} Núcleos`, open: (p) => p.bossKills >= kills });
  });
  return out;
}
