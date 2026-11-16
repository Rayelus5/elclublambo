import type { DescriptorPart } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// Elements (GDD §5.4, §8.3; systems/elements.ts and reactions.ts): the element each palette gives, how each one acts on a
// hit, the marks a hit leaves and the reaction a second element sets off on them. The names are the Hangar's.

const EFFECTS = 'Efectos';

export const part: DescriptorPart = {
  fields: {
    elements: {
      label: 'Elementos',
      hint: 'Qué elemento da cada paleta de galaxia, qué hace cada uno al golpear y qué reacciones salen al juntar dos en un enemigo',
    },
    'elements.palettes': {
      label: 'Elemento de cada paleta',
      hint: 'La paleta de una galaxia equipada decide el elemento de sus golpes, y a veces el de los golpes de las armas',
      vocab: 'element',
      section: 'Paletas',
    },
    'elements.palettes.*': { label: 'Elemento', hint: 'El elemento que da una galaxia con esta paleta', vocab: 'element' },

    'elements.burn': { label: 'Quemadura', hint: 'El enemigo quemado sigue perdiendo vida unos segundos, y varias quemaduras se acumulan', section: EFFECTS },
    'elements.burn.share': {
      label: 'Daño por segundo',
      hint: 'Lo que quita cada segundo cada capa de quemadura, en proporción al golpe que la prendió',
      unit: 'factor',
    },
    'elements.burn.seconds': {
      label: 'Duración',
      hint: 'Cuánto sigue ardiendo el enemigo tras el último golpe de fuego; la potencia elemental de la sonda lo alarga',
      unit: 'seconds',
    },
    'elements.burn.stacks': { label: 'Capas como máximo', hint: 'Cuántas quemaduras se acumulan como mucho en un mismo enemigo' },

    'elements.slow': { label: 'Ralentización', hint: 'Los golpes frenan al enemigo un rato', section: EFFECTS },
    'elements.slow.factor': { label: 'Cuánto frena', hint: 'La parte de su velocidad que pierde el enemigo ralentizado', unit: 'percent' },
    'elements.slow.seconds': { label: 'Duración', hint: 'Cuánto dura la ralentización tras el golpe; la potencia elemental de la sonda la alarga', unit: 'seconds' },

    'elements.corrosion': {
      label: 'Corrosión',
      hint: 'El enemigo corroído recibe más daño de todo y, si es blindado, pierde la protección de su frente',
      section: EFFECTS,
    },
    'elements.corrosion.bonus': { label: 'Daño extra que recibe', hint: 'Cuánto más daño recibe de todo un enemigo corroído, donde 1 es un 100 % más' },
    'elements.corrosion.seconds': { label: 'Duración', hint: 'Cuánto dura la corrosión tras el golpe; la potencia elemental de la sonda la alarga', unit: 'seconds' },

    'elements.shock': { label: 'Descarga', hint: 'A veces el golpe salta en descarga a los enemigos cercanos', section: EFFECTS },
    'elements.shock.chance': { label: 'Probabilidad de descarga', hint: 'Probabilidad de que un golpe eléctrico salte a otros enemigos', unit: 'percent' },
    'elements.shock.targets': { label: 'Enemigos que alcanza', hint: 'A cuántos enemigos cercanos salta cada descarga como mucho' },
    'elements.shock.share': { label: 'Daño de la descarga', hint: 'Lo que recibe cada enemigo alcanzado, en proporción al golpe original', unit: 'factor' },
    'elements.shock.range': { label: 'Alcance', hint: 'Lo lejos del enemigo golpeado que pueden estar los que reciben la descarga' },

    'elements.hack': { label: 'Hackeo', hint: 'A veces el enemigo golpeado lucha un rato a tu favor, nunca un Núcleo ni una élite', section: EFFECTS },
    'elements.hack.chance': { label: 'Probabilidad de hackear', hint: 'Probabilidad de que un golpe de hackeo ponga al enemigo de tu lado', unit: 'percent' },
    'elements.hack.seconds': { label: 'Duración', hint: 'Cuánto lucha a tu favor el enemigo hackeado; la potencia elemental de la sonda lo alarga', unit: 'seconds' },

    'elements.leech': { label: 'Robo de vida', hint: 'Una parte del daño que hacen estos golpes cura a la sonda', section: EFFECTS },
    'elements.leech.share': { label: 'Parte que cura', hint: 'Qué parte del daño que de verdad quita el golpe recupera la sonda como vida', unit: 'percent' },

    'elements.breach': {
      label: 'Daño a escudos',
      hint: 'Golpes que rompen los escudos enemigos mucho más rápido y hacen más daño a Núcleos y blindados',
      section: EFFECTS,
    },
    'elements.breach.shield': { label: 'Multiplicador contra escudos', hint: 'Por cuánto se multiplica el golpe mientras el enemigo conserva su escudo', unit: 'factor' },
    'elements.breach.armor': {
      label: 'Daño extra a Núcleos y blindados',
      hint: 'Cuánto más daño hace el golpe a un Núcleo o a un blindado sin escudo, donde 1 es un 100 % más',
    },

    'elements.chain': { label: 'Rebotes', hint: 'Cada golpe rebota a enemigos cercanos', section: EFFECTS },
    'elements.chain.bounces': { label: 'Rebotes por golpe', hint: 'A cuántos enemigos cercanos rebota cada golpe' },
    'elements.chain.share': { label: 'Daño de cada rebote', hint: 'Lo que recibe cada enemigo del rebote, en proporción al golpe original', unit: 'factor' },
    'elements.chain.range': { label: 'Alcance del rebote', hint: 'Lo lejos del enemigo golpeado que pueden estar los que reciben el rebote' },

    'elements.pure': { label: 'Daño puro', hint: 'Golpes con más probabilidad de crítico y críticos más fuertes', section: EFFECTS },
    'elements.pure.crit': { label: 'Probabilidad de crítico extra', hint: 'Lo que se suma a la probabilidad de crítico de cada golpe puro', unit: 'percent' },
    'elements.pure.critDamage': { label: 'Daño crítico extra', hint: 'Lo que se suma al daño de los críticos de los golpes puros, donde 1 es un 100 % más' },

    'elements.prism': { label: 'Prisma', hint: 'Golpes que cambian de elemento cada vez, siguiendo un ciclo', section: EFFECTS },
    'elements.prism.cycle': {
      label: 'Ciclo de elementos',
      hint: 'Los elementos por los que pasa el prisma, en este orden, uno por golpe',
      vocab: 'element',
      noun: 'elemento',
    },

    'elements.invert': {
      label: 'Inversión',
      hint: 'A veces devuelve contra los enemigos los disparos suyos que pasan cerca de la sonda',
      section: EFFECTS,
    },
    'elements.invert.radius': { label: 'Radio de alcance', hint: 'Lo cerca de la sonda que tiene que pasar un disparo enemigo para poder devolverlo' },
    'elements.invert.chance': {
      label: 'Probabilidad de devolverlo',
      hint: 'Probabilidad de que cada disparo enemigo que entra en ese radio salga devuelto',
      unit: 'percent',
    },
    'elements.invert.power': { label: 'Fuerza del disparo devuelto', hint: 'Por cuánto se multiplica el daño del disparo enemigo al devolverlo', unit: 'factor' },

    'elements.marks': {
      label: 'Marcas',
      hint: 'Un golpe elemental deja su marca en el enemigo, y un golpe de otro elemento sobre ella provoca la reacción de esa pareja',
      section: 'Reacciones',
    },
    'elements.marks.seconds': { label: 'Duración de la marca', hint: 'Cuánto tiempo queda marcado un enemigo esperando un golpe de otro elemento', unit: 'seconds' },
    'elements.marks.cooldown': { label: 'Espera entre reacciones', hint: 'Tiempo mínimo entre dos reacciones en un mismo enemigo', unit: 'seconds' },
    'elements.marks.bossStun': {
      label: 'Aturdimiento en Núcleos',
      hint: 'Qué parte del aturdimiento de una reacción sufre un Núcleo, para que nunca quede bloqueado',
      unit: 'percent',
    },
    'elements.marks.bossStunEvery': {
      label: 'Espera entre aturdimientos a Núcleos',
      hint: 'Tiempo mínimo entre dos aturdimientos por reacción a un Núcleo',
      unit: 'seconds',
    },

    'elements.reactions': {
      label: 'Reacciones',
      hint: 'Lo que pasa cuando un enemigo marcado con un elemento recibe un golpe de otro; cada pareja tiene como mucho una',
      noun: 'reacción',
      section: 'Reacciones',
    },
    'elements.reactions[]': { label: 'Reacción', hint: 'Una pareja de elementos y el efecto que desatan juntos' },
    'elements.reactions[].id': { label: 'Identificador', hint: 'Nombre interno y permanente de la reacción; no lo cambies una vez publicada' },
    'elements.reactions[].name': { label: 'Nombre', hint: 'Cómo la ven los jugadores cuando salta' },
    'elements.reactions[].pair': {
      label: 'Pareja de elementos',
      hint: 'Los dos elementos que la provocan, en cualquier orden; tienen que ser distintos',
      vocab: 'element',
      items: ['Primer elemento', 'Segundo elemento'],
    },
    'elements.reactions[].effect': {
      label: 'Efecto',
      hint: 'Lo que hace la reacción; su daño sale del golpe que la provocó y crece con la potencia elemental de la sonda',
    },
    'elements.reactions[].effect.kind': {
      label: 'Tipo de efecto',
      hint: 'Cómo actúa la reacción, y con ello qué ajustes tiene',
      vocab: 'reactionEffect',
    },
    'elements.reactions[].effect.targets': { label: 'Enemigos que alcanza', hint: 'A cuántos enemigos cercanos llega como mucho' },
    'elements.reactions[].effect.range': { label: 'Alcance', hint: 'Lo lejos del enemigo que reacciona que pueden estar los alcanzados' },
    'elements.reactions[].effect.share': { label: 'Daño', hint: 'El daño de la reacción, en proporción al golpe que la provocó', unit: 'factor' },
    'elements.reactions[].effect.radius': { label: 'Radio de la explosión', hint: 'El tamaño de la explosión alrededor del enemigo que reacciona' },
    'elements.reactions[].effect.bonus': {
      label: 'Daño extra que recibe',
      hint: 'Cuánto más daño recibe de todo el enemigo roto mientras dura, donde 1 es un 100 % más',
    },
    'elements.reactions[].effect.seconds': { label: 'Duración', hint: 'Cuánto dura el efecto sobre el enemigo', unit: 'seconds' },
    'elements.reactions[].effect.statuses': {
      label: 'Estados que contagia',
      hint: 'Qué efectos pasa a los enemigos cercanos; solo valen quemadura, corrosión y hackeo',
      vocab: 'element',
      noun: 'estado',
    },
    'elements.reactions[].effect.heal': { label: 'Parte que cura', hint: 'Qué parte del daño drenado recupera la sonda como vida', unit: 'percent' },

    // What the same knob means in each kind of reaction.
    'elements.reactions[].effect<chain>.targets': { label: 'Enemigos a los que salta', hint: 'A cuántos enemigos cercanos salta el daño como mucho' },
    'elements.reactions[].effect<chain>.share': {
      label: 'Daño de cada salto',
      hint: 'Lo que recibe cada enemigo alcanzado, en proporción al golpe que provocó la reacción',
      unit: 'factor',
    },
    'elements.reactions[].effect<explode>.share': {
      label: 'Daño de la explosión',
      hint: 'Lo que recibe cada enemigo dentro de la explosión, en proporción al golpe que la provocó',
      unit: 'factor',
    },
    'elements.reactions[].effect<shatter>.share': {
      label: 'Golpe al romperse',
      hint: 'El daño inmediato que recibe el enemigo roto, en proporción al golpe que provocó la reacción',
      unit: 'factor',
    },
    'elements.reactions[].effect<shatter>.seconds': { label: 'Duración de la rotura', hint: 'Cuánto tiempo recibe más daño el enemigo roto', unit: 'seconds' },
    'elements.reactions[].effect<stun>.seconds': {
      label: 'Duración del aturdimiento',
      hint: 'Cuánto queda paralizado el enemigo; un Núcleo, solo una parte y no siempre',
      unit: 'seconds',
    },
    'elements.reactions[].effect<spread>.targets': { label: 'Enemigos contagiados', hint: 'A cuántos enemigos cercanos pasa sus estados como mucho' },
    'elements.reactions[].effect<spread>.range': { label: 'Alcance del contagio', hint: 'Lo lejos del enemigo que reacciona que pueden estar los contagiados' },
    'elements.reactions[].effect<drain>.share': {
      label: 'Daño del drenaje',
      hint: 'Lo que el drenaje quita al enemigo, en proporción al golpe que provocó la reacción',
      unit: 'factor',
    },
  },
  vocabs: {
    element: {
      burn: { label: 'Quemadura', explain: 'El enemigo sigue perdiendo vida unos segundos, y las quemaduras se acumulan' },
      slow: { label: 'Ralentización', explain: 'El enemigo se mueve más despacio un rato' },
      corrosion: { label: 'Corrosión', explain: 'El enemigo recibe más daño un rato y, si es blindado, pierde la protección de su frente' },
      shock: { label: 'Descarga', explain: 'A veces el golpe salta a los enemigos cercanos' },
      hack: { label: 'Hackeo', explain: 'A veces el enemigo golpeado lucha un rato a tu favor. Nunca funciona con Núcleos ni élites' },
      leech: { label: 'Robo de vida', explain: 'Una parte del daño del golpe cura a la sonda' },
      breach: { label: 'Daño a escudos', explain: 'Mucho más daño a los escudos enemigos, y algo más a Núcleos y blindados' },
      chain: { label: 'Rebotes', explain: 'Cada golpe rebota a enemigos cercanos' },
      pure: { label: 'Daño puro', explain: 'Más probabilidad de crítico y críticos más fuertes. No deja marca, así que no provoca reacciones' },
      prism: { label: 'Prisma', explain: 'Cambia de elemento a cada golpe, siguiendo su ciclo' },
      invert: {
        label: 'Inversión',
        explain: 'A veces devuelve a los enemigos los disparos que pasan cerca de la sonda. No deja marca, así que no provoca reacciones',
      },
    },
    reactionEffect: {
      chain: { label: 'Salto en cadena', explain: 'El daño salta del enemigo que reacciona a varios enemigos cercanos' },
      explode: { label: 'Explosión', explain: 'Estalla alrededor del enemigo y daña a todos los que pilla' },
      shatter: { label: 'Rotura', explain: 'Un golpe al enemigo, que además recibe más daño de todo durante un rato' },
      stun: { label: 'Aturdimiento', explain: 'El enemigo queda paralizado un rato. Un Núcleo, menos tiempo y no siempre' },
      spread: { label: 'Contagio', explain: 'Pasa quemadura, corrosión o hackeo a los enemigos cercanos' },
      drain: { label: 'Drenaje', explain: 'Un golpe al enemigo que además cura a la sonda con parte de lo que le quita' },
    },
  },
};
