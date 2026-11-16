import type { Special, StatKey, WeaponKind } from '@galaxy/sim';
import type { DescriptorPart, Term } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// The arsenal: the weapons (with their evolutions and the starting weapons' variants) and the passives. It owns the
// vocabularies of the weapon kinds, the evolutions' specials, the probe stats (and the relic backgrounds' «vision») and
// the levels a variant opens at.

const level = (i: number) => `Nivel ${i + 1}`;

const weaponKind: Record<WeaponKind, Term> = {
  bolt: {
    label: 'Disparo dirigido',
    explain: 'Dispara al enemigo más cercano dentro de su alcance, un proyectil por cada uno de su cantidad. Usa daño, recarga, cantidad, perforación, velocidad y alcance',
  },
  nova: {
    label: 'Onda',
    explain: 'Un anillo de energía estalla a tu alrededor y daña y empuja todo lo que alcanza. Usa daño, recarga, área como radio y empuje',
  },
  lance: {
    label: 'Lanza',
    explain: 'Proyectiles que salen hacia donde apuntas y atraviesan a varios enemigos en línea. Usa daño, recarga, cantidad, perforación, velocidad y alcance',
  },
  orbit: {
    label: 'Orbes',
    explain: 'Orbes que giran sin parar a tu alrededor y golpean al pasar. Usa daño, cantidad, área como radio del giro, velocidad de giro e intervalo entre golpes al mismo enemigo',
  },
  trail: {
    label: 'Estela',
    explain: 'Mientras te mueves deja charcos que dañan a quien los pisa. Usa daño, recarga entre charcos, área, duración e intervalo entre golpes',
  },
  ricochet: {
    label: 'Rebote',
    explain: 'Una descarga va al enemigo más cercano y salta de uno a otro. Usa daño, recarga, velocidad, rebotes y alcance como distancia de cada salto',
  },
  drone: {
    label: 'Drones',
    explain: 'Drones que te siguen y disparan solos al enemigo más cercano. Usa daño, cantidad de drones, recarga entre disparos, alcance y velocidad de sus balas',
  },
  beam: {
    label: 'Rayo fijado',
    explain: 'Un rayo se fija en el enemigo más cercano y quema toda su línea durante un rato. Usa daño, recarga, cantidad, alcance, área como grosor, duración e intervalo',
  },
  cone: {
    label: 'Abanico',
    explain: 'Un abanico sale hacia donde apuntas y daña lo que hay dentro mientras dura. Usa daño, recarga, alcance, área como apertura en grados, duración e intervalo',
  },
  radial: {
    label: 'Lluvia radial',
    explain: 'Una lluvia de esquirlas en todas las direcciones cuando hay enemigos cerca. Usa daño, recarga, cantidad, perforación, velocidad y alcance',
  },
  homing: {
    label: 'Misiles buscadores',
    explain: 'Misiles que persiguen al enemigo más cercano y estallan al llegar. Usa daño, recarga, cantidad, velocidad, alcance y área como radio de la explosión',
  },
  mine: {
    label: 'Minas',
    explain: 'Deja minas a tus pies que estallan cuando un enemigo se acerca. Usa daño, recarga, cantidad, área de la explosión, alcance como distancia de activación y duración',
  },
  boomerang: {
    label: 'Disco de retorno',
    explain: 'Discos que van hacia los enemigos, vuelven a ti y cortan todo a su paso. Usa daño, recarga, cantidad, velocidad, alcance e intervalo entre golpes',
  },
  field: {
    label: 'Pozo',
    explain: 'Abre un pozo sobre el enemigo más cercano que atrae y daña a los que caen dentro. Usa daño, recarga, alcance, área, duración, intervalo y empuje como fuerza de atracción',
  },
  strike: {
    label: 'Bombardeo',
    explain: 'Marca enemigos al azar a la vista y los bombardea tras un aviso. Usa daño, recarga, cantidad de marcas, alcance, área de la explosión e intervalo como aviso',
  },
  turret: {
    label: 'Torreta',
    explain: 'Planta torretas fijas que disparan al enemigo más cercano mientras duran. Usa daño, recarga para plantar, cantidad máxima, duración, intervalo entre disparos, alcance y velocidad',
  },
  harpoon: {
    label: 'Arpón',
    explain: 'Ensarta al enemigo más cercano y lo arrastra hacia ti, golpeando a los que encuentra. Usa daño, recarga, cantidad, velocidad, alcance y empuje como fuerza del tirón',
  },
  sling: {
    label: 'Honda',
    explain: 'Atrapa a un enemigo corriente y lo lanza contra los demás, donde estalla. Usa daño, recarga, cantidad, velocidad, alcance para atrapar y área del estallido',
  },
  decoy: {
    label: 'Señuelo',
    explain: 'Deja un holograma tuyo que atrae a los enemigos cercanos y luego explota. Usa daño, recarga, cantidad, duración, alcance de atracción y área de la explosión',
  },
  lighthouse: {
    label: 'Faro',
    explain: 'Un láser largo gira a tu alrededor sin parar y barre lo que toca. Usa daño, cantidad, velocidad de giro en grados por segundo, alcance como largo, área como grosor e intervalo',
  },
  mortar: {
    label: 'Mortero',
    explain: 'Lanza un proyectil en parábola hacia donde vas que al caer se divide en bombitas avisadas. Usa daño, recarga, cantidad de bombitas, velocidad, alcance, área e intervalo como aviso',
  },
};

