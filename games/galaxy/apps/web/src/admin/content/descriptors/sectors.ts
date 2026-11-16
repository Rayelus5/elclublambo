import type { DescriptorPart } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// Sectors: the scenarios of a run (systems/director.ts, layers.ts, boss.ts, combat.ts), docs/CONTENIDO.md A8 bis.

export const part: DescriptorPart = {
  fields: {
    sectors: {
      label: 'Sectores',
      noun: 'sector',
      hint: 'Los escenarios de las incursiones; el orden de la lista es el de su dificultad, del más fácil al de temporada',
    },
    'sectors[]': { label: 'Sector', hint: 'Un escenario con su fauna, sus oleadas, su dificultad, su botín y sus Núcleos' },

    // Identity.
    'sectors[].id': {
      label: 'Identificador',
      section: 'Identidad',
      hint: 'Nombre interno que usan los desbloqueos, las misiones, los pagos y las estadísticas; no lo cambies en un sector ya publicado',
    },
    'sectors[].name': { label: 'Nombre', section: 'Identidad', hint: 'Cómo se llama en el hangar, en el Códice y en la radio' },
    'sectors[].description': { label: 'Descripción', section: 'Identidad', hint: 'El texto corto que se ve al elegirlo en el hangar' },
    'sectors[].lore': { label: 'Texto del Códice', section: 'Textos', hint: 'Lo que cuenta de él su entrada del Códice; vacío, el texto de siempre del juego o su descripción' },
    'sectors[].radio': {
      label: 'Línea de PERKINS',
      section: 'Textos',
      hint: 'Lo que dice PERKINS en la primera incursión de cada jugador en él; vacío, la línea de siempre o ninguna',
    },
    'sectors[].hazardNames': {
      label: 'Nombres de los peligros',
      section: 'Textos',
      hint: 'Cómo llama este sector a sus peligros en los avisos y en la pantalla; el que quede vacío usa el nombre de siempre',
    },
    'sectors[].hazardNames.meteors': { label: 'Lluvia de meteoritos', hint: 'Su nombre en este sector, como «Granizo de hielo»' },
    'sectors[].hazardNames.storm': { label: 'Tormenta de la Estática', hint: 'Su nombre en este sector, como «Ventisca estática»' },
    'sectors[].hazardNames.well': { label: 'Pozo de gravedad', hint: 'Su nombre en este sector, como «Remolino helado»' },
    'sectors[].biome': {
      label: 'Bioma',
      section: 'Identidad',
      vocab: 'biome',
      hint: 'El aspecto del suelo, las rocas y los objetos rompibles; solo cambia cómo se ve, no cómo se juega',
    },
    'sectors[].season': {
      label: 'Sector de temporada',
      section: 'Identidad',
      hint: 'Si está marcado, solo se puede jugar mientras su temporada está en marcha',
    },

    // Its Núcleos.
    'sectors[].boss': {
      label: 'Núcleo',
      section: 'Núcleos',
      options: 'bosses',
      hint: 'El Núcleo de la primera capa, el que enseña el hangar',
    },
    'sectors[].bossCycle': {
      label: 'Formas del Núcleo',
      section: 'Núcleos',
      options: 'bosses',
      noun: 'forma',
      hint: 'Los Núcleos que salen por turnos, uno por capa; la primera tiene que ser el Núcleo del sector y, si está vacío, sale siempre el mismo',
    },
    'sectors[].deepBoss': {
      label: 'Núcleo profundo',
      section: 'Núcleos',
      hint: 'Un Núcleo especial que sustituye al normal cada cierto número de capas; vacío si el sector no tiene',
    },
    'sectors[].deepBoss.boss': { label: 'Núcleo profundo', options: 'bosses', hint: 'El que sale la primera vez que toca' },
    'sectors[].deepBoss.every': {
      label: 'Cada cuántas capas',
      hint: 'Sale en las capas múltiplo de este número en lugar del Núcleo normal; esas capas no cuentan en el turno de formas',
    },
    'sectors[].deepBoss.cycle': {
      label: 'Formas del Núcleo profundo',
      options: 'bosses',
      noun: 'forma',
      hint: 'Las formas que va tomando, una cada vez que sale; la primera tiene que ser el Núcleo profundo y, si está vacío, sale siempre el mismo',
    },

    // Toughness.
    'sectors[].enemyHp': {
      label: 'Vida de los enemigos',
      section: 'Dificultad',
      unit: 'factor',
      hint: 'Multiplica la vida de toda su fauna y de sus Núcleos; cada sector de la lista debe ir por encima del anterior',
    },
    'sectors[].enemyDamage': { label: 'Daño de la fauna', section: 'Dificultad', unit: 'factor', hint: 'Multiplica el daño de su fauna, no el de sus Núcleos' },
    'sectors[].coreDamage': {
      label: 'Daño de los Núcleos',
      section: 'Dificultad',
      unit: 'factor',
      hint: 'Multiplica el daño de sus Núcleos; cada sector de la lista debe ir por encima del anterior',
    },
    'sectors[].scaling': {
      label: 'Crecimiento de la dificultad',
      section: 'Dificultad',
      hint: 'Cómo se endurece la fauna con los minutos, las capas y el nivel del equipo, y cuántas élites salen',
    },
    'sectors[].scaling.hpPerMinute': {
      label: 'Vida extra por minuto',
      hint: 'Parte de su vida que gana la fauna por cada minuto de incursión, sumada minuto a minuto en línea recta',
    },
    'sectors[].scaling.damagePerMinute': {
      label: 'Daño extra por minuto',
      hint: 'Parte de su daño que gana la fauna por cada minuto de incursión, sumada minuto a minuto en línea recta',
    },
    'sectors[].scaling.hpPerLayer': { label: 'Vida extra por capa', hint: 'Parte de su vida que gana la fauna por cada capa más honda, sumada capa a capa' },
    'sectors[].scaling.damagePerLayer': { label: 'Daño extra por capa', hint: 'Parte de su daño que gana la fauna por cada capa más honda, sumada capa a capa' },
    'sectors[].scaling.speedPerLayer': { label: 'Velocidad extra por capa', hint: 'Parte de su velocidad que gana la fauna por cada capa más honda, sumada capa a capa' },
    'sectors[].scaling.eliteBase': { label: 'Élites al empezar', unit: 'percent', hint: 'Probabilidad de que un enemigo salga como élite al empezar la incursión' },
    'sectors[].scaling.elitePerMinute': { label: 'Élites extra por minuto', unit: 'percent', hint: 'Cuánto sube esa probabilidad por cada minuto de incursión' },
    'sectors[].scaling.eliteMax': { label: 'Tope de élites', unit: 'percent', hint: 'La probabilidad de que un enemigo salga como élite nunca pasa de aquí' },
    'sectors[].scaling.hpPerLevel': {
      label: 'Vida por nivel del equipo',
      unit: 'percent',
      advanced: true,
      hint: 'Vida que gana la fauna por cada nivel del equipo por encima del nivel de inicio, acumulada nivel a nivel',
    },
    'sectors[].scaling.levelFrom': {
      label: 'Nivel de inicio',
      advanced: true,
      hint: 'Desde qué nivel de la sonda más alta del equipo cuenta la vida por nivel; los niveles de antes no endurecen nada',
    },
    'sectors[].scaling.coreHpPerLevel': {
      label: 'Vida de los Núcleos por nivel',
      unit: 'percent',
      advanced: true,
      hint: 'Vida que gana cada Núcleo por cada nivel del equipo por encima del nivel de inicio, en línea recta',
    },
    'sectors[].scaling.coreRise': {
      label: 'Subida mínima entre Núcleos',
      advanced: true,
      hint: 'Cada Núcleo de la incursión tiene al menos la vida del anterior más esta parte de ella; a cero no se aplica',
    },
    'sectors[].scaling.hpLevelMax': {
      label: 'Tope de la vida por nivel',
      unit: 'factor',
      advanced: true,
      hint: 'Lo más que puede multiplicar la vida por nivel a la fauna, por alto que sea el nivel del equipo',
    },

    // Layers and the extraction beacon.
    'sectors[].layerSeconds': {
      label: 'Duración de cada capa',
      section: 'Capas y baliza',
      unit: 'seconds',
      hint: 'Cuánto dura cada capa antes de que llegue su Núcleo',
    },
    'sectors[].beacon': {
      label: 'Baliza de extracción',
      section: 'Capas y baliza',
      hint: 'La baliza que se abre al derrotar al Núcleo; las sondas que aguantan dentro extraen la incursión con su botín',
    },
    'sectors[].beacon.seconds': {
      label: 'Tiempo abierta',
      unit: 'seconds',
      hint: 'Cuánto tiempo queda abierta; si se cierra sin extraer, la incursión baja una capa más',
    },
    'sectors[].beacon.hold': { label: 'Tiempo dentro para extraer', unit: 'seconds', hint: 'Cuánto tienen que aguantar dentro todas las sondas vivas para extraer' },
    'sectors[].beacon.radius': { label: 'Tamaño de la baliza', hint: 'El radio del círculo en el que hay que meterse' },
    'sectors[].beacon.distance': { label: 'Distancia de la baliza', hint: 'A qué distancia de las sondas aparece; más lejos obliga a cruzar la fauna para llegar' },

    // Fauna and its density.
    'sectors[].spawns': {
      label: 'Fauna',
      section: 'Fauna',
      noun: 'enemigo',
      hint: 'Las especies que van saliendo en el sector, cuándo empiezan y con qué frecuencia',
    },
    'sectors[].spawns[]': { label: 'Especie', hint: 'Una especie del sector con cuándo empieza a salir, su frecuencia y su grupo' },
    'sectors[].spawns[].enemy': { label: 'Enemigo', options: 'enemies', hint: 'La especie que sale' },
    'sectors[].spawns[].from': {
      label: 'Sale desde',
      unit: 'seconds',
      hint: 'Segundo de la primera capa desde el que empieza a salir; desde la segunda capa salen todas desde el principio',
    },
    'sectors[].spawns[].weight': {
      label: 'Frecuencia',
      hint: 'Su peso al elegir qué especie sale: con el doble de peso que otra, sale el doble de veces',
    },
    'sectors[].spawns[].group': {
      label: 'Tamaño del grupo',
      items: ['Mínimo', 'Máximo'],
      hint: 'Cuántos llegan juntos cada vez que sale, al azar entre el mínimo y el máximo',
    },
    'sectors[].density': {
      label: 'Densidad',
      section: 'Fauna',
      hint: 'Cuántos grupos de fauna salen por segundo y cuántos enemigos puede haber vivos a la vez',
    },
    'sectors[].density.base': { label: 'Grupos por segundo al empezar', hint: 'El ritmo de aparición al empezar la incursión' },
    'sectors[].density.perMinute': { label: 'Aumento por minuto', hint: 'Grupos por segundo que se suman al ritmo por cada minuto de incursión' },
    'sectors[].density.max': {
      label: 'Tope de grupos por segundo',
      hint: 'El ritmo de aparición no pasa de aquí; en las capas hondas el tope sube con el aumento por capa',
    },
    'sectors[].density.cap': {
      label: 'Enemigos vivos a la vez',
      hint: 'Cuántos enemigos puede haber vivos a la vez como mucho; en las capas hondas sube con el aumento por capa',
    },
    'sectors[].density.bossFactor': {
      label: 'Fauna durante el Núcleo',
      unit: 'percent',
      hint: 'Parte del ritmo de aparición y de los enemigos a la vez que queda mientras el Núcleo está vivo, para poder llegar hasta él',
    },
    'sectors[].density.perLayer': {
      label: 'Aumento por capa',
      hint: 'Cuánto suben los topes de grupos y de enemigos vivos en cada capa desde la segunda, como parte de los normales; con el Núcleo no se aplica',
    },

    // Waves.
    'sectors[].waves': {
      label: 'Oleadas',
      section: 'Oleadas',
      noun: 'oleada',
      hint: 'Grupos fijos que llegan en un momento concreto de cada capa, además de la fauna normal',
    },
    'sectors[].waves[]': { label: 'Oleada', hint: 'Un grupo fijo de una especie que llega en un momento de cada capa' },
    'sectors[].waves[].at': { label: 'Momento', unit: 'seconds', hint: 'Segundo de cada capa en que llega la oleada' },
    'sectors[].waves[].kind': { label: 'Forma de llegar', vocab: 'waveKind', hint: 'Si rodea a la sonda o llega toda junta desde un lado' },
    'sectors[].waves[].enemy': { label: 'Enemigo', options: 'enemies', hint: 'La especie de la que es la oleada' },
    'sectors[].waves[].count': { label: 'Cuántos', hint: 'Cuántos enemigos trae; en grupo crece con los jugadores y se reparte entre ellos' },

    // Elites.
    'sectors[].elite': {
      label: 'Élites',
      section: 'Élites',
      hint: 'Lo que gana un enemigo de este sector al salir como élite, sea del tipo que sea',
    },
    'sectors[].elite.hp': { label: 'Vida de las élites', unit: 'factor', hint: 'Multiplica la vida de un enemigo cuando sale como élite' },
    'sectors[].elite.radius': { label: 'Tamaño de las élites', unit: 'factor', hint: 'Multiplica el tamaño de un enemigo cuando sale como élite' },
    'sectors[].elite.xp': { label: 'Experiencia de las élites', unit: 'factor', hint: 'Multiplica la experiencia que suelta un enemigo cuando sale como élite' },
    'sectors[].elite.coins': { label: 'Monedas por élite', hint: 'Las monedas que suelta cada élite al morir, además de un kit de reparación' },
    'sectors[].elite.dust': { label: 'Polvo por élite', hint: 'El polvo estelar que suelta cada élite al morir' },

    // Loot.
    'sectors[].drops': { label: 'Botín', section: 'Botín', hint: 'Lo que sueltan los enemigos al morir y lo que trae el cofre del Núcleo' },
    'sectors[].drops.coin': {
      label: 'Probabilidad de moneda',
      unit: 'percent',
      hint: 'Probabilidad de que un enemigo normal suelte una moneda; la suerte de la sonda la sube',
    },
    'sectors[].drops.dust': {
      label: 'Probabilidad de polvo',
      unit: 'percent',
      hint: 'Probabilidad de que un enemigo normal suelte polvo estelar; la suerte de la sonda la sube',
    },
    'sectors[].drops.repair': {
      label: 'Probabilidad de kit de reparación',
      unit: 'percent',
      hint: 'Probabilidad de que un enemigo normal suelte un kit que cura a la sonda; las élites siempre sueltan uno',
    },
    'sectors[].drops.repairHeal': { label: 'Curación del kit', unit: 'percent', hint: 'Parte de la vida máxima de la sonda que cura cada kit de reparación' },
    'sectors[].drops.bossCoins': { label: 'Monedas del cofre', hint: 'Las monedas del cofre que suelta el Núcleo al caer' },
    'sectors[].drops.bossDust': { label: 'Polvo del cofre', hint: 'El polvo estelar del cofre que suelta el Núcleo al caer' },
    'sectors[].drops.magnet': {
      label: 'Probabilidad de imán',
      unit: 'percent',
      hint: 'Probabilidad de que un enemigo normal suelte un imán, que atrae hacia la sonda todo lo que hay en el suelo',
    },
    'sectors[].drops.eliteMagnet': {
      label: 'Probabilidad de imán en élites',
      unit: 'percent',
      hint: 'Probabilidad de que una élite suelte un imán; el cofre del Núcleo siempre trae uno',
    },
  },
  vocabs: {
    biome: {
      nebula: { label: 'Nebulosa', explain: 'Gas violeta y azul oscuro con estrellas frías, el suelo de la Nebulosa Exterior' },
      ice: { label: 'Hielo', explain: 'Bruma azul fría con estrellas blancas y rocas de hielo' },
      reef: { label: 'Arrecife', explain: 'Brillo violeta y turquesa de un arrecife en la oscuridad, con rocas de coral' },
      forge: { label: 'Forja', explain: 'Humo y brasas en marrón oscuro, con rocas de escoria' },
      rift: { label: 'Fisura', explain: 'Estática violeta con destellos cian, el suelo de la fisura de la Señal' },
    },
    waveKind: {
      ring: { label: 'Anillo', explain: 'Los enemigos aparecen repartidos en un círculo alrededor de la sonda, justo fuera de la vista, y la rodean' },
      burst: { label: 'Grupo', explain: 'Los enemigos llegan todos juntos desde una misma dirección al azar' },
    },
  },
};
