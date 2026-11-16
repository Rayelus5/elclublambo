import type { DescriptorPart } from './types';

// Descriptors of the run content (the content editor, 2026-11-16, P4). See types.ts for the rules of the texts.
// Fauna: the enemies (systems/enemies.ts, combat.ts) and the elites any of them can turn into.

export const part: DescriptorPart = {
  fields: {
    // The enemies.
    enemies: { label: 'Enemigos', noun: 'enemigo', hint: 'Todas las especies de la fauna; cada sector elige cuáles salen y con qué frecuencia' },
    'enemies[]': { label: 'Enemigo', hint: 'Una especie de la fauna con su vida, su daño y su forma de moverse y atacar' },
    'enemies[].id': {
      label: 'Identificador',
      section: 'Identidad',
      hint: 'Nombre interno que usan los sectores, los Núcleos y el Códice; no lo cambies en un enemigo ya publicado',
    },
    'enemies[].name': { label: 'Nombre', section: 'Identidad', hint: 'Cómo se llama en el juego y en el bestiario del Códice' },
    'enemies[].lore': {
      label: 'Texto del bestiario',
      section: 'Textos',
      hint: 'Lo que cuenta de él su entrada del Códice; vacío, el texto de siempre del juego (y una especie nueva sin texto no tiene entrada)',
    },
    'enemies[].family': {
      label: 'Familia',
      section: 'Identidad',
      vocab: 'enemyFamily',
      hint: 'Qué clase de criatura es, para ordenar la fauna; no cambia cómo se mueve ni ataca, eso lo decide su comportamiento',
    },
    'enemies[].sprite': {
      label: 'Dibujo',
      section: 'Identidad',
      advanced: true,
      hint: 'El dibujo con el que sale en la arena; tiene que existir en el juego y uno nuevo necesita a un programador',
    },
    'enemies[].hp': { label: 'Vida', section: 'Vida y daño', hint: 'Su vida al empezar la incursión; crece con los minutos, la capa, el sector y el nivel del equipo' },
    'enemies[].damage': { label: 'Daño al tocar', section: 'Vida y daño', hint: 'Lo que quita a la sonda al chocar con ella; crece con los minutos, la capa y el sector' },
    'enemies[].xp': { label: 'Experiencia', section: 'Vida y daño', hint: 'La experiencia que suelta al morir, la que sube de nivel a la sonda durante la incursión' },
    'enemies[].speed': {
      label: 'Velocidad',
      section: 'Movimiento',
      hint: 'A qué velocidad anda, en unidades por segundo como las sondas; sus embestidas y picados tienen la suya',
    },
    'enemies[].radius': { label: 'Tamaño', section: 'Movimiento', hint: 'El radio de su cuerpo: más grande es más fácil de acertar, pero toca antes a la sonda' },
    'enemies[].behavior': {
      label: 'Comportamiento',
      section: 'Comportamiento',
      hint: 'Cómo se mueve y ataca; cada tipo de comportamiento trae sus propios ajustes',
    },
    'enemies[].behavior.kind': {
      label: 'Tipo de comportamiento',
      vocab: 'behavior',
      hint: 'Su forma de pelear; un comportamiento nuevo necesita a un programador',
    },
    'enemies[].behavior.range': { label: 'Alcance', hint: 'A qué distancia de la sonda empieza su ataque' },
    'enemies[].behavior<charge>.range': { label: 'Distancia para embestir', hint: 'A qué distancia de la sonda se para y prepara la embestida' },
    'enemies[].behavior<shooter>.range': {
      label: 'Distancia de tiro',
      hint: 'Desde qué distancia dispara; se mantiene cerca de ella y retrocede si la sonda se le acerca demasiado',
    },
    'enemies[].behavior<support>.range': { label: 'Alcance del apoyo', hint: 'Hasta qué distancia llega su curación o su escudo a los demás enemigos' },
    'enemies[].behavior<blink>.range': { label: 'Distancia para saltar', hint: 'A qué distancia de la sonda marca el punto al que va a saltar' },
    'enemies[].behavior<lancer>.range': {
      label: 'Distancia de tiro',
      hint: 'Desde qué distancia apunta; se mantiene cerca de ella y retrocede si la sonda se le acerca demasiado',
    },
    'enemies[].behavior.windup': {
      label: 'Aviso antes de atacar',
      unit: 'seconds',
      hint: 'Cuánto dura el aviso en pantalla antes del ataque; más tiempo lo hace más fácil de esquivar',
    },
    'enemies[].behavior.dashSpeed': { label: 'Velocidad de la embestida', hint: 'A qué velocidad sale disparado en la embestida, en unidades por segundo' },
    'enemies[].behavior.dashTime': { label: 'Duración de la embestida', unit: 'seconds', hint: 'Cuánto dura la embestida; con la velocidad, marca lo lejos que llega' },
    'enemies[].behavior.cooldown': { label: 'Pausa entre ataques', unit: 'seconds', hint: 'Cuánto descansa después de cada ataque antes de poder repetirlo' },
    'enemies[].behavior<summoner>.cooldown': { label: 'Pausa entre invocaciones', unit: 'seconds', hint: 'Cada cuánto tiempo invoca un grupo nuevo' },
    'enemies[].behavior<support>.cooldown': { label: 'Pausa entre apoyos', unit: 'seconds', hint: 'Cada cuánto tiempo cura o escuda a los suyos' },
    'enemies[].behavior.count': { label: 'Cuántos', hint: 'Cuántas balas dispara en cada ráfaga o cuántos enemigos invoca cada vez' },
    'enemies[].behavior<shooter>.count': { label: 'Balas por ráfaga', hint: 'Cuántas balas dispara a la vez, repartidas en abanico' },
    'enemies[].behavior<summoner>.count': { label: 'Enemigos por invocación', hint: 'Cuántos enemigos hace aparecer a su alrededor cada vez' },
    'enemies[].behavior.spread': { label: 'Separación entre balas', hint: 'Los grados entre una bala y la siguiente del abanico; más separación deja más hueco para colarse' },
    'enemies[].behavior.bulletSpeed': { label: 'Velocidad de las balas', hint: 'A qué velocidad vuelan sus balas, en unidades por segundo' },
    'enemies[].behavior.bulletDamage': { label: 'Daño de cada bala', hint: 'Lo que quita cada bala que alcanza a la sonda; crece con los minutos y la capa como su daño' },
    'enemies[].behavior.arc': { label: 'Ancho del blindaje', hint: 'Los grados de su frente que cubre la coraza; los golpes que llegan por ahí hacen menos daño' },
    'enemies[].behavior.reduction': { label: 'Daño que frena el blindaje', unit: 'percent', hint: 'Parte del daño que se quita a los golpes que le llegan de frente' },
    'enemies[].behavior.turnRate': {
      label: 'Velocidad de giro',
      hint: 'Los grados por segundo que gira para encarar a la sonda; cuanto más lento, más fácil rodearlo y darle por detrás',
    },
    'enemies[].behavior.weakTo': {
      label: 'Elemento débil',
      vocab: 'element',
      hint: 'El elemento que atraviesa su blindaje y le hace el daño entero aunque le dé de frente; vacío si no tiene',
    },
    'enemies[].behavior.minion': { label: 'Enemigo que invoca', options: 'enemies', hint: 'La especie que hace aparecer, con la fuerza que toque en ese momento de la incursión' },
    'enemies[].behavior.radius': { label: 'Distancia de la órbita', hint: 'A qué distancia de la sonda da vueltas a su alrededor' },
    'enemies[].behavior.turn': { label: 'Velocidad al orbitar', hint: 'Los grados por segundo que avanza en su vuelta alrededor de la sonda' },
    'enemies[].behavior.every': { label: 'Pausa entre picados', unit: 'seconds', hint: 'Cuánto tiempo orbita antes de poder lanzarse otra vez contra la sonda' },
    'enemies[].behavior.diveSpeed': { label: 'Velocidad del picado', hint: 'A qué velocidad se lanza en recta hacia la sonda, en unidades por segundo' },
    'enemies[].behavior.diveTime': { label: 'Duración del picado', unit: 'seconds', hint: 'Cuánto dura cada picado; con la velocidad, marca lo lejos que llega' },
    'enemies[].behavior.effect': { label: 'Qué da a los suyos', vocab: 'supportEffect', hint: 'Si cura a los enemigos cercanos o les pone un escudo' },
    'enemies[].behavior.amount': {
      label: 'Cuánto cura o escuda',
      unit: 'percent',
      hint: 'Parte de la vida máxima de cada enemigo cercano que cura o que le da en escudo cada vez',
    },
    'enemies[].behavior.keep': { label: 'Distancia que guarda', hint: 'A qué distancia de la sonda se queda, lejos de sus armas, mientras apoya a los demás' },
    'enemies[].behavior.offset': {
      label: 'Distancia tras la sonda',
      hint: 'Cuánto por detrás de la sonda marca el punto del salto; se esquiva moviéndose, no quedándose quieto',
    },
    'enemies[].split': {
      label: 'Se parte al morir',
      section: 'Al morir',
      hint: 'Si lo tiene, al morir deja en su sitio varios enemigos de otra especie; vacío si no se parte',
    },
    'enemies[].split.into': {
      label: 'Se parte en',
      options: 'enemies',
      hint: 'La especie que sale al partirse, con la fuerza que toque en ese momento; mejor una pequeña que no se parta a su vez',
    },
    'enemies[].split.count': { label: 'Cuántos salen', hint: 'Cuántos enemigos deja al morir' },

    // The elites.
    elites: {
      label: 'Élites',
      noun: 'élite',
      hint: 'Las versiones reforzadas en que puede salir cualquier enemigo; lo que ganan en vida, tamaño y botín lo marca cada sector',
    },
    'elites[]': { label: 'Élite', hint: 'Un tipo de élite con lo que añade al enemigo que sale así' },
    'elites[].id': {
      label: 'Tipo de élite',
      section: 'Identidad',
      vocab: 'eliteId',
      hint: 'Lo que la hace especial; los tipos son fijos y uno nuevo necesita a un programador',
    },
    'elites[].name': { label: 'Nombre', section: 'Identidad', hint: 'Cómo se llama en el juego' },
    'elites[].shield': {
      label: 'Escudo',
      section: 'Efecto',
      unit: 'factor',
      hint: 'Escudo que lleva además de su vida, en veces su vida; hay que romperlo antes de herirla',
    },
    'elites[].speed': { label: 'Velocidad', section: 'Efecto', unit: 'factor', hint: 'Multiplica la velocidad de la especie que sale como esta élite' },
    'elites[].explode': {
      label: 'Explosión al morir',
      section: 'Efecto',
      hint: 'Solo la usa la élite inestable: su cuerpo avisa al morir y estalla poco después contra las sondas cercanas',
    },
    'elites[].explode.radius': { label: 'Radio de la explosión', hint: 'Hasta qué distancia alcanza la explosión' },
    'elites[].explode.damage': { label: 'Daño de la explosión', hint: 'Lo que quita a cada sonda que pille; crece con los minutos y la capa como el de su especie' },
    'elites[].explode.delay': { label: 'Aviso antes de estallar', unit: 'seconds', hint: 'Cuánto tarda en estallar desde que muere, con el aviso en pantalla' },
    'elites[].explode.keep': {
      label: 'Vida que siempre deja',
      unit: 'percent',
      hint: 'Parte de la vida que tenía la sonda que la explosión le deja siempre, para que hiera pero nunca mate por sí sola',
    },
  },
  vocabs: {
    behavior: {
      chase: { label: 'Perseguir', explain: 'Va directo a por la sonda sin parar y hace daño al tocarla; no tiene ataques propios' },
      charge: {
        label: 'Embestida',
        explain: 'Se acerca, se para marcando una línea y embiste en recta a gran velocidad, y luego descansa; se esquiva saliendo de la línea en cuanto se para',
      },
      shooter: { label: 'Tirador', explain: 'Se queda a distancia y dispara ráfagas de balas en abanico hacia la sonda; si la sonda se acerca, retrocede' },
      armored: {
        label: 'Blindado',
        explain: 'Su frente blindado frena el daño de los golpes que le llegan de cara y gira despacio; por detrás, corroído o con su elemento débil recibe el daño entero',
      },
      summoner: { label: 'Invocador', explain: 'Persigue a la sonda y cada cierto tiempo hace aparecer a su alrededor un grupo de otra especie' },
      orbit: { label: 'Órbita', explain: 'Da vueltas alrededor de la sonda a cierta distancia y cada cierto tiempo se lanza en picado contra ella' },
      support: {
        label: 'Apoyo',
        explain: 'Se queda lejos de la sonda y cada cierto tiempo cura o escuda a los enemigos que tiene cerca; a los Núcleos no les llega su ayuda',
      },
      blink: { label: 'Salto', explain: 'Marca un punto detrás de la sonda, espera el aviso y se teletransporta allí de golpe; luego descansa' },
      lancer: { label: 'Lancero', explain: 'Se queda a distancia, marca una línea hacia la sonda y, tras el aviso, dispara por ella una sola bala muy rápida' },
    },
    enemyFamily: {
      swarm: { label: 'Enjambre', explain: 'Pequeños, rápidos y frágiles, que llegan en grupos grandes' },
      charger: { label: 'Embestidor', explain: 'Se lanzan contra la sonda en embestidas' },
      shooter: { label: 'Tirador', explain: 'Atacan desde lejos con balas' },
      splitter: { label: 'Divisible', explain: 'Al morir se parten en otros más pequeños' },
      armored: { label: 'Acorazado', explain: 'Lentos y resistentes, con una coraza que frena los golpes' },
      healer: { label: 'Sanador', explain: 'Curan o protegen a los demás enemigos' },
      summoner: { label: 'Invocador', explain: 'Hacen aparecer a otros enemigos' },
    },
    eliteId: {
      shielded: { label: 'Blindada', explain: 'Lleva un escudo encima de su vida que hay que romper antes de herirla' },
      swift: { label: 'Veloz', explain: 'Se mueve más deprisa que los de su especie' },
      volatile: {
        label: 'Inestable',
        explain: 'Al morir su cuerpo avisa y estalla poco después; la explosión hiere a las sondas cercanas pero nunca las mata por sí sola',
      },
    },
    supportEffect: {
      heal: { label: 'Curar', explain: 'Devuelve vida a los enemigos cercanos, sin pasar de su vida máxima' },
      shield: { label: 'Escudar', explain: 'Da a los enemigos cercanos un escudo que se gasta antes que la vida, como mucho igual a su vida máxima' },
    },
  },
};