const special: Record<Special, Term> = {
  split: { label: 'Fragmentación', explain: 'El primer golpe de cada proyectil suelta tres fragmentos en abanico con la mitad de daño, que ya no se fragmentan' },
  echo: { label: 'Eco', explain: 'El arma repite cada andanada un instante después. En los drones, cada disparo se repite' },
  vortex: {
    label: 'Vórtice',
    explain: 'Atrae a los enemigos en vez de empujarlos. La onda los arrastra hacia ti, el abanico los reúne delante y la honda deja un pozo breve donde estalla',
  },
  pierceAll: { label: 'Perforación total', explain: 'Sus proyectiles atraviesan a todos los enemigos sin gastarse. El arpón ensarta la fila entera de una vez' },
  chain: { label: 'Cadena', explain: 'Cada golpe salta a dos enemigos cercanos con la mitad de daño. Esos saltos ya no vuelven a saltar' },
};

const stat: Record<StatKey | 'vision', Term> = {
  maxHp: { label: 'Vida máxima', explain: 'Más vida máxima para la sonda. Al subirla, la vida que tiene sube lo mismo' },
  speed: { label: 'Velocidad', explain: 'La sonda se mueve más rápido' },
  cooldown: { label: 'Recarga', explain: 'Las armas se recargan antes, y las cargas del dash vuelven antes' },
  damage: { label: 'Daño', explain: 'Todo lo que hace daño la sonda pega más fuerte' },
  area: { label: 'Área', explain: 'Agranda las ondas, explosiones, charcos, orbes y demás zonas de las armas' },
  pickup: { label: 'Alcance de recogida', explain: 'La sonda recoge fragmentos y botín desde más lejos' },
  projectiles: { label: 'Proyectiles', explain: 'Suma proyectiles, drones, minas o marcas a cada disparo. Se cuenta en unidades enteras' },
  regen: { label: 'Regeneración', explain: 'La sonda recupera vida poco a poco, en puntos de vida por segundo' },
  armor: { label: 'Blindaje', explain: 'La sonda ignora una parte del daño de cada golpe que recibe' },
  crit: { label: 'Crítico', explain: 'Más probabilidad de que un golpe sea crítico' },
  critDamage: { label: 'Daño crítico', explain: 'Los golpes críticos hacen más daño' },
  xp: { label: 'Experiencia', explain: 'Cada fragmento de datos da más experiencia, así que la sonda sube de nivel antes' },
  luck: { label: 'Suerte', explain: 'Caen más monedas, polvo estelar y kits de reparación' },
  lifesteal: { label: 'Robo de vida', explain: 'Parte del daño que hace la sonda la cura, dentro del límite de curación por segundo' },
  velocity: { label: 'Velocidad de proyectil', explain: 'Los proyectiles vuelan más rápido y llegan más lejos' },
  duration: { label: 'Duración', explain: 'Los charcos, rayos, pozos, minas, torretas y hologramas duran más' },
  pierce: { label: 'Perforación', explain: 'Los proyectiles atraviesan a más enemigos. Se cuenta en enemigos enteros' },
  elemental: { label: 'Potencia elemental', explain: 'Los elementos prenden más a menudo y duran más, y sus reacciones pegan más fuerte' },
  barrier: { label: 'Barrera', explain: 'Un escudo que crece con la vida máxima y se recarga cuando pasa un rato sin recibir golpes' },
  curse: { label: 'Maldición', explain: 'Llegan más enemigos y sueltan más botín. En grupo cuenta la más alta del equipo' },
  evasion: { label: 'Esquiva', explain: 'Probabilidad de que un golpe atraviese la sonda sin hacerle daño' },
  bossDamage: { label: 'Daño a Núcleos y élites', explain: 'Más daño contra los Núcleos y los enemigos élite' },
  execute: { label: 'Remate', explain: 'Los enemigos corrientes que bajan de esa parte de su vida caen al instante. Nunca los Núcleos ni las élites' },
  knockback: { label: 'Empuje', explain: 'Los golpes empujan más lejos a los enemigos corrientes. A las élites, la mitad, y a los Núcleos nada' },
  movingDamage: { label: 'Daño en marcha', explain: 'Más daño mientras la sonda se mueve' },
  vision: { label: 'Visión', explain: 'Se ve más lejos porque se amplía el campo de visión. Solo la dan los fondos de las reliquias' },
};

