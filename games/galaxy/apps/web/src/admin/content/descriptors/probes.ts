import type { Quirk } from '@galaxy/sim';
import type { DescriptorPart, Term } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// The probes: the ships the players fly, their base numbers, starting weapon, own bonuses and quirk. It owns the
// vocabulary of the quirks (what each one does is code, systems/quirks.ts and systems/dash.ts; the numbers are data).

const quirk: Record<Quirk['kind'], Term> = {
  magnet: { label: 'Imán', explain: 'Cada cierto tiempo atrae hacia la sonda todos los fragmentos de datos que tiene cerca' },
  thorns: { label: 'Espinas', explain: 'Devuelve una parte del daño a cada enemigo que la toca' },
  dash: {
    label: 'Dash ágil',
    explain: 'Su dash tiene cargas de más, que vuelven antes, y la deja invulnerable su propio tiempo al acabar. Es el rasgo de Chispa',
  },
  overwatch: { label: 'Escolta de drones', explain: 'Sus armas de drones llevan siempre drones de más' },
  'second-wind': { label: 'Segundo aliento', explain: 'La primera vez que cae en una incursión se levanta con parte de su vida y un momento de invulnerabilidad' },
  'prism-touch': { label: 'Toque prismático', explain: 'Sus golpes sin elemento pueden prender uno, rotando por turno entre los de su lista' },
  afterburner: { label: 'Posquemador', explain: 'Cada baja la acelera durante unos segundos, y otra baja renueva el impulso' },
  salvage: { label: 'Chatarrero', explain: 'Cada cierto número de bajas suelta un kit de reparación donde cae el enemigo' },
};

const unused = 'Ya no se usa: era el salto automático de Chispa antes de que todas las sondas tuvieran dash';

