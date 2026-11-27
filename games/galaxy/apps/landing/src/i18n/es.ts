import { LEGAL_ES } from './legal/es';
import type { Dict } from './types';

// The landing in Spanish (plan «galaxysurvivor.es», PR 4; the owner approved mock-up B, «Viaje de la sonda», 2026-11-17).
// Rules (games/galaxy/AGENTS.md): «tú», no final full stop, no `· — →` in titles, and no number the admin can change
// (prices, odds, how many probes or sectors). «Hasta 4» and «seis rarezas» are code constants.

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «17 de noviembre de 2026» from an ISO date (no time zone involved). */
export const longDateEs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
};

export const ES: Dict = {
  meta: {
    title: 'Galaxy Survivor | Roguelite de hordas gratis en el navegador',
    description: 'Pilota tu sonda contra la Estática, sobrevive a hordas y Núcleos, rescata galaxias únicas y juega en grupo hasta cuatro. Gratis en el navegador',
    siteName: 'Galaxy Survivor',
    ogImageAlt: 'Galaxy Survivor: Sobrevive a la Estática, con una galaxia legendaria y una sonda',
    skip: 'Saltar al contenido',
  },
  nav: {
    label: 'Secciones',
    menu: 'Menú',
    items: [
      { href: '#incursion', label: 'Incursión' },
      { href: '#escaner', label: 'Galaxias' },
      { href: '#grupo', label: 'En grupo' },
      { href: '#comunidad', label: 'Comunidad' },
      { href: '#preguntas', label: 'Preguntas' },
    ],
  },
  cta: { play: 'Jugar gratis', login: 'Ya tengo cuenta', follow: 'Seguir a la sonda' },
  hero: {
    h1: ['Sobrevive a', 'la Estática'],
    lead: 'Un roguelite de hordas gratis en tu navegador',
  },
  clips: {
    lobby: 'El hangar del juego, con la sonda elegida y el mapa de sectores',
    horde: 'Una sonda resiste a cientos de enemigos en una incursión',
    boss: 'Combate contra el Núcleo de la Estática La Anémona Rey',
    extract: 'La sonda llega a la zona de extracción con el botín',
    collection: 'La colección de galaxias de un jugador',
    coop: 'Cuatro sondas juegan juntas una incursión en grupo',
  },
  hangar: {
    kicker: 'Hangar',
    title: 'Elige tu sonda',
    text: 'Cada sonda tiene su arma de salida y su estilo. Elige una, elige sector y despega',
    points: ['Sondas que se desbloquean jugando', 'Skins para darle tu toque', 'Sectores cada vez más duros'],
  },
  run: {
    kicker: 'Incursión',
    title: 'Tu sonda dispara sola',
    text: 'Tú la mueves y esquivas. Ella apunta y dispara a todo lo que la Estática le echa encima. Cientos de enemigos a la vez',
  },
  levelUp: {
    kicker: 'Sube de nivel',
    title: 'Sube de nivel y elige',
    text: 'Cada nivel te ofrece mejoras. Combínalas y tus armas evolucionan. No hay dos partidas iguales',
    cards: [
      { tag: 'Nueva', name: 'Arco voltaico', text: 'Una descarga que salta de enemigo en enemigo' },
      { tag: 'Variante', name: 'Rayo prismático', text: 'Cambia de elemento a cada golpe' },
      { tag: 'Mejora', name: 'Dron centinela', text: 'Drones que te siguen y disparan por su cuenta' },
    ],
  },
  boss: {
    kicker: 'Núcleo de la Estática',
    title: 'Derrota al Núcleo',
    text: 'Cada sector esconde un jefe con fases y ataques propios. Tumbarlo abre el camino al siguiente',
    name: 'La Anémona Rey',
    health: 'Vida del Núcleo',
  },
  extract: {
    kicker: 'Extracción',
    title: 'Vuelve con el botín',
    text: 'Llega a la zona de extracción antes de caer. Lo que llevas encima solo cuenta si vuelves a casa',
  },
  station: {
    kicker: 'Tu estación',
    title: 'Reconstruye tu estación',
    text: 'Llegas a una estación medio muerta. Lo que traes de cada incursión repara sus salas, y cada sala te hace más fuerte en la siguiente salida',
    rooms: ['Escáner', 'Hangar', 'Laboratorio', 'Refinería', 'Planetario', 'Antena'],
  },
  scanner: {
    kicker: 'Escáner profundo',
    title: 'Rescata galaxias únicas',
    text: 'Cada escaneo transcribe una galaxia que nunca ha existido. Seis rarezas, y cuanto más rara, más brilla',
    tiers: ['Común', 'Poco común', 'Rara', 'Épica', 'Legendaria', 'Mítica'],
    count: '18 trillones',
    countText: 'de diseños posibles. La tuya no la tiene nadie más',
    cardTier: { rare: 'Rara', epic: 'Épica', legendary: 'Legendaria', uncommon: 'Poco común', mythic: 'Mítica' },
    level: 'Nv 1',
  },
  relics: {
    kicker: 'Reliquias',
    title: 'Equípalas y colecciónalas',
    text: 'Tus galaxias son reliquias con poderes para la incursión. Combínalas, fusiónalas y mira cada una en 3D',
    points: ['Poderes según su forma, su rareza y sus fenómenos', 'Fusiona galaxias para subir de nivel tus reliquias', 'Véndelas o cámbialas en el mercado'],
  },
  group: {
    kicker: 'Sala de cuatro',
    title: 'Mejor en grupo',
    text: 'Crea una sala, pasa el código y salid juntos. Hasta cuatro sondas en la misma incursión',
    server: 'Servidor en España',
  },
  community: {
    kicker: 'Comunidad',
    title: 'Nunca juegas solo',
    text: 'Un cielo compartido con otros operadores del ECN, que cambia cada semana',
    tiles: [
      { title: 'Clanes', text: 'Únete a uno, súbelo de nivel y luce su emblema', alt: 'Banderas y emblemas de clanes con sus sondas' },
      { title: 'Mercado', text: 'Compra y vende galaxias con otros jugadores', alt: 'Galaxias a la venta en el mercado' },
      { title: 'Temporadas', text: 'Una ruta de premios nueva cada temporada', alt: 'El podio de una temporada' },
      { title: 'Torneos', text: 'Compite por la mejor marca de la semana', alt: 'El trofeo del torneo entre dos sondas' },
      { title: 'Eventos', text: 'Escáneres especiales y galaxias destacadas por tiempo limitado', alt: 'Un escáner de evento con su galaxia destacada' },
    ],
  },
  lore: {
    kicker: 'Transmisión entrante',
    title: 'La Estática no descansa',
    who: 'PERKINS, IA de la estación',
    lines: [
      'Una señal está sobrescribiendo la Nebulosa. No destruye las galaxias: las convierte en ruido que muerde y se copia a sí mismo',
      'El ECN descubrió que lo que está transcrito a braille no se puede corromper. Por eso existimos',
      'Tú eres el operador de esta estación. La sonda está lista. Rescata lo que puedas',
    ],
  },
  news: {
    kicker: 'Novedades',
    title: 'Un juego vivo',
    text: 'Cada semana llegan mejoras, contenido y eventos',
    version: (version, date) => `Versión ${version}, ${longDateEs(date)}`,
  },
  faq: {
    kicker: 'Preguntas frecuentes',
    title: 'Antes de despegar',
    items: [
      { q: '¿Es gratis?', a: 'Sí. Puedes jugar todo el juego sin pagar. La tienda solo vende extras opcionales' },
      { q: '¿Tengo que descargar algo?', a: 'No. Se juega en el navegador del ordenador. Si quieres, puedes instalarlo como app en Windows desde Chrome, Edge, Brave o Firefox' },
      { q: '¿Se puede jugar en el móvil?', a: 'Todavía no. Necesitas un ordenador con teclado y ratón' },
      { q: '¿Puedo jugar con mis amigos?', a: 'Sí. Crea una sala, pasa el código y jugad juntos hasta cuatro' },
      { q: '¿Necesito un correo para registrarme?', a: 'No. Solo eliges un nombre y una contraseña' },
    ],
  },
  final: {
    title: 'Tu sonda está lista',
    text: 'Crea tu cuenta en un minuto, solo con un nombre y una contraseña',
    note: 'Se juega en ordenador con teclado y ratón',
  },
  mobile: {
    badge: 'Solo en ordenador',
    title: 'Se juega en ordenador',
    text: 'Galaxy Survivor es un juego de acción para teclado y ratón. Guárdate el enlace y juega desde tu ordenador',
    share: 'Compartir el enlace',
    copy: 'Copiar el enlace',
    copied: 'Enlace copiado',
    close: 'Cerrar',
    shareText: 'Sobrevive a la Estática en Galaxy Survivor, gratis en el navegador',
  },
  footer: {
    tagline: 'Un juego de GALAXY SURVIVOR',
    game: 'El juego',
    community: 'Comunidad',
    legal: 'Legal',
    news: 'Novedades',
    faq: 'Preguntas frecuentes',
    discord: 'Discord',
  },
  notFound: {
    title: 'Página no encontrada | Galaxy Survivor',
    description: 'Esta zona del cielo está vacía. Vuelve a la portada de Galaxy Survivor, el roguelite de hordas gratis en el navegador',
    h1: 'Esta zona del cielo está vacía',
    text: 'La página que buscas no existe o se la ha comido la Estática',
    back: 'Volver a la portada',
  },
  moved: {
    title: 'Galaxy Survivor se ha mudado',
    text: 'Ahora vivimos en galaxysurvivor.es. Tu cuenta, tus galaxias y tu progreso siguen intactos: solo tienes que volver a entrar',
    button: 'Ir a galaxysurvivor.es',
    note: 'Guarda la dirección nueva en tus marcadores. Desde allí también puedes instalar el juego como app',
  },
  legal: {
    home: 'Inicio',
    crumbs: 'Ruta de navegación',
    updated: (date) => `Última actualización: ${longDateEs(date)}`,
    pages: LEGAL_ES,
  },
};