const unlockLevel: Record<'4' | '8', Term> = {
  '4': { label: 'Nivel 4', explain: 'La variante se abre cuando la sonda llega al nivel 4, y desde entonces el jugador puede empezar la incursión con ella' },
  '8': { label: 'Nivel 8', explain: 'La variante se abre cuando la sonda llega al nivel 8, y desde entonces el jugador puede empezar la incursión con ella' },
};

export const part: DescriptorPart = {
  fields: {
    // The weapons.
    weapons: {
      label: 'Armas',
      hint: 'Todas las armas que salen en las cartas de mejora, con sus evoluciones y las variantes de las armas iniciales',
      noun: 'arma',
    },
    'weapons[]': { label: 'Arma', hint: 'Un arma con su tipo, sus números en cada nivel y, si la tiene, su evolución o la sonda de la que es variante' },
    'weapons[].id': {
      label: 'Identificador',
      hint: 'Nombre interno único en minúsculas, números y guiones; las sondas, evoluciones y variantes lo usan para referirse a ella',
      section: 'Identidad',
    },
    'weapons[].name': { label: 'Nombre', hint: 'Cómo se llama el arma en las cartas de mejora, el hangar y el resumen de la incursión', section: 'Identidad' },
    'weapons[].kind': {
      label: 'Tipo de arma',
      hint: 'Cómo se comporta en la incursión y qué significa cada número de sus niveles; una evolución o variante es del mismo tipo que su base',
      vocab: 'weaponKind',
      section: 'Identidad',
    },
    'weapons[].icon': {
      label: 'Icono',
      hint: 'El dibujo de su carta y de la barra de armas; tiene que ser uno de los iconos que ya existen en el juego',
      section: 'Identidad',
      advanced: true,
    },
    'weapons[].description': { label: 'Descripción', hint: 'La frase que lee el jugador en la carta de mejora', section: 'Identidad' },
    'weapons[].element': {
      label: 'Elemento',
      hint: 'El efecto elemental que lleva cada golpe del arma, como quemar o ralentizar; vacío, ninguno',
      vocab: 'element',
      section: 'Combate',
    },
    'weapons[].special': {
      label: 'Rasgo especial',
      hint: 'Un extra que suelen llevar las evoluciones y que cambia cómo golpea el arma; vacío, ninguno',
      vocab: 'special',
      section: 'Combate',
    },
    'weapons[].levels': {
      label: 'Niveles',
      hint: 'Los números del arma en cada nivel, que sube al elegir su carta; una evolución tiene solo uno',
      items: level,
      noun: 'nivel',
      section: 'Niveles',
    },
    'weapons[].levels[]': { label: 'Nivel', hint: 'Lo que hace el arma en este nivel; los números que su tipo no usa se dejan a cero', section: 'Niveles' },
    'weapons[].levels[].damage': {
      label: 'Daño',
      hint: 'Lo que quita cada golpe, antes de sumar el daño de la sonda, los críticos y los elementos',
      section: 'Niveles',
    },
    'weapons[].levels[].cooldown': {
      label: 'Recarga',
      hint: 'Tiempo entre dos disparos o despliegues; la estadística de recarga lo acorta y los orbes y faros, que no paran, no lo usan',
      unit: 'seconds',
      section: 'Niveles',
    },
    'weapons[].levels[].count': {
      label: 'Cantidad',
      hint: 'Cuántos proyectiles, orbes, drones, marcas o torretas pone a la vez; en el mortero, las bombitas en que se divide',
      section: 'Niveles',
    },
    'weapons[].levels[].pierce': {
      label: 'Perforación',
      hint: 'A cuántos enemigos más atraviesa cada proyectil antes de desaparecer',
      section: 'Niveles',
    },
    'weapons[].levels[].speed': {
      label: 'Velocidad',
      hint: 'Lo rápido que vuelan sus proyectiles; en orbes y faros, lo rápido que giran a tu alrededor',
      section: 'Niveles',
    },
    'weapons[].levels[].area': {
      label: 'Área',
      hint: 'Radio de la onda, el charco, la explosión o el giro de los orbes; en el abanico, su apertura en grados, y en rayos y faros, su grosor',
      section: 'Niveles',
    },
    'weapons[].levels[].duration': {
      label: 'Duración',
      hint: 'Cuánto duran los charcos, rayos, abanicos, pozos, minas, torretas u hologramas que deja',
      unit: 'seconds',
      section: 'Niveles',
    },
    'weapons[].levels[].range': {
      label: 'Alcance',
      hint: 'Hasta dónde llega o busca enemigos; en minas, lo cerca que debe pasar uno para que estalle, y en el faro, lo largo del láser',
      section: 'Niveles',
    },
    'weapons[].levels[].bounces': { label: 'Rebotes', hint: 'Cuántas veces salta la descarga de un enemigo a otro', section: 'Niveles' },
    'weapons[].levels[].knockback': {
      label: 'Empuje',
      hint: 'Cuánto aparta cada golpe a los enemigos; en pozos, lo fuerte que atraen, y en el arpón, lo rápido que arrastra',
      section: 'Niveles',
    },
    'weapons[].levels[].interval': {
      label: 'Intervalo',
      hint: 'Tiempo entre dos golpes de una zona, orbe o rayo al mismo enemigo; en bombardeo y mortero es el aviso y en torretas su ritmo de disparo',
      unit: 'seconds',
      section: 'Niveles',
    },
    'weapons[].evolution': {
      label: 'Evolución',
      hint: 'Si la rellenas, esta arma es la evolución de otra: sale en las cartas cuando la base está al máximo y se cumple su requisito',
      section: 'Evolución',
    },
    'weapons[].evolution.from': {
      label: 'Evoluciona desde',
      hint: 'El arma base, del mismo tipo, a la que sustituye en su ranura al evolucionar',
      options: 'weapons',
      section: 'Evolución',
    },
    'weapons[].evolution.requires': {
      label: 'Requisito',
      hint: 'Lo que además pide la evolución para salir: una pasiva a cualquier nivel o una reliquia equipada con un elemento',
      section: 'Evolución',
    },
    'weapons[].evolution.requires.passive': {
      label: 'Pasiva que pide',
      hint: 'La sonda debe tener esta pasiva, a cualquier nivel, para que salga la evolución',
      options: 'passives',
      section: 'Evolución',
    },
    'weapons[].evolution.requires.element': {
      label: 'Elemento que pide',
      hint: 'La sonda debe llevar equipada una reliquia con este elemento para que salga la evolución',
      vocab: 'element',
      section: 'Evolución',
    },
    'weapons[].variant': {
      label: 'Variante de arma inicial',
      hint: 'Si la rellenas, es una variante del arma inicial de una sonda: se abre al subirla de nivel y nunca sale en las cartas',
      section: 'Variante',
    },
    'weapons[].variant.of': {
      label: 'Variante de',
      hint: 'El arma base, del mismo tipo, de la que es variante; evoluciona en la misma evolución que ella',
      options: 'weapons',
      section: 'Variante',
    },
    'weapons[].variant.unlockAt': {
      label: 'Se abre en el nivel',
      hint: 'El nivel de la sonda desde el que el jugador puede empezar la incursión con esta variante',
      vocab: 'unlockLevel',
      section: 'Variante',
    },

    // The passives.
    passives: {
      label: 'Pasivas',
      hint: 'Las mejoras pasivas que salen en las cartas al subir de nivel en la incursión; cada una sube una estadística de la sonda',
      noun: 'pasiva',
    },
    'passives[]': { label: 'Pasiva', hint: 'Una mejora pasiva con la estadística que sube y lo que suma en cada nivel' },
    'passives[].id': {
      label: 'Identificador',
      hint: 'Nombre interno único en minúsculas, números y guiones; las evoluciones lo usan para pedirla',
      section: 'Identidad',
    },
    'passives[].name': { label: 'Nombre', hint: 'Cómo se llama la pasiva en las cartas de mejora y en el resumen de la incursión', section: 'Identidad' },
    'passives[].icon': {
      label: 'Icono',
      hint: 'El dibujo de su carta y de la barra de pasivas; tiene que ser uno de los iconos que ya existen en el juego',
      section: 'Identidad',
      advanced: true,
    },
    'passives[].description': { label: 'Descripción', hint: 'La frase que lee el jugador en la carta de mejora', section: 'Identidad' },
    'passives[].stat': {
      label: 'Estadística que sube',
      hint: 'Qué mejora la pasiva en la sonda durante la incursión; varias fuentes de la misma estadística rinden menos cerca de su tope',
      vocab: 'stat',
      section: 'Efecto',
    },
    'passives[].levels': {
      label: 'Bono en cada nivel',
      hint: 'Lo que suma en total en cada nivel, en tanto por uno; proyectiles y perforación van en unidades y regeneración en vida por segundo',
      items: level,
      noun: 'nivel',
      section: 'Efecto',
    },
  },
  vocabs: { weaponKind, special, stat, unlockLevel },
};
