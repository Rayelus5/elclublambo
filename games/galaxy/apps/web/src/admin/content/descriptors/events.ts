import type { DescriptorPart, FieldTable, Vocab } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// This part: the in-run events (an abandoned ship, a supply capsule, a bounty hunter and the hazards), the abandoned
// satellites and the breakable props of the ground (sim content/types.ts, systems/run-events.ts, world-events.ts, props.ts).

const SCHEDULE = 'Calendario';
const WEIGHTS = 'Pesos';

/** The event kinds, named as the arena names them (copy.arena.events). */
const EVENT_KINDS: Vocab = {
  wreck: { label: 'Nave abandonada', explain: 'Aparece cerca y hay que quedarse unos segundos dentro de su zona para saquearla antes de que se pierda' },
  capsule: { label: 'Cápsula de suministros', explain: 'Cae cerca tras un aviso y se abre al tocarla; si nadie llega a tiempo, se pierde' },
  bounty: { label: 'Cazarrecompensas', explain: 'Un enemigo marcado y más duro que huye de las sondas; si cae antes de escapar, suelta su botín' },
  meteors: { label: 'Lluvia de meteoritos', explain: 'Peligro sin botín; caen meteoritos alrededor de las sondas, cada uno avisado con un círculo en el suelo' },
  storm: { label: 'Tormenta de la Estática', explain: 'Peligro sin botín; una nube que sigue despacio a la sonda más cercana y daña a quien esté dentro' },
  ambush: { label: 'Emboscada', explain: 'Peligro sin botín; tras un aviso, un anillo de la fauna del sector se cierra alrededor de una sonda' },
  well: { label: 'Pozo de gravedad', explain: 'Peligro sin botín; atrae sondas y botín hacia su centro, que hace daño, aunque siempre se puede salir' },
};

type Kind = 'wreck' | 'capsule' | 'bounty' | 'meteors' | 'storm' | 'ambush' | 'well';
const KINDS = Object.keys(EVENT_KINDS) as Kind[];
/** «la nave abandonada», «el cazarrecompensas»… for the hints. */
const THE: Record<Kind, string> = {
  wreck: 'la nave abandonada',
  capsule: 'la cápsula de suministros',
  bounty: 'el cazarrecompensas',
  meteors: 'la lluvia de meteoritos',
  storm: 'la tormenta de la Estática',
  ambush: 'la emboscada',
  well: 'el pozo de gravedad',
};

/** Each kind's weight, in general and in one sector. */
function weights(): FieldTable {
  const out: FieldTable = {};
  for (const k of KINDS) {
    out[`events.weights.${k}`] = {
      label: EVENT_KINDS[k]!.label,
      hint: `Cuánto sale ${THE[k]} frente a los demás eventos; a más peso, más a menudo, y con 0 no sale nunca`,
      section: WEIGHTS,
    };
    out[`events.sectors.*.${k}`] = {
      label: EVENT_KINDS[k]!.label,
      hint: `El peso de ${THE[k]} en este sector, en lugar del general`,
      section: WEIGHTS,
    };
  }
  return out;
}

/** What a loot event drops: coins, dust and components in the first layer, growing with each layer. */
function loot(kind: 'wreck' | 'capsule' | 'bounty', section: string): FieldTable {
  const p = `events.${kind}`;
  return {
    [`${p}.coins`]: { label: 'Monedas', hint: 'Monedas que suelta en la primera capa; en las siguientes crecen con el aumento por capa', section },
    [`${p}.dust`]: { label: 'Polvo estelar', hint: 'Polvo estelar que suelta en la primera capa; en las siguientes crece con el aumento por capa', section },
    [`${p}.components`]: { label: 'Componentes', hint: 'Componentes que suelta en la primera capa; en las siguientes crecen con el aumento por capa', section },
    [`${p}.perLayer`]: {
      label: 'Aumento del botín por capa',
      unit: 'factor',
      hint: 'Lo que suma a su botín cada capa pasada la primera; con ×1 suelta el doble en la segunda capa y el triple en la tercera',
      section,
    },
  };
}

