import type { StatKey } from '@galaxy/sim';
import type { DescriptorPart, FieldTable } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// The rules of a run: experience per level, the stats' caps, critical hits, the hit cap, healing, the Static
// (standing still), the player's dash, the loose items that expire on the ground and the season anomalies.

/** Each stat's cap: its name and what it limits (diminishing returns towards it, systems/stats.ts). */
const CAPS: Record<StatKey, [label: string, hint: string]> = {
  maxHp: ['Tope de vida máxima', 'Lo más que puede crecer la vida máxima sobre la de la sonda, en tanto por uno'],
  speed: ['Tope de velocidad', 'Lo más que puede crecer la velocidad de movimiento, en tanto por uno'],
  cooldown: ['Tope de recarga', 'Lo más que se pueden acortar las recargas de las armas y del dash, en tanto por uno de su tiempo'],
  damage: ['Tope de daño', 'Lo más que puede crecer el daño de todo lo que hace la sonda, en tanto por uno'],
  area: ['Tope de área', 'Lo más que pueden crecer las ondas, explosiones, charcos y demás zonas, en tanto por uno'],
  pickup: ['Tope de alcance de recogida', 'Lo más que puede crecer la distancia de recogida sobre la de la sonda, en tanto por uno'],
  projectiles: ['Tope de proyectiles', 'Cuántos proyectiles de más puede sumar una sonda como mucho, en unidades'],
  regen: ['Tope de regeneración', 'Lo más que puede regenerar una sonda, en vida por segundo'],
  armor: ['Tope de blindaje', 'La parte más grande del daño de cada golpe que se puede ignorar, contando el blindaje de la sonda'],
  crit: ['Tope de crítico', 'La probabilidad de crítico más alta posible, contando la de partida de toda sonda'],
  critDamage: ['Tope de daño crítico', 'Lo más que puede crecer el multiplicador de los críticos sobre el de partida'],
  xp: ['Tope de experiencia', 'Lo más que puede crecer la experiencia que da cada fragmento de datos, en tanto por uno'],
  luck: ['Tope de suerte', 'Lo más que puede crecer la suerte de botín, en tanto por uno'],
  lifesteal: ['Tope de robo de vida', 'La parte más grande del daño que se puede robar como vida'],
  velocity: ['Tope de velocidad de proyectil', 'Lo más que pueden crecer la velocidad y el alcance de los proyectiles, en tanto por uno'],
  duration: ['Tope de duración', 'Lo más que pueden durar de más los charcos, rayos, minas, torretas y demás, en tanto por uno'],
  pierce: ['Tope de perforación', 'A cuántos enemigos más puede atravesar como mucho un proyectil gracias a las mejoras'],
  elemental: ['Tope de potencia elemental', 'Lo más que puede crecer la potencia de los elementos y sus reacciones, en tanto por uno'],
  barrier: ['Tope de barrera', 'El escudo de barrera más grande posible, en tanto por uno de la vida máxima'],
  curse: ['Tope de maldición', 'Lo más que puede subir la maldición, que trae más enemigos y más botín, en tanto por uno'],
  evasion: ['Tope de esquiva', 'La probabilidad más alta de que un golpe atraviese la sonda sin hacerle daño'],
  bossDamage: ['Tope de daño a Núcleos y élites', 'Lo más que puede crecer el daño contra Núcleos y élites, en tanto por uno'],
  execute: ['Tope de remate', 'La parte de vida más alta por debajo de la cual un enemigo corriente cae al instante'],
  knockback: ['Tope de empuje', 'Lo más que puede crecer el empuje de los golpes, en tanto por uno'],
  movingDamage: ['Tope de daño en marcha', 'Lo más que puede crecer el daño mientras la sonda se mueve, en tanto por uno'],
};

const caps: FieldTable = Object.fromEntries(Object.entries(CAPS).map(([k, [label, hint]]) => [`caps.${k}`, { label, hint }]));