export const part: DescriptorPart = {
  fields: {
    probes: {
      label: 'Sondas',
      hint: 'Las naves que eligen los jugadores en el hangar, con su vida, su arma inicial, sus bonos y su peculiaridad',
      noun: 'sonda',
    },
    'probes[]': { label: 'Sonda', hint: 'Una nave jugable con sus números de partida, su arma inicial, sus bonos propios y su peculiaridad' },
    'probes[].id': {
      label: 'Identificador',
      hint: 'Nombre interno único en minúsculas, números y guiones; los desbloqueos y niveles de sonda lo usan para referirse a ella',
      section: 'Identidad',
    },
    'probes[].name': { label: 'Nombre', hint: 'Cómo se llama la sonda en el hangar, el test de bienvenida y las incursiones', section: 'Identidad' },
    'probes[].sprite': {
      label: 'Dibujo',
      hint: 'El dibujo de la nave en la arena y en el hangar; tiene que ser uno de los que ya existen en el juego',
      section: 'Identidad',
      advanced: true,
    },
    'probes[].description': { label: 'Descripción', hint: 'La frase que presenta la sonda en el hangar', section: 'Identidad' },
    'probes[].hp': {
      label: 'Vida',
      hint: 'La vida máxima con la que empieza cada incursión, antes de pasivas, reliquias y bonos',
      section: 'Números de partida',
    },
    'probes[].speed': {
      label: 'Velocidad',
      hint: 'Lo rápido que se mueve, en unidades del mundo por segundo, antes de pasivas, reliquias y bonos',
      section: 'Números de partida',
    },
    'probes[].pickup': {
      label: 'Alcance de recogida',
      hint: 'Desde qué distancia recoge fragmentos de datos y botín, antes de pasivas, reliquias y bonos',
      section: 'Números de partida',
    },
    'probes[].armor': {
      label: 'Blindaje',
      hint: 'La parte del daño de cada golpe que ignora desde el principio; las pasivas y reliquias de blindaje se suman',
      unit: 'percent',
      section: 'Números de partida',
    },
    'probes[].regen': {
      label: 'Regeneración',
      hint: 'La vida que recupera cada segundo desde el principio, sin hacer nada',
      section: 'Números de partida',
    },
    'probes[].weapon': {
      label: 'Arma inicial',
      hint: 'El arma con la que empieza cada incursión; sus variantes se abren al subir la sonda de nivel',
      options: 'weapons',
      section: 'Arma y bonos',
    },
    'probes[].bonus': {
      label: 'Bonos propios',
      hint: 'Estadísticas que la sonda ya tiene subidas desde el principio, contadas como una pasiva más',
      vocab: 'stat',
      section: 'Arma y bonos',
    },
    'probes[].bonus.*': {
      label: 'Bono',
      hint: 'Lo que suma a esa estadística, en tanto por uno salvo proyectiles y perforación, que van en unidades, y regeneración, en vida por segundo',
      section: 'Arma y bonos',
    },
    'probes[].quirk': {
      label: 'Peculiaridad',
      hint: 'Lo que hace única a la sonda en la incursión, con sus números; vacío, ninguna',
      section: 'Peculiaridad',
    },
    'probes[].quirk.kind': {
      label: 'Tipo de peculiaridad',
      hint: 'Qué hace la peculiaridad; cada tipo usa solo sus propios números',
      vocab: 'quirk',
      section: 'Peculiaridad',
    },
    'probes[].quirk.every': {
      label: 'Cada cuánto atrae',
      hint: 'Tiempo entre dos atracciones de los fragmentos de datos cercanos',
      unit: 'seconds',
      section: 'Peculiaridad',
    },
    'probes[].quirk<dash>.every': { label: 'Salto automático antiguo', hint: unused, unit: 'seconds', section: 'Peculiaridad', advanced: true },
    'probes[].quirk.radius': {
      label: 'Radio de atracción',
      hint: 'Desde qué distancia atrae los fragmentos de datos cada vez, en unidades del mundo',
      section: 'Peculiaridad',
    },
    'probes[].quirk.share': {
      label: 'Daño devuelto',
      hint: 'La parte del daño de cada contacto que recibe el enemigo que la toca, en tanto por uno',
      section: 'Peculiaridad',
    },
    'probes[].quirk.invuln': {
      label: 'Invulnerabilidad tras el dash',
      hint: 'Tiempo que sigue invulnerable al acabar cada dash; sustituye al que tienen todas las sondas',
      unit: 'seconds',
      section: 'Peculiaridad',
    },
    'probes[].quirk.charges': {
      label: 'Cargas de dash de más',
      hint: 'Cargas que suma al dash que tienen todas las sondas',
      section: 'Peculiaridad',
    },
    'probes[].quirk.recharge': {
      label: 'Recarga de cada carga',
      hint: 'Lo que tarda en volver cada carga de su dash; nunca es más lenta que la de todas las sondas',
      unit: 'seconds',
      section: 'Peculiaridad',
    },
    'probes[].quirk.pause': {
      label: 'Pausa entre dashes',
      hint: 'Lo mínimo que espera entre dos dashes seguidos; nunca es más larga que la de todas las sondas',
      unit: 'seconds',
      section: 'Peculiaridad',
    },
    'probes[].quirk.distance': { label: 'Distancia del salto antiguo', hint: unused, section: 'Peculiaridad', advanced: true },
    'probes[].quirk.drones': {
      label: 'Drones de más',
      hint: 'Cuántos drones extra llevan siempre sus armas de drones',
      section: 'Peculiaridad',
    },
    'probes[].quirk.hp': {
      label: 'Vida al levantarse',
      hint: 'La parte de la vida máxima con la que vuelve la primera vez que cae',
      unit: 'percent',
      section: 'Peculiaridad',
    },
    'probes[].quirk.chance': {
      label: 'Probabilidad de prender',
      hint: 'Probabilidad de que un golpe sin elemento prenda el siguiente elemento de su lista',
      unit: 'percent',
      section: 'Peculiaridad',
    },
    'probes[].quirk.cycle': {
      label: 'Elementos que rota',
      hint: 'Los elementos que prenden sus golpes, por turno y en este orden',
      vocab: 'element',
      noun: 'elemento',
      section: 'Peculiaridad',
    },
    'probes[].quirk.bonus': {
      label: 'Velocidad extra',
      hint: 'Cuánto más rápido va tras cada baja mientras dura el impulso, en tanto por uno',
      section: 'Peculiaridad',
    },
    'probes[].quirk.seconds': {
      label: 'Duración del impulso',
      hint: 'Lo que dura la velocidad extra tras cada baja; otra baja lo renueva',
      unit: 'seconds',
      section: 'Peculiaridad',
    },
    'probes[].quirk.kills': {
      label: 'Bajas por kit',
      hint: 'Cuántas bajas necesita la sonda para que salga un kit de reparación',
      section: 'Peculiaridad',
    },
  },
  vocabs: { quirk },
};