/** Where an event appears, from the probe it comes to. */
const appears = (section: string, what: string) => ({
  label: 'Distancia a la que aparece',
  hint: `A cuántas unidades de la sonda aparece ${what}; más lejos obliga a desviarse más para llegar o deja más margen para apartarse`,
  section,
  advanced: true,
});

const WRECK = EVENT_KINDS.wreck!.label;
const CAPSULE = EVENT_KINDS.capsule!.label;
const BOUNTY = EVENT_KINDS.bounty!.label;
const METEORS = EVENT_KINDS.meteors!.label;
const STORM = EVENT_KINDS.storm!.label;
const AMBUSH = EVENT_KINDS.ambush!.label;
const WELL = EVENT_KINDS.well!.label;
const SAT_WHEN = 'Cuándo llegan';
const SAT_FLIGHT = 'Vuelo';
const SAT_BODY = 'Resistencia';
const PROP_COUNT = 'Cuántos hay';
const PROP_BODY = 'Resistencia';
const PROP_LOOT = 'Botín';

export const part: DescriptorPart = {
  fields: {
    // —— The in-run events ——
    events: {
      label: 'Eventos de la incursión',
      hint: 'Lo que pasa en cada capa además de las oleadas, con botín que ir a buscar o peligros que esquivar, fijado por la semilla de la partida',
    },
    'events.slots': {
      label: 'Franjas de cada capa',
      hint: 'Cada capa tira cada franja una vez para ver si trae un evento y cuándo; sin franjas no hay eventos',
      section: SCHEDULE,
      noun: 'franja',
      items: (i) => `Franja ${i + 1}`,
    },
    'events.slots[]': { label: 'Franja', hint: 'Un tramo de las oleadas de cada capa en el que puede salir un evento', section: SCHEDULE },
    'events.slots[].from': {
      label: 'Puede salir desde',
      unit: 'seconds',
      hint: 'Lo antes que puede empezar el evento, contando desde el inicio de las oleadas de la capa',
      section: SCHEDULE,
    },
    'events.slots[].to': {
      label: 'Puede salir hasta',
      unit: 'seconds',
      hint: 'Lo más tarde que puede empezar; si el evento anterior lo retrasa más allá, esa capa se queda sin él',
      section: SCHEDULE,
    },
    'events.slots[].chance': { label: 'Probabilidad', unit: 'percent', hint: 'Probabilidad de que esta franja traiga un evento en cada capa', section: SCHEDULE },
    'events.gap': {
      label: 'Pausa entre eventos',
      unit: 'seconds',
      hint: 'Tiempo mínimo entre el final de un evento, o del paso de un satélite, y el siguiente, para que haya una sola cosa a la vez',
      section: SCHEDULE,
    },
    'events.endBy': {
      label: 'Margen antes del Núcleo',
      unit: 'seconds',
      hint: 'Un evento que no acabaría con este margen antes de que llegue el Núcleo no sale; al llegar el Núcleo, los que siguen en marcha terminan',
      section: SCHEDULE,
      advanced: true,
    },
    'events.weights': {
      label: 'Peso de cada evento',
      hint: 'Cuánto sale cada tipo frente a los demás cuando una franja trae un evento; solo cuenta la proporción entre ellos',
      section: WEIGHTS,
    },
    'events.sectors': {
      label: 'Pesos por sector',
      hint: 'Cambia el peso de algunos eventos solo en un sector, para que cada escenario tenga sus preferidos',
      section: WEIGHTS,
      options: 'sectors',
    },
    'events.sectors.*': {
      label: 'Pesos en este sector',
      hint: 'Los eventos que pongas aquí usan este peso en el sector en lugar del general, y los demás siguen igual',
      section: WEIGHTS,
    },
    ...weights(),

    // An abandoned ship.
    'events.wreck': { label: WRECK, hint: 'Una nave que aparece cerca; quedarse unos segundos dentro de su zona la saquea y suelta su botín', section: WRECK },
    'events.wreck.distance': appears(WRECK, 'la nave'),
    'events.wreck.radius': { label: 'Tamaño de la zona de saqueo', hint: 'Radio de la zona en la que hay que estar para saquearla; más grande es más fácil', section: WRECK },
    'events.wreck.hold': {
      label: 'Tiempo para saquearla',
      unit: 'seconds',
      hint: 'Lo que hay que pasar dentro de su zona; salir pausa el saqueo, pero no lo pierde',
      section: WRECK,
    },
    'events.wreck.life': {
      label: 'Tiempo antes de perderse',
      unit: 'seconds',
      hint: 'Lo que dura en el mapa; si no se termina de saquear antes, se pierde sin soltar nada',
      section: WRECK,
    },
    ...loot('wreck', WRECK),

    // A supply capsule.
    'events.capsule': { label: CAPSULE, hint: 'Una cápsula que cae cerca tras un aviso y se abre al tocarla', section: CAPSULE },
    'events.capsule.distance': appears(CAPSULE, 'la cápsula'),
    'events.capsule.radius': { label: 'Tamaño para recogerla', hint: 'Radio de la cápsula; más grande es más fácil abrirla al pasar', section: CAPSULE },
    'events.capsule.warn': {
      label: 'Aviso antes de aterrizar',
      unit: 'seconds',
      hint: 'Tiempo desde que se anuncia hasta que aterriza y se puede abrir',
      section: CAPSULE,
    },
    'events.capsule.life': {
      label: 'Tiempo antes de perderse',
      unit: 'seconds',
      hint: 'Lo que espera en el suelo después de aterrizar; si nadie la toca, se pierde sin soltar nada',
      section: CAPSULE,
    },
    ...loot('capsule', CAPSULE),

    // A bounty hunter.
    'events.bounty': { label: BOUNTY, hint: 'Un enemigo marcado del sector que huye de las sondas; si cae antes de escapar, suelta su botín', section: BOUNTY },
    'events.bounty.distance': appears(BOUNTY, 'el cazarrecompensas'),
    'events.bounty.seconds': {
      label: 'Tiempo antes de escapar',
      unit: 'seconds',
      hint: 'Lo que hay para derribarlo; pasado ese tiempo se va sin soltar nada',
      section: BOUNTY,
    },
    'events.bounty.hp': {
      label: 'Vida frente a un enemigo normal',
      unit: 'factor',
      hint: 'Cuántas veces la vida del enemigo principal del sector tiene; más vida pide más daño para derribarlo a tiempo',
      section: BOUNTY,
    },
    'events.bounty.speed': {
      label: 'Velocidad de huida',
      hint: 'Unidades por segundo a las que se aleja de la sonda más cercana; congelarlo o ralentizarlo ayuda a alcanzarlo',
      section: BOUNTY,
    },
    ...loot('bounty', BOUNTY),

    // A meteor shower.
    'events.meteors': {
      label: METEORS,
      hint: 'Peligro sin botín; durante un rato caen meteoritos alrededor de las sondas, cada uno avisado con un círculo en el suelo',
      section: METEORS,
    },
    'events.meteors.seconds': { label: 'Duración', unit: 'seconds', hint: 'Cuánto dura la lluvia', section: METEORS },
    'events.meteors.every': {
      label: 'Tiempo entre meteoritos',
      unit: 'seconds',
      hint: 'Cada cuánto cae uno; menos tiempo hace la lluvia más densa',
      section: METEORS,
    },
    'events.meteors.warn': {
      label: 'Aviso antes del impacto',
      unit: 'seconds',
      hint: 'Lo que tarda en caer desde que se marca su círculo; menos aviso deja menos tiempo para apartarse',
      section: METEORS,
    },
    'events.meteors.radius': { label: 'Tamaño del impacto', hint: 'Radio del círculo que daña cada meteorito', section: METEORS },
    'events.meteors.damage': {
      label: 'Daño de cada meteorito',
      unit: 'percent',
      hint: 'Parte de la vida máxima que quita a cada sonda dentro del círculo; la armadura y el tope por golpe la reducen',
      section: METEORS,
    },
    'events.meteors.spread': {
      label: 'Dispersión',
      hint: 'Lo lejos de la sonda que puede caer cada meteorito; más dispersión los reparte por una zona mayor y acierta menos',
      section: METEORS,
    },

    // A Static storm.
    'events.storm': { label: STORM, hint: 'Peligro sin botín; una nube que sigue despacio a la sonda más cercana y daña a quien esté dentro', section: STORM },
    'events.storm.distance': appears(STORM, 'la tormenta'),
    'events.storm.seconds': { label: 'Duración', unit: 'seconds', hint: 'Cuánto dura la tormenta antes de deshacerse', section: STORM },
    'events.storm.radius': { label: 'Tamaño de la tormenta', hint: 'Radio de la nube; dentro de ella las sondas reciben daño', section: STORM },
    'events.storm.speed': {
      label: 'Velocidad',
      hint: 'Lo rápido que persigue a la sonda más cercana; tiene que ser más lenta que cualquier sonda para que se pueda escapar',
      section: STORM,
    },
    'events.storm.damage': {
      label: 'Daño por segundo',
      unit: 'percent',
      hint: 'Parte de la vida máxima que quita cada segundo a quien esté dentro; la armadura y el tope por golpe cuentan',
      section: STORM,
    },

    // An ambush.
    'events.ambush': {
      label: AMBUSH,
      hint: 'Peligro sin botín; tras un aviso, un anillo de la fauna del sector aparece alrededor de una sonda',
      section: AMBUSH,
    },
    'events.ambush.distance': {
      label: 'Radio del anillo',
      hint: 'Lo lejos de la sonda que aparecen los enemigos del anillo; más cerca deja menos tiempo para abrir hueco',
      section: AMBUSH,
    },
    'events.ambush.warn': {
      label: 'Aviso antes de cerrarse',
      unit: 'seconds',
      hint: 'Tiempo desde el aviso hasta que aparece el anillo, para que la sonda se prepare',
      section: AMBUSH,
    },
    'events.ambush.count': { label: 'Enemigos del anillo', hint: 'Cuántos enemigos forman el anillo en la primera capa', section: AMBUSH },
    'events.ambush.perLayer': {
      label: 'Enemigos de más por capa',
      hint: 'Enemigos que se suman al anillo por cada capa pasada la primera',
      section: AMBUSH,
    },

    // A gravity well.
    'events.well': {
      label: WELL,
      hint: 'Peligro sin botín; atrae sondas y botín hacia su centro, que hace daño, aunque siempre se puede salir',
      section: WELL,
    },
    'events.well.distance': appears(WELL, 'el pozo'),
    'events.well.seconds': { label: 'Duración', unit: 'seconds', hint: 'Cuánto dura el pozo antes de cerrarse', section: WELL },
    'events.well.radius': {
      label: 'Alcance de la atracción',
      hint: 'Radio dentro del cual atrae sondas y botín; fuera de él no hace nada',
      section: WELL,
    },
    'events.well.pull': {
      label: 'Fuerza de atracción',
      hint: 'Unidades por segundo que arrastra en el centro, menos cuanto más lejos; tiene que quedar por debajo de la velocidad de las sondas para poder salir',
      section: WELL,
    },
    'events.well.core': { label: 'Tamaño del centro que daña', hint: 'Radio del corazón del pozo, la parte que hace daño', section: WELL },
    'events.well.damage': {
      label: 'Daño por segundo en el centro',
      unit: 'percent',
      hint: 'Parte de la vida máxima que quita cada segundo a quien esté en el centro; la armadura y el tope por golpe cuentan',
      section: WELL,
    },

    // —— Abandoned satellites ——
    satellites: {
      label: 'Satélites abandonados',
      hint: 'Satélites que pasan a la deriva durante las oleadas; romper uno da una señal del escáner profundo',
    },
    'satellites.chances': {
      label: 'Probabilidad de satélites',
      unit: 'percent',
      items: ['Uno o más', 'Dos o más', 'Tres'],
      hint: 'Probabilidad de que una partida tenga al menos uno, dos o tres, uno por capa desde la primera; cada valor no puede pasar del anterior',
      section: SAT_WHEN,
    },
    'satellites.earliest': {
      label: 'Llega desde',
      unit: 'seconds',
      hint: 'Lo antes que llega, contando desde el inicio de las oleadas de su capa',
      section: SAT_WHEN,
    },
    'satellites.latest': {
      label: 'Llega hasta',
      unit: 'seconds',
      hint: 'Lo más tarde que llega dentro de las oleadas de su capa; no puede ser antes que el inicio de esa ventana',
      section: SAT_WHEN,
    },
    'satellites.drift': {
      label: 'Tiempo a la deriva',
      unit: 'seconds',
      hint: 'Lo que tarda en irse; si nadie lo rompe antes, su señal se pierde',
      section: SAT_FLIGHT,
    },
    'satellites.distance': {
      label: 'Distancia a la que aparece',
      hint: 'A cuántas unidades de la sonda aparece antes de cruzar cerca de ella',
      section: SAT_FLIGHT,
      advanced: true,
    },
    'satellites.speed': {
      label: 'Velocidad de la deriva',
      hint: 'Lo rápido que cruza cerca de la sonda; más rápido deja menos tiempo para romperlo',
      section: SAT_FLIGHT,
    },
    'satellites.hp': { label: 'Vida', hint: 'El daño que aguanta antes de romperse en la primera capa', section: SAT_BODY },
    'satellites.hpPerLayer': {
      label: 'Aumento de vida por capa',
      unit: 'factor',
      hint: 'Lo que suma a su vida cada capa pasada la primera; con ×1 aguanta el doble en la segunda capa',
      section: SAT_BODY,
    },
    'satellites.radius': { label: 'Tamaño', hint: 'Radio en el que las armas lo alcanzan; más grande es más fácil de acertar', section: SAT_BODY, advanced: true },

    // —— Breakable props ——
    props: {
      label: 'Objetos rompibles',
      hint: 'Las rocas, el hielo, el coral, la escoria y los cristales del suelo, que las armas rompen y sueltan componentes y polvo',
    },
    'props.perChunk': {
      label: 'Objetos por cuadro del suelo',
      hint: 'Hasta cuántos aparecen en cada cuadro de 256 unidades del suelo; con 0 no hay ninguno',
      section: PROP_COUNT,
    },
    'props.hp': { label: 'Vida', hint: 'El daño que aguanta cada uno antes de romperse en la primera capa', section: PROP_BODY },
    'props.hpPerLayer': {
      label: 'Aumento de vida por capa',
      unit: 'factor',
      hint: 'Lo que suma a su vida cada capa pasada la primera; con ×1 aguantan el doble en la segunda capa',
      section: PROP_BODY,
    },
    'props.radius': { label: 'Tamaño', hint: 'Radio en el que las armas los alcanzan; más grande es más fácil de acertar', section: PROP_BODY, advanced: true },
    'props.componentChance': {
      label: 'Probabilidad de componentes',
      unit: 'percent',
      hint: 'Probabilidad de que suelte componentes al romperse; la suerte de la sonda la aumenta',
      section: PROP_LOOT,
    },
    'props.components': { label: 'Componentes', hint: 'Cuántos componentes suelta cuando le tocan', section: PROP_LOOT },
    'props.dustMin': { label: 'Polvo mínimo', hint: 'Lo menos que suelta de polvo estelar al romperse', section: PROP_LOOT },
    'props.dustMax': { label: 'Polvo máximo', hint: 'Lo más que suelta de polvo estelar al romperse; no puede ser menos que el mínimo', section: PROP_LOOT },
  },
  vocabs: { eventKind: EVENT_KINDS },
};