export const part: DescriptorPart = {
  fields: {
    // Experience per level.
    xp: {
      label: 'Experiencia por nivel',
      hint: 'Cuántos fragmentos de datos pide cada nivel de la incursión: una base, una parte por cada nivel alcanzado y otra que crece con su cuadrado',
    },
    'xp.base': { label: 'Base', hint: 'Fragmentos que pide cualquier nivel; con más, se sube despacio desde el principio' },
    'xp.linear': { label: 'Por nivel alcanzado', hint: 'Fragmentos de más que pide cada nivel por cada nivel que ya tiene la sonda' },
    'xp.quad': {
      label: 'Crecimiento acelerado',
      hint: 'Fragmentos de más por el cuadrado del nivel alcanzado: hace que los niveles altos cuesten mucho más que los primeros',
    },

    // The stats' caps.
    caps: {
      label: 'Topes de estadísticas',
      hint: 'Lo más que puede subir cada estadística de una sonda sumando pasivas, reliquias y bonos; cada bono rinde menos cuanto más cerca está del tope',
    },
    ...caps,

    // Critical hits.
    crit: { label: 'Golpes críticos', hint: 'La probabilidad y la fuerza de los críticos con las que empieza toda sonda' },
    'crit.chance': {
      label: 'Probabilidad de crítico de partida',
      hint: 'La probabilidad de crítico de toda sonda antes de pasivas y reliquias',
      unit: 'percent',
    },
    'crit.damage': {
      label: 'Daño crítico de partida',
      hint: 'Por cuánto se multiplica el daño de un golpe crítico antes de pasivas y reliquias',
      unit: 'factor',
    },

    hitCap: {
      label: 'Tope de daño por golpe',
      hint: 'Ningún golpe de un enemigo quita más de esta parte de la vida máxima de la sonda; al máximo no hay tope',
      unit: 'percent',
    },

    // Healing.
    healing: {
      label: 'Curación por robo de vida',
      hint: 'Cuánto puede curar cada segundo la vida robada a los enemigos con el Sifón, el robo de vida o el drenaje',
    },
    'healing.base': {
      label: 'Curación base por segundo',
      hint: 'Parte de la vida máxima que la vida robada puede curar cada segundo aunque la sonda no tenga robo de vida, en tanto por uno',
    },
    'healing.perLifesteal': {
      label: 'Extra por robo de vida',
      hint: 'Multiplica el robo de vida de la sonda y lo suma a la curación base por segundo',
      unit: 'factor',
    },
    'healing.burst': {
      label: 'Reserva de curación',
      hint: 'Cuántos segundos de curación puede acumular la sonda para gastarlos de golpe tras un rato sin necesitarla',
      unit: 'seconds',
    },

    // The Static: standing still.
    stillness: {
      label: 'La Estática',
      hint: 'Castiga quedarse quieto: avisa, después hace un daño cada vez mayor y bloquea toda curación hasta que la sonda se aleja',
    },
    'stillness.radius': {
      label: 'Radio de quietud',
      hint: 'Lo que se puede mover la sonda sin salir de la zona; salir de ella, también con un dash, pone la cuenta a cero',
    },
    'stillness.warn': {
      label: 'Aviso',
      hint: 'Tiempo quieta en la zona hasta que avisa de que la Estática se acerca',
      unit: 'seconds',
    },
    'stillness.hurt': {
      label: 'Empieza a dañar',
      hint: 'Tiempo quieta en la zona hasta que la Estática hace daño y bloquea la curación; a cero, la Estática está apagada',
      unit: 'seconds',
    },
    'stillness.damage': {
      label: 'Daño inicial',
      hint: 'Parte de la vida máxima que quita cada segundo cuando empieza a dañar, en tanto por uno',
    },
    'stillness.growth': {
      label: 'Aumento del daño',
      hint: 'Cuánto sube ese daño por cada segundo que la sonda sigue quieta, en tanto por uno de la vida máxima',
    },
    'stillness.max': {
      label: 'Daño máximo',
      hint: 'Lo más que llega a quitar cada segundo, en tanto por uno de la vida máxima',
    },

    // Loose items that expire on the ground (2026-11-22).
    pickups: {
      label: 'Objetos en el suelo',
      hint: 'Cuánto duran en el suelo los fragmentos de datos y los kits de reparación que nadie recoge; las monedas, el polvo, los componentes, las señales y los imanes nunca desaparecen, ni lo que ya vuela hacia una sonda',
    },
    'pickups.lifeSeconds': {
      label: 'Vida de la experiencia y los kits',
      hint: 'Tiempo que un fragmento de datos o un kit de reparación sigue en el suelo antes de desaparecer; 0 hace que no desaparezcan',
      unit: 'seconds',
    },
    'pickups.fadeSeconds': {
      label: 'Aviso antes de desaparecer',
      hint: 'Los últimos segundos de su vida, en los que parpadean cada vez más deprisa y se apagan; no puede durar más que la vida',
      unit: 'seconds',
    },

    // The player's dash.
    dash: {
      label: 'Dash',
      hint: 'El impulso que lanza el jugador con Mayús, Espacio o el botón A del mando: sus cargas, su recarga, su distancia y su invulnerabilidad',
    },
    'dash.charges': { label: 'Cargas', hint: 'Cuántos dashes seguidos puede hacer cualquier sonda antes de esperar a que vuelvan' },
    'dash.recharge': {
      label: 'Recarga de cada carga',
      hint: 'Lo que tarda en volver cada carga; la estadística de recarga la acorta',
      unit: 'seconds',
    },
    'dash.pause': { label: 'Pausa entre dashes', hint: 'Lo mínimo que hay que esperar entre dos dashes seguidos', unit: 'seconds' },
    'dash.distance': {
      label: 'Distancia',
      hint: 'Cuánto avanza cada dash, en unidades del mundo; si es demasiado para lo que dura, el contenido no se acepta',
    },
    'dash.seconds': {
      label: 'Duración',
      hint: 'Lo que tarda en recorrer su distancia; la sonda es invulnerable mientras dura',
      unit: 'seconds',
    },
    'dash.invuln': {
      label: 'Invulnerabilidad extra',
      hint: 'Tiempo que la sonda sigue invulnerable al acabar el dash',
      unit: 'seconds',
    },
    'dash.cometCharges': {
      label: 'Cargas por reliquia cometa',
      hint: 'Cargas de dash que suma cada reliquia equipada con el fenómeno cometa, que además hace que el dash dañe',
    },
    'dash.cometMax': {
      label: 'Tope de cargas por cometas',
      hint: 'Lo más que suman en total las reliquias cometa, lleve las que lleve la sonda',
    },

    // The season anomalies.
    anomalies: {
      label: 'Anomalías de temporada',
      hint: 'Reglas que cambian todas las incursiones mientras su temporada está abierta; cada temporada elige una o ninguna',
      noun: 'anomalía',
    },
    'anomalies[]': { label: 'Anomalía', hint: 'Una regla de temporada con sus multiplicadores y, si lo tiene, el contagio de corrosión' },
    'anomalies[].id': {
      label: 'Identificador',
      hint: 'Nombre interno único en minúsculas, números y guiones; la configuración de la temporada lo usa para elegirla',
      section: 'Identidad',
    },
    'anomalies[].name': { label: 'Nombre', hint: 'Cómo se llama la anomalía en Condiciones de hoy y en la temporada', section: 'Identidad' },
    'anomalies[].description': { label: 'Descripción', hint: 'La frase que cuenta al jugador qué cambia en sus incursiones', section: 'Identidad' },
    'anomalies[].enemyHp': {
      label: 'Vida de los enemigos',
      hint: 'Multiplica la vida de los enemigos en todas las incursiones',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].enemyDamage': {
      label: 'Daño de los enemigos',
      hint: 'Multiplica el daño que hacen los enemigos',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].enemySpeed': {
      label: 'Velocidad de los enemigos',
      hint: 'Multiplica lo rápido que se mueven los enemigos',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].spawn': {
      label: 'Enemigos que llegan',
      hint: 'Multiplica el ritmo al que aparecen enemigos',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].elite': {
      label: 'Probabilidad de élite',
      hint: 'Multiplica la probabilidad de que un enemigo salga élite',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].xp': {
      label: 'Fragmentos de datos',
      hint: 'Multiplica la experiencia que sueltan los enemigos al caer',
      unit: 'factor',
      section: 'Multiplicadores',
    },
    'anomalies[].contagion': {
      label: 'Contagio de corrosión',
      hint: 'Si lo rellenas, un enemigo que cae corroído corroe a los que tiene cerca; vacío, no hay contagio',
      section: 'Contagio',
    },
    'anomalies[].contagion.radius': {
      label: 'Radio del contagio',
      hint: 'Hasta qué distancia contagia la corrosión el enemigo que cae, en unidades del mundo',
      section: 'Contagio',
    },
    'anomalies[].contagion.seconds': {
      label: 'Duración de la corrosión',
      hint: 'Tiempo que quedan corroídos los enemigos contagiados',
      unit: 'seconds',
      section: 'Contagio',
    },
  },
};
