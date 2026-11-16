import type { DescriptorPart, FieldTable } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// Relics (GDD §8.2–8.6; systems/relics.ts and sets.ts): what an equipped galaxy does in a run. Its type gives the passive
// (the family), its phenomenon a unique power, its core the quasar or the double, a mythic the singularity; rarity,
// size, core and level give the power, star density the frequency, the background a bonus. The names are the Hangar's.

const POWER = 'Potencia';
const PASSIVES = 'Pasivas';
const POWERS = 'Poderes';
const BONUSES = 'Bonos';

/** Damage of a relic power: it grows with the relic's power and the probe's damage. */
const grows = 'crece con la potencia de la reliquia y el daño de la sonda';
/** A relic power's clock: the galaxy's star density and the probe's cooldown shorten it. */
const sooner = 'la densidad de estrellas y la recarga de la sonda lo acortan';
/** A relic radius: it grows a little with the power and with the probe's area. */
const wider = 'crece algo con la potencia y con el área de la sonda';

/** A set's bonus, the same in a tier of a «same» set and in a combination. */
function bonus(at: string): FieldTable {
  return {
    [at]: { label: 'Bono', hint: 'Lo que ganan la sonda o las galaxias del conjunto mientras está activo' },
    [`${at}.stats`]: { label: 'Estadísticas', hint: 'Mejoras a las estadísticas de la sonda mientras el conjunto esté activo', noun: 'estadística' },
    [`${at}.stats[]`]: { label: 'Mejora de una estadística', hint: 'Una estadística de la sonda y cuánto le suma el conjunto' },
    [`${at}.stats[].stat`]: { label: 'Estadística', hint: 'Qué estadística de la sonda mejora', vocab: 'stat' },
    [`${at}.stats[].value`]: {
      label: 'Cuánto suma',
      hint: 'Lo que suma a esa estadística, como una mejora pasiva; en las que van en porcentaje, 1 es un 100 %',
    },
    [`${at}.magnitude`]: {
      label: 'Potencia de sus galaxias',
      hint: 'Por cuánto se multiplica la potencia de todas las habilidades de las galaxias que forman el conjunto',
      unit: 'factor',
    },
    [`${at}.background`]: {
      label: 'Bono de fondo de sus galaxias',
      hint: 'Por cuánto se multiplica el bono de fondo de las galaxias que forman el conjunto',
      unit: 'factor',
    },
  };
}

export const part: DescriptorPart = {
  fields: {
    relics: {
      label: 'Reliquias',
      hint: 'Lo que hacen en la incursión las galaxias equipadas, con su potencia, sus pasivas, sus fenómenos, sus fondos y sus conjuntos',
    },

    // The power: rarity, level, stacking, size, core; and the frequency: star density.
    'relics.tier': {
      label: 'Potencia por rareza',
      hint: 'Multiplica la fuerza de todas las habilidades de una reliquia según su rareza; sin valor de mítica, cuenta como legendaria',
      unit: 'factor',
      items: ['Común', 'Poco común', 'Rara', 'Épica', 'Legendaria', 'Mítica'],
      section: POWER,
    },
    'relics.level': { label: 'Mejora por nivel', hint: 'Cuánto más fuerte es una reliquia al subirla de nivel', section: POWER },
    'relics.level.step': {
      label: 'Potencia que suma cada nivel',
      hint: 'Lo que suma cada nivel a la potencia de la reliquia, donde 1 es un 100 %; cuanto más cerca del tope, menos suma',
    },
    'relics.level.cap': {
      label: 'Tope de la mejora por niveles',
      hint: 'Lo máximo que pueden sumar todos los niveles juntos a la potencia, donde 1 es un 100 %',
    },
    'relics.stacking': {
      label: 'Apilado de la misma familia',
      hint: 'Varias reliquias con la misma pasiva rinden menos cuantas más llevas, contando en el orden de las ranuras',
      section: POWER,
    },
    'relics.stacking.from': { label: 'Rinde menos desde la reliquia', hint: 'A partir de qué reliquia de la misma familia empieza a rendir menos; las anteriores rinden enteras' },
    'relics.stacking.decay': {
      label: 'Lo que rinde cada una',
      hint: 'Qué parte de la potencia de la anterior conserva cada reliquia de la misma familia a partir de ahí',
      unit: 'percent',
    },
    'relics.size': { label: 'Potencia por tamaño', hint: 'Multiplica la potencia de una reliquia según el tamaño de su galaxia', section: POWER },
    'relics.size.*': { label: 'Multiplicador', hint: 'Por cuánto se multiplica la potencia de una galaxia de este tamaño', unit: 'factor' },
    'relics.core': { label: 'Potencia por núcleo', hint: 'Multiplica la potencia de una reliquia según el núcleo de su galaxia', section: POWER },
    'relics.core.*': { label: 'Multiplicador', hint: 'Por cuánto se multiplica la potencia de una galaxia con este núcleo', unit: 'factor' },
    'relics.density': {
      label: 'Frecuencia por densidad',
      hint: 'Según la densidad de estrellas de su galaxia, las habilidades de una reliquia llegan más o menos a menudo',
      section: POWER,
    },
    'relics.density.*': {
      label: 'Multiplicador de frecuencia',
      hint: 'Por cuánto se multiplica la frecuencia de una galaxia con esta densidad; por encima de uno, más a menudo',
      unit: 'factor',
    },
    'relics.weaponProc': {
      label: 'Elemento en golpes de armas',
      hint: 'Probabilidad de que un golpe de arma sin elemento lleve el de una reliquia equipada, por turnos; la potencia elemental la sube',
      unit: 'percent',
      section: POWER,
    },

    // The passives, by galaxy type.
    'relics.families': {
      label: 'Pasivas por tipo de galaxia',
      hint: 'Cada tipo de galaxia da una pasiva; estos son sus valores con la potencia normal, y crecen con ella',
      section: PASSIVES,
    },
    'relics.families.blades': {
      label: 'Cuchillas orbitales',
      hint: 'Pasiva de las espirales, cuchillas que giran alrededor de la sonda y cortan lo que tocan; los brazos dan más cuchillas',
    },
    'relics.families.blades.damage': { label: 'Daño por corte', hint: `Lo que quita una cuchilla a cada enemigo que toca; ${grows}` },
    'relics.families.blades.radius': { label: 'Distancia a la sonda', hint: `A qué distancia de la sonda giran las cuchillas; ${wider}` },
    'relics.families.blades.interval': {
      label: 'Espera entre cortes',
      hint: 'Cuánto tarda una misma cuchilla en volver a dañar al mismo enemigo',
      unit: 'seconds',
    },
    'relics.families.blades.speed': { label: 'Velocidad de giro', hint: 'Lo rápido que giran las cuchillas alrededor de la sonda, en grados por segundo' },

    'relics.families.ray': {
      label: 'Rayo perforante',
      hint: 'Pasiva de las espirales barradas, un rayo cada poco que atraviesa enemigos; los brazos dan más rayos y la inclinación su forma',
    },
    'relics.families.ray.damage': { label: 'Daño del rayo', hint: `Lo que quita cada rayo a cada enemigo que atraviesa; ${grows}` },
    'relics.families.ray.cooldown': { label: 'Tiempo entre rayos', hint: `Cada cuánto dispara; ${sooner}`, unit: 'seconds' },
    'relics.families.ray.pierce': {
      label: 'Enemigos que atraviesa',
      hint: 'Cuántos enemigos atraviesa cada rayo antes de apagarse; en una galaxia de canto los atraviesa todos',
    },
    'relics.families.ray.speed': { label: 'Velocidad del rayo', hint: 'Lo rápido que avanza cada rayo' },
    'relics.families.ray.cone': {
      label: 'Apertura del abanico',
      hint: 'En una galaxia inclinada los rayos salen en abanico hacia donde apunta la sonda, y este es su ángulo en grados',
    },
    'relics.families.ray.range': { label: 'Alcance', hint: 'Lo lejos que llega cada rayo antes de desaparecer' },

    'relics.families.shield': {
      label: 'Escudo',
      hint: 'Pasiva de las elípticas, un escudo que recibe el daño antes que la vida y se recarga solo',
    },
    'relics.families.shield.shield': { label: 'Tamaño del escudo', hint: 'Cuánto daño aguanta el escudo lleno; crece con la potencia de la reliquia' },
    'relics.families.shield.recharge': {
      label: 'Espera para recargar',
      hint: 'Cuánto tiempo sin recibir daño necesita la sonda para que el escudo empiece a recargarse',
      unit: 'seconds',
    },

    'relics.families.lens': { label: 'Lente crítica', hint: 'Pasiva de las lenticulares, más probabilidad de crítico y críticos más fuertes' },
    'relics.families.lens.crit': {
      label: 'Probabilidad de crítico',
      hint: 'Lo que suma a la probabilidad de crítico de la sonda; crece con la potencia de la reliquia',
      unit: 'percent',
    },
    'relics.families.lens.critDamage': {
      label: 'Daño crítico',
      hint: 'Lo que suma al daño de los críticos, donde 1 es un 100 %; crece con la potencia de la reliquia',
    },

    'relics.families.chaos': {
      label: 'Caos',
      hint: 'Pasiva de las irregulares, cada poco desata al azar una nova, una ráfaga, un campo lento o un acelerón',
    },
    'relics.families.chaos.cooldown': { label: 'Tiempo entre efectos', hint: `Cada cuánto desata un efecto; ${sooner}`, unit: 'seconds' },
    'relics.families.chaos.nova': { label: 'Nova', hint: 'Una onda alrededor de la sonda que daña a todos los enemigos cercanos' },
    'relics.families.chaos.nova.damage': { label: 'Daño de la nova', hint: `Lo que quita a cada enemigo que alcanza; ${grows}` },
    'relics.families.chaos.nova.radius': { label: 'Radio de la nova', hint: `Hasta dónde llega la onda; ${wider}` },
    'relics.families.chaos.bolts': { label: 'Ráfaga', hint: 'Proyectiles que salen de la sonda en direcciones al azar' },
    'relics.families.chaos.bolts.count': { label: 'Proyectiles por ráfaga', hint: 'Cuántos proyectiles salen en cada ráfaga' },
    'relics.families.chaos.bolts.damage': { label: 'Daño de cada proyectil', hint: `Lo que quita cada proyectil al enemigo que toca; ${grows}` },
    'relics.families.chaos.bolts.speed': { label: 'Velocidad de los proyectiles', hint: 'Lo rápido que vuelan los proyectiles de la ráfaga' },
    'relics.families.chaos.slowField': { label: 'Campo lento', hint: 'Una zona alrededor de la sonda que frena a los enemigos que entran' },
    'relics.families.chaos.slowField.radius': { label: 'Radio del campo', hint: `El tamaño de la zona que frena; ${wider}` },
    'relics.families.chaos.slowField.seconds': { label: 'Duración del campo', hint: 'Cuánto tiempo dura la zona que frena', unit: 'seconds' },
    'relics.families.chaos.haste': { label: 'Acelerón', hint: 'La sonda se mueve más rápido durante un rato' },
    'relics.families.chaos.haste.bonus': { label: 'Velocidad extra', hint: 'Lo que suma a la velocidad de la sonda mientras dura, donde 1 es un 100 %' },
    'relics.families.chaos.haste.seconds': { label: 'Duración del acelerón', hint: 'Cuánto tiempo va más rápida la sonda', unit: 'seconds' },

    'relics.families.aura': {
      label: 'Aura',
      hint: 'Pasiva de las galaxias anillo, un aura alrededor de la sonda que daña sin parar a los enemigos que entran',
    },
    'relics.families.aura.damage': { label: 'Daño por toque', hint: `Lo que quita el aura a cada enemigo dentro en cada toque; ${grows}` },
    'relics.families.aura.interval': {
      label: 'Tiempo entre toques',
      hint: 'Cada cuánto daña el aura a los enemigos que tiene dentro; la densidad de estrellas lo acorta',
      unit: 'seconds',
    },
    'relics.families.aura.radius': { label: 'Radio del aura', hint: `Hasta dónde llega el aura alrededor de la sonda; ${wider}` },
    'relics.families.aura.cone': {
      label: 'Apertura del cono',
      hint: 'En una galaxia inclinada el aura es un cono hacia donde mira la sonda, y este es su ángulo en grados',
    },
    'relics.families.aura.coneRadius': {
      label: 'Alcance del cono',
      hint: 'Por cuánto se multiplica el radio del aura cuando es un cono, para compensar que cubre menos',
      unit: 'factor',
    },

    'relics.families.scout': { label: 'Explorador', hint: 'Pasiva de las enanas, la sonda recoge desde más lejos y se mueve más rápido' },
    'relics.families.scout.pickup': {
      label: 'Alcance de recogida extra',
      hint: 'Lo que suma al alcance de recogida de la sonda, donde 1 es un 100 %; crece con la potencia de la reliquia',
    },
    'relics.families.scout.speed': {
      label: 'Velocidad extra',
      hint: 'Lo que suma a la velocidad de la sonda, donde 1 es un 100 %; crece con la potencia de la reliquia',
    },

    'relics.families.echo': {
      label: 'Eco de otra reliquia',
      hint: 'Pasiva de las galaxias en fusión, copia la pasiva de la siguiente reliquia equipada, con menos fuerza',
    },
    'relics.families.echo.share': { label: 'Fuerza de la copia', hint: 'Por cuánto se multiplica la potencia de la pasiva que copia', unit: 'factor' },

    // The unique powers: phenomena, the cores and the mythic's singularity.
    'relics.phenomena': {
      label: 'Fenómenos',
      hint: 'La habilidad única que da el fenómeno de una galaxia; sus daños crecen con la potencia de la reliquia y el daño de la sonda',
      section: POWERS,
    },
    'relics.phenomena.supernova': { label: 'Supernova', hint: 'Cada poco estalla una nova alrededor de la sonda que daña a todos los enemigos cercanos' },
    'relics.phenomena.supernova.cooldown': { label: 'Tiempo entre estallidos', hint: `Cada cuánto estalla; ${sooner}`, unit: 'seconds' },
    'relics.phenomena.supernova.damage': { label: 'Daño del estallido', hint: `Lo que quita a cada enemigo que alcanza; ${grows}` },
    'relics.phenomena.supernova.radius': { label: 'Radio del estallido', hint: `Hasta dónde llega; ${wider}` },

    'relics.phenomena.satellite_galaxy': {
      label: 'Galaxia satélite',
      hint: 'Un dron acompaña a la sonda y dispara por su cuenta al enemigo más cercano',
    },
    'relics.phenomena.satellite_galaxy.cooldown': { label: 'Tiempo entre disparos', hint: `Cada cuánto dispara el dron; ${sooner}`, unit: 'seconds' },
    'relics.phenomena.satellite_galaxy.damage': { label: 'Daño de cada disparo', hint: `Lo que quita cada disparo del dron; ${grows}` },
    'relics.phenomena.satellite_galaxy.range': { label: 'Alcance del dron', hint: 'Lo lejos que busca enemigos el dron para dispararles' },
    'relics.phenomena.satellite_galaxy.speed': { label: 'Velocidad de los disparos', hint: 'Lo rápido que vuelan los disparos del dron' },

    'relics.phenomena.globular_cluster': { label: 'Cúmulo globular', hint: 'Orbes que giran alrededor de la sonda y golpean al pasar' },
    'relics.phenomena.globular_cluster.count': { label: 'Número de orbes', hint: 'Cuántos orbes giran alrededor de la sonda' },
    'relics.phenomena.globular_cluster.damage': { label: 'Daño de cada orbe', hint: `Lo que quita un orbe a cada enemigo que toca; ${grows}` },
    'relics.phenomena.globular_cluster.radius': { label: 'Distancia a la sonda', hint: `A qué distancia de la sonda giran los orbes; ${wider}` },
    'relics.phenomena.globular_cluster.speed': { label: 'Velocidad de giro', hint: 'Lo rápido que giran los orbes alrededor de la sonda, en grados por segundo' },
    'relics.phenomena.globular_cluster.interval': {
      label: 'Espera entre golpes',
      hint: 'Cuánto tarda un mismo orbe en volver a dañar al mismo enemigo',
      unit: 'seconds',
    },

    'relics.phenomena.comet': {
      label: 'Cometa',
      hint: 'El dash de la sonda daña lo que atraviesa y gana cargas; las cargas que da se ajustan en las reglas del dash',
    },
    'relics.phenomena.comet.damage': { label: 'Daño del dash', hint: `Lo que quita el dash a cada enemigo que atraviesa; ${grows}` },
    'relics.phenomena.comet.cooldown': {
      label: 'Recarga antigua',
      hint: 'Ya no se usa, era la carga automática del cometa antes de que pasara a mejorar el dash',
      unit: 'seconds',
      advanced: true,
    },
    'relics.phenomena.comet.distance': {
      label: 'Distancia antigua',
      hint: 'Ya no se usa, era la distancia de la carga automática del cometa antes de que pasara a mejorar el dash',
      advanced: true,
    },
    'relics.phenomena.comet.seconds': {
      label: 'Duración antigua',
      hint: 'Ya no se usa, era la duración de la carga automática del cometa antes de que pasara a mejorar el dash',
      unit: 'seconds',
      advanced: true,
    },

    'relics.phenomena.relativistic_jets': {
      label: 'Chorros relativistas',
      hint: 'Cada poco dispara dos chorros gemelos, hacia delante y hacia atrás, que atraviesan enemigos',
    },
    'relics.phenomena.relativistic_jets.cooldown': { label: 'Tiempo entre chorros', hint: `Cada cuánto dispara; ${sooner}`, unit: 'seconds' },
    'relics.phenomena.relativistic_jets.damage': { label: 'Daño de cada chorro', hint: `Lo que quita a cada enemigo que atraviesa; ${grows}` },
    'relics.phenomena.relativistic_jets.pierce': { label: 'Enemigos que atraviesa', hint: 'Cuántos enemigos atraviesa cada chorro antes de apagarse' },
    'relics.phenomena.relativistic_jets.speed': { label: 'Velocidad de los chorros', hint: 'Lo rápido que avanzan los chorros' },

    'relics.phenomena.pulsar': { label: 'Púlsar', hint: 'Ondas rítmicas alrededor de la sonda que dañan a los enemigos cercanos' },
    'relics.phenomena.pulsar.cooldown': { label: 'Tiempo entre ondas', hint: `Cada cuánto sale una onda; ${sooner}`, unit: 'seconds' },
    'relics.phenomena.pulsar.radius': { label: 'Radio de la onda', hint: `Hasta dónde llega cada onda; ${wider}` },
    'relics.phenomena.pulsar.damage': { label: 'Daño de cada onda', hint: `Lo que quita cada onda a cada enemigo que alcanza; ${grows}` },

    'relics.phenomena.einstein_ring': { label: 'Anillo de Einstein', hint: 'Las armas de la sonda disparan más proyectiles' },
    'relics.phenomena.einstein_ring.projectiles': { label: 'Proyectiles extra', hint: 'Cuántos proyectiles suma a las armas de la sonda cada galaxia con este fenómeno' },

    'relics.phenomena.anomaly': {
      label: 'Anomalía',
      hint: 'Cada poco un fallo de la realidad al azar, que aleja a la sonda del enemigo más cercano, congela a los cercanos o descarga sobre varios',
    },
    'relics.phenomena.anomaly.cooldown': { label: 'Tiempo entre fallos', hint: `Cada cuánto se produce un fallo; ${sooner}`, unit: 'seconds' },
    'relics.phenomena.anomaly.blink': { label: 'Distancia del salto', hint: 'Lo lejos que lanza a la sonda, alejándola del enemigo más cercano' },
    'relics.phenomena.anomaly.freezeRadius': { label: 'Radio de la congelación', hint: 'Hasta dónde congela a los enemigos cercanos, nunca a un Núcleo' },
    'relics.phenomena.anomaly.freezeSeconds': { label: 'Duración de la congelación', hint: 'Cuánto tiempo quedan congelados los enemigos', unit: 'seconds' },
    'relics.phenomena.anomaly.strikeDamage': { label: 'Daño de cada descarga', hint: `Lo que quita la descarga a cada enemigo que golpea; ${grows}` },
    'relics.phenomena.anomaly.strikeCount': { label: 'Enemigos que reciben descarga', hint: 'A cuántos enemigos a la vista golpea la descarga, elegidos al azar' },

    'relics.quasar': {
      label: 'Núcleo cuásar',
      hint: 'Una galaxia con núcleo cuásar dispara además cada poco un chorro que atraviesa enemigos hacia donde apunta la sonda',
      section: POWERS,
    },
    'relics.quasar.cooldown': { label: 'Tiempo entre chorros', hint: `Cada cuánto dispara; ${sooner}`, unit: 'seconds' },
    'relics.quasar.damage': { label: 'Daño del chorro', hint: `Lo que quita a cada enemigo que atraviesa; ${grows}` },
    'relics.quasar.pierce': { label: 'Enemigos que atraviesa', hint: 'Cuántos enemigos atraviesa cada chorro antes de apagarse' },
    'relics.quasar.speed': { label: 'Velocidad del chorro', hint: 'Lo rápido que avanza el chorro' },

    'relics.double': {
      label: 'Núcleo doble',
      hint: 'En una galaxia con núcleo doble, el rayo perforante o el caos se repiten justo después de cada disparo',
      section: POWERS,
    },
    'relics.double.delay': { label: 'Espera hasta repetir', hint: 'Cuánto tarda en llegar la repetición', unit: 'seconds' },

    'relics.singularity': {
      label: 'Singularidad',
      hint: 'El poder de toda reliquia mítica, un agujero negro en el grupo de enemigos más denso que los atrae y después estalla',
      section: POWERS,
    },
    'relics.singularity.cooldown': { label: 'Tiempo entre agujeros', hint: `Cada cuánto se abre uno; ${sooner}`, unit: 'seconds' },
    'relics.singularity.seconds': { label: 'Tiempo atrayendo', hint: 'Cuánto tiempo atrae enemigos el agujero antes de estallar', unit: 'seconds' },
    'relics.singularity.seek': { label: 'Distancia de búsqueda', hint: 'Lo lejos de la sonda que busca el grupo de enemigos más denso' },
    'relics.singularity.radius': {
      label: 'Radio de atracción',
      hint: 'Hasta dónde atrae enemigos, nunca Núcleos ni botín, y lo que cuenta para medir un grupo; crece con el área de la sonda',
    },
    'relics.singularity.pull': { label: 'Fuerza de atracción', hint: 'Lo rápido que arrastra a los enemigos hacia el centro' },
    'relics.singularity.blast': { label: 'Radio del estallido', hint: 'Hasta dónde daña el estallido final; crece con el área de la sonda' },
    'relics.singularity.damage': { label: 'Daño del estallido', hint: 'Lo que quita a cada enemigo al estallar; crece con la potencia de la mítica y el daño de la sonda' },
    'relics.singularity.push': { label: 'Empuje del estallido', hint: 'Lo lejos que lanza a los supervivientes para que no se queden en una bola' },
    'relics.singularity.clear': {
      label: 'Distancia mínima a las sondas',
      hint: 'Nunca se abre más cerca de una sonda en pie, para no echarle encima a los enemigos',
      advanced: true,
    },

    // The bonuses: backgrounds and sets.
    'relics.backgrounds': {
      label: 'Bonos de fondo',
      hint: 'Cada fondo de galaxia da a la sonda un bono a una estadística mientras esa galaxia esté equipada',
      section: BONUSES,
    },
    'relics.backgrounds.*': { label: 'Bono de este fondo', hint: 'La estadística que mejora una galaxia con este fondo, y cuánto' },
    'relics.backgrounds.*.stat': {
      label: 'Estadística',
      hint: 'Qué estadística de la sonda mejora; el campo de visión deja ver más parte del mapa',
      vocab: 'stat',
    },
    'relics.backgrounds.*.value': {
      label: 'Cuánto suma',
      hint: 'Lo que suma a esa estadística, como una mejora pasiva; en las que van en porcentaje, 1 es un 100 %',
    },

    'relics.sets': {
      label: 'Conjuntos',
      hint: 'Bonos por equipar varias galaxias que comparten un rasgo, o un tipo de galaxia junto a un fenómeno',
      noun: 'conjunto',
      section: BONUSES,
    },
    'relics.sets[]': { label: 'Conjunto', hint: 'Un bono que se activa al equipar las galaxias que pide' },
    'relics.sets[].id': { label: 'Identificador', hint: 'Nombre interno y permanente del conjunto; no lo cambies una vez publicado' },
    'relics.sets[].name': { label: 'Nombre', hint: 'Cómo lo ven los jugadores en el Hangar' },
    'relics.sets[].description': { label: 'Descripción', hint: 'Qué galaxias pide, en una frase para el jugador' },
    'relics.sets[].kind': {
      label: 'Tipo de conjunto',
      hint: 'Si pide galaxias con un mismo rasgo o una galaxia de un tipo junto a un fenómeno',
      vocab: 'setKind',
    },
    'relics.sets[].trait': { label: 'Rasgo que comparten', hint: 'Qué rasgo tienen que tener igual las galaxias equipadas', vocab: 'sameTrait' },
    'relics.sets[].tiers': {
      label: 'Tramos',
      hint: 'Lo que da con dos galaxias y lo que da con tres, de menor a mayor; vale el tramo más alto que se alcance',
      noun: 'tramo',
    },
    'relics.sets[].tiers[]': { label: 'Tramo', hint: 'Cuántas galaxias pide y el bono que da' },
    'relics.sets[].tiers[].count': { label: 'Galaxias que pide', hint: 'Cuántas galaxias con el mismo rasgo hay que equipar', vocab: 'setCount' },
    ...bonus('relics.sets[].tiers[].bonus'),
    'relics.sets[].type': {
      label: 'Tipo de galaxia',
      hint: 'El tipo de galaxia que pide, escrito tal y como lo guardan los rasgos; con una errata el conjunto nunca se activa',
    },
    'relics.sets[].phenomenon': {
      label: 'Fenómeno',
      hint: 'El fenómeno que pide, en la misma galaxia del tipo o en otra; con una errata el conjunto nunca se activa',
      vocab: 'phenomenon',
    },
    ...bonus('relics.sets[].bonus'),
  },
  vocabs: {
    phenomenon: {
      supernova: { label: 'Supernova', explain: 'Cada poco estalla una nova alrededor de la sonda que daña a todos los cercanos' },
      satellite_galaxy: { label: 'Galaxia satélite', explain: 'Un dron acompaña a la sonda y dispara por su cuenta' },
      globular_cluster: { label: 'Cúmulo globular', explain: 'Orbes que giran alrededor de la sonda y golpean al pasar' },
      comet: { label: 'Cometa', explain: 'El dash daña lo que atraviesa y da más cargas' },
      relativistic_jets: { label: 'Chorros relativistas', explain: 'Dos chorros gemelos, hacia delante y hacia atrás, que atraviesan enemigos' },
      pulsar: { label: 'Púlsar', explain: 'Ondas rítmicas alrededor de la sonda que dañan a los cercanos' },
      einstein_ring: { label: 'Anillo de Einstein', explain: 'Las armas de la sonda disparan un proyectil más' },
      anomaly: {
        label: 'Anomalía',
        explain: 'Cada poco un fallo de la realidad al azar, que aleja a la sonda, congela a los enemigos cercanos o descarga sobre varios',
      },
    },
    setKind: {
      same: { label: 'Rasgo compartido', explain: 'Dos o tres galaxias equipadas con la misma paleta, tipo, fondo o núcleo' },
      combo: { label: 'Tipo con fenómeno', explain: 'Una galaxia de un tipo y un fenómeno concreto, en esa misma galaxia o en otra' },
    },
    sameTrait: {
      palette: { label: 'Paleta', explain: 'Galaxias de la misma paleta de colores, que dan el mismo elemento' },
      galaxy_type: { label: 'Tipo de galaxia', explain: 'Galaxias del mismo tipo, que dan la misma pasiva' },
      background: { label: 'Fondo', explain: 'Galaxias con el mismo fondo, que dan el mismo bono de fondo' },
      core: { label: 'Núcleo', explain: 'Galaxias con el mismo tipo de núcleo' },
    },
    setCount: {
      '2': { label: 'Dos galaxias', explain: 'El tramo se activa con dos galaxias que comparten el rasgo' },
      '3': { label: 'Tres galaxias', explain: 'El tramo se activa con tres galaxias que comparten el rasgo' },
    },
  },
};
