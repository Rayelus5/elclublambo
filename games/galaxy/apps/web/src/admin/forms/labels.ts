import type { ConfigKey } from '@galaxy/shared';
import type { IconName } from '../../ui/Icon';

// What the config forms say (polish phase 4): the categories of the Configuración home, each key's name and purpose,
// each field's label, hint and unit by its path ("list[].goals[].reward.coins": [] is an item of a list, * the value of
// a named entry), and the Spanish names of the values a field can take. A field without its own label borrows the one
// of its last segment (COMMON), so the rewards, dates and ids of every list read the same.

export type Unit = 'percent' | 'factor' | 'hours' | 'days' | 'minutes' | 'seconds' | 'points';

export interface FieldInfo {
  label: string;
  hint?: string;
  unit?: Unit;
  /** The name of each item of a list or of each number of a fixed row («Común», «Nivel 2»…). */
  items?: readonly string[] | ((i: number) => string);
  /** The singular noun of a list's items («evento»), for «Añadir evento». */
  noun?: string;
  /** The options come from the live content. */
  options?: 'anomalies' | 'sectors' | 'probes';
  /** A list of words, one per line. */
  lines?: boolean;
}

export interface Category {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  keys: ConfigKey[];
  advanced?: boolean;
}

export const CATEGORIES: Category[] = [
  { id: 'season', title: 'Temporada', description: 'Fechas, puntos, anomalía, ruta y tienda de la temporada', icon: 'podium', keys: ['season', 'seasonRoute'] },
  { id: 'events', title: 'Eventos y multiplicadores', description: 'Metas por tiempo limitado y pagos dobles de fin de semana', icon: 'target', keys: ['events', 'boosts'] },
  { id: 'missions', title: 'Misiones y logros', description: 'Lo que sale cada día y cada semana, los logros y el álbum', icon: 'list', keys: ['missions', 'achievements', 'catalog'] },
  { id: 'gacha', title: 'Escáner', description: 'Probabilidades, garantías, precios y escáneres activos', icon: 'radar', keys: ['gacha'] },
  { id: 'social', title: 'Comunidad y mercado', description: 'Chat, clanes y compraventa entre jugadores', icon: 'chat', keys: ['chat', 'clans', 'market'] },
  { id: 'progress', title: 'Progreso', description: 'Niveles de cuenta, planetario y prestigio', icon: 'trophy', keys: ['account', 'planetarium', 'redshift'] },
  {
    id: 'advanced',
    title: 'Avanzado',
    description: 'Economía de las incursiones, contenido y límites técnicos. Cambia esto solo si sabes lo que hace',
    icon: 'gear',
    keys: ['runs', 'station', 'lab', 'probes', 'relics', 'galaxies', 'sectors', 'auth', 'content', 'features'],
    advanced: true,
  },
];

export const ADVANCED_KEYS = new Set<ConfigKey>(CATEGORIES.find((c) => c.advanced)!.keys);
/** Too large for a form: only its JSON. */
export const JSON_ONLY = new Set<ConfigKey>(['content']);

export const KEY_INFO: Record<ConfigKey, { title: string; description: string }> = {
  features: { title: 'Interruptores', description: 'Partes del juego que se pueden apagar' },
  auth: { title: 'Cuentas y sesiones', description: 'Duración de las sesiones y límites contra abusos' },
  gacha: { title: 'Escáner profundo', description: 'Probabilidades por rareza, garantías, precios y escáneres activos' },
  galaxies: { title: 'Galaxias', description: 'Polvo al desintegrar y recetas de fusión' },
  content: { title: 'Contenido de las incursiones', description: 'Sectores, enemigos, jefes, armas y mejoras' },
  runs: { title: 'Economía de las incursiones', description: 'Profundidad, muerte, rendimiento diario y topes de pago' },
  probes: { title: 'Sondas', description: 'Qué desbloquea cada sonda y lo que cuesta subirlas de nivel' },
  lab: { title: 'Laboratorio', description: 'El árbol de mejoras permanentes' },
  relics: { title: 'Reliquias', description: 'Niveles de reliquia, devolución y ranuras' },
  station: { title: 'Estación', description: 'Niveles de la refinería, la antena y el laboratorio' },
  account: { title: 'Nivel de cuenta', description: 'Experiencia por incursión y lo que pide cada nivel' },
  chat: { title: 'Chat', description: 'Quién escribe, cuánto y qué palabras se filtran' },
  market: { title: 'Mercado', description: 'Precios, comisión, límites diarios y avisos' },
  clans: { title: 'Clanes', description: 'Miembros, coste y requisitos' },
  season: { title: 'Temporada', description: 'Nombre, fechas, puntos, rangos, anomalía y acabado exclusivo' },
  planetarium: { title: 'Planetario', description: 'Pedestales, prestigio y su bonificación' },
  sectors: { title: 'Sectores', description: 'Qué abre cada sector y el sector de temporada' },
  missions: { title: 'Misiones', description: 'Las de cada día, cada semana y la temporada' },
  seasonRoute: { title: 'Ruta y tienda de temporada', description: 'Escalones de la ruta, tienda y premios del cierre' },
  redshift: { title: 'Corrimiento al rojo', description: 'El prestigio opcional: requisitos, rangos y bonificaciones' },
  events: { title: 'Eventos', description: 'Metas por tiempo limitado con sus premios' },
  catalog: { title: 'Catálogo', description: 'Premios por completar el álbum' },
  achievements: { title: 'Logros', description: 'Metas para siempre con títulos y marcos' },
  boosts: { title: 'Multiplicadores', description: 'Pagos multiplicados durante un tiempo' },
};

const TIER_NAMES = ['Común', 'Poco común', 'Rara', 'Épica', 'Legendaria'] as const;
const FINISH_NAMES = ['Normal', 'Holo', 'Prismático', 'Relieve braille', 'Corrupto'] as const;
const SEASON_TIER_NAMES = ['Bronce', 'Plata', 'Oro', 'Platino', 'Estelar'] as const;
const level = (from: number) => (i: number) => `Nivel ${i + from}`;

const reward = { label: 'Premio' };
const pity = (who: string): Record<string, FieldInfo> => ({
  [who]: { label: who === 'standard' ? 'Escáner estándar' : who === 'welcome' ? 'Escaneos de bienvenida' : 'Escáner de evento' },
  [`${who}.base`]: { label: 'Probabilidad de legendaria', unit: 'percent' },
  [`${who}.softStart`]: { label: 'La suerte sube desde el escaneo', hint: 'Contando desde la última legendaria' },
  [`${who}.softStep`]: { label: 'Cuánto sube por escaneo', unit: 'percent' },
  [`${who}.hard`]: { label: 'Legendaria segura en el escaneo' },
});
const pool = (p: string, title: string): Record<string, FieldInfo> => ({
  [p]: { label: title },
  [`${p}.count`]: { label: 'Cuántas salen', hint: 'Iguales para todos los jugadores' },
  [`${p}.pool`]: { label: 'Misiones posibles', noun: 'misión' },
});

export const FIELDS: Partial<Record<ConfigKey, Record<string, FieldInfo>>> = {
  features: {
    registrationOpen: { label: 'Registro abierto' },
    maintenance: { label: 'Mantenimiento', hint: 'Solo el equipo puede entrar' },
    gacha: { label: 'Escáner' },
    runs: { label: 'Incursiones' },
    market: { label: 'Mercado' },
    trades: { label: 'Trueques' },
    chat: { label: 'Chat' },
  },
  auth: {
    sessionDays: { label: 'Sesión de jugador', unit: 'days' },
    adminSessionHours: { label: 'Sesión de admin', unit: 'hours' },
    registerPerIpHour: { label: 'Registros por IP y hora' },
    loginPerIpTenMin: { label: 'Intentos de entrar por IP cada 10 min' },
    loginPerUserTenMin: { label: 'Intentos de entrar por cuenta cada 10 min' },
    totpPerAccountTenMin: { label: 'Códigos de admin por cuenta cada 10 min' },
    resetRedeemPerIpHour: { label: 'Códigos de recuperación por IP y hora' },
  },
  gacha: {
    tiers: { label: 'Rarezas' },
    'tiers.base': { label: 'Probabilidad de cada rareza', unit: 'percent', items: TIER_NAMES, hint: 'Deben sumar 100 %' },
    ...pity('standard'),
    ...pity('welcome'),
    'welcome.signals': { label: 'Señales de regalo al empezar' },
    ...pity('featured'),
    costs: { label: 'Precios' },
    'costs.coins': { label: 'Un escaneo con monedas' },
    'costs.coinsTen': { label: 'Diez escaneos con monedas' },
    'costs.signals': { label: 'Señales por escaneo' },
    dailyFree: { label: 'Escaneo gratis cada día' },
    finishes: { label: 'Probabilidad de cada acabado', unit: 'percent', items: FINISH_NAMES, hint: 'Deben sumar 100 %' },
    banners: { label: 'Escáneres', noun: 'escáner' },
    'banners[].kind': { label: 'Tipo' },
    'banners[].pityGroup': { label: 'Grupo de garantía', hint: 'Los escáneres del mismo grupo comparten la barra de garantía' },
    'banners[].currency': { label: 'Se paga con', hint: '«signal» son las señales normales; «signal:<evento>», las de un evento' },
    'banners[].featured': { label: 'Rasgo destacado' },
    'banners[].featured.trait': { label: 'Rasgo' },
    'banners[].featured.value': { label: 'Valor' },
  },
  galaxies: {
    disintegrate: { label: 'Desintegrar' },
    'disintegrate.tier': { label: 'Polvo por rareza', items: TIER_NAMES },
    'disintegrate.finish': { label: 'Multiplicador por acabado', unit: 'factor', items: FINISH_NAMES },
    fusion: { label: 'Fusión' },
    'fusion.count': { label: 'Galaxias por fusión' },
    'fusion.dust': { label: 'Polvo por fusión', items: TIER_NAMES.slice(0, 4), hint: 'Según la rareza que se fusiona' },
  },
  runs: {
    depth: { label: 'Profundidad' },
    'depth.table': { label: 'Multiplicador por capa', unit: 'factor', items: (i) => `Capa ${i + 1}` },
    'depth.step': { label: 'Lo que suma cada capa después', unit: 'factor' },
    deathShare: { label: 'Parte que se cobra al morir', unit: 'percent' },
    daily: { label: 'Rendimiento diario' },
    'daily.hours': { label: 'Horas de juego en que baja', unit: 'hours' },
    'daily.multipliers': { label: 'Pago en cada tramo', unit: 'percent', hint: 'Uno más que horas, y cada uno menor o igual que el anterior' },
    signalChancePerBoss: { label: 'Probabilidad de señal por Núcleo', unit: 'percent' },
    material: { label: 'Material' },
    'material.perLayer': { label: 'Por capa' },
    'material.perBoss': { label: 'Por Núcleo' },
    'material.perHundredKills': { label: 'Por cada 100 enemigos' },
    caps: { label: 'Topes contra trampas' },
    'caps.killsPerMinute': { label: 'Enemigos por minuto' },
    'caps.coinsPerKill': { label: 'Monedas por enemigo' },
    'caps.dustPerKill': { label: 'Polvo por enemigo' },
    'caps.bossCoins': { label: 'Monedas por Núcleo' },
    'caps.bossDust': { label: 'Polvo por Núcleo' },
    'caps.slackSeconds': { label: 'Margen', unit: 'seconds' },
    'caps.runCoins': { label: 'Monedas por incursión' },
    'caps.runDust': { label: 'Polvo por incursión' },
    'caps.runMaterial': { label: 'Material por incursión' },
    expireHours: { label: 'Una incursión sin terminar caduca a las', unit: 'hours' },
    startPerHour: { label: 'Incursiones por hora y cuenta' },
  },
  probes: {
    minRunSeconds: { label: 'Duración mínima para contar', unit: 'seconds' },
    starterUnlock: { label: 'Las otras sondas iniciales' },
    'starterUnlock.stat': { label: 'Qué cuenta' },
    unlocks: { label: 'Qué desbloquea cada sonda', options: 'probes' },
    levels: { label: 'Niveles de sonda' },
    'levels.perLevel': { label: 'Lo que suma cada nivel', unit: 'percent' },
    'levels.costs': { label: 'Coste de cada nivel', items: level(2) },
  },
  lab: {
    nodes: { label: 'Nodos', noun: 'nodo' },
    'nodes[].branch': { label: 'Rama' },
    'nodes[].effect': { label: 'Efecto' },
    'nodes[].effect.kind': { label: 'Tipo de efecto' },
    'nodes[].effect.stat': { label: 'Estadística que mejora' },
    'nodes[].effect.field': { label: 'Qué mejora' },
    'nodes[].effect.currency': { label: 'Moneda' },
    'nodes[].per': { label: 'Por nivel', unit: 'percent' },
    'nodes[].max': { label: 'Niveles' },
    'nodes[].requires': { label: 'Necesita el nodo', hint: 'Identificador; vacío si no necesita ninguno' },
    'nodes[].growth': { label: 'Crecimiento del coste por nivel', unit: 'factor' },
  },
  relics: {
    levels: { label: 'Polvo para cada nivel', items: level(2) },
    refund: { label: 'Devolución al fusionar o desintegrar', unit: 'percent' },
    slots: { label: 'Ranuras extra', items: (i) => `Ranura ${i + 3}` },
    'slots[].condition': { label: 'Se abre al llegar a' },
    'slots[].dust': { label: 'Polvo para abrirla' },
  },
  station: {
    refinery: { label: 'Refinería', items: level(1) },
    'refinery[].rate': { label: 'Material por hora' },
    'refinery[].queue': { label: 'Cola' },
    antenna: { label: 'Antena' },
    'antenna.capHours': { label: 'Se llena en', unit: 'hours' },
    'antenna.levels': { label: 'Niveles', items: level(1), hint: 'El coste del nivel 1 es la reparación' },
    'antenna.levels[].rate': { label: 'Señales por hora' },
    lab: { label: 'Laboratorio' },
    'lab.levels': { label: 'Reparación', items: () => 'Reparación' },
  },
  account: {
    xp: { label: 'Experiencia por incursión' },
    'xp.perMinute': { label: 'Por minuto' },
    'xp.perLayer': { label: 'Por capa' },
    'xp.perCore': { label: 'Por Núcleo' },
    'xp.extraction': { label: 'Por extraer' },
    'xp.capPerMinute': { label: 'Tope por minuto' },
    minRunSeconds: { label: 'Duración mínima para contar', unit: 'seconds' },
    levels: { label: 'Experiencia para cada nivel', items: level(2) },
  },
  chat: {
    minLevel: { label: 'Nivel para escribir' },
    perMinute: { label: 'Mensajes por minuto' },
    maxLength: { label: 'Caracteres por mensaje' },
    history: { label: 'Mensajes en el historial' },
    hideAfter: { label: 'Denuncias para ocultar un mensaje' },
    words: { label: 'Palabras filtradas', lines: true, hint: 'Una por línea' },
  },
  market: {
    minPrice: { label: 'Precio mínimo por rareza' },
    'minPrice.common': { label: 'Común' },
    'minPrice.uncommon': { label: 'Poco común' },
    'minPrice.rare': { label: 'Rara' },
    'minPrice.epic': { label: 'Épica' },
    'minPrice.legendary': { label: 'Legendaria' },
    maxPrice: { label: 'Precio máximo' },
    commission: { label: 'Comisión de cada venta', unit: 'percent' },
    days: { label: 'Un anuncio dura', unit: 'days' },
    perDay: { label: 'Límites por día' },
    'perDay.listings': { label: 'Anuncios' },
    'perDay.purchases': { label: 'Compras' },
    'perDay.trades': { label: 'Trueques propuestos' },
    minLevel: { label: 'Nivel para comerciar' },
    minAccountDays: { label: 'Antigüedad de la cuenta', unit: 'days' },
    alertMultiple: { label: 'Avisar si el precio multiplica el mínimo por', unit: 'factor' },
    sharedIpDays: { label: 'Avisar de IP compartida en los últimos', unit: 'days' },
    tradeDays: { label: 'Un trueque dura', unit: 'days' },
    openTrades: { label: 'Trueques abiertos por cuenta' },
    tradeAlertTierGap: { label: 'Avisar de trueques con rarezas separadas por', hint: 'Número de rarezas de diferencia' },
  },
  clans: {
    maxMembers: { label: 'Miembros como máximo' },
    createCost: { label: 'Coste de crear un clan' },
    minLevel: { label: 'Nivel para crear o unirse' },
    kickHours: { label: 'Espera tras una expulsión', unit: 'hours' },
  },
  season: {
    id: { label: 'Identificador', hint: 'Cambiarlo empieza una temporada nueva' },
    points: { label: 'Puntos por incursión' },
    'points.layer': { label: 'Por capa' },
    'points.core': { label: 'Por Núcleo' },
    'points.extraction': { label: 'Por extraer' },
    tiers: { label: 'Puntos de cada rango', items: SEASON_TIER_NAMES },
    top: { label: 'Filas de la clasificación' },
    capPerMinute: { label: 'Tope de puntos por minuto' },
    anomaly: { label: 'Anomalía', hint: 'Cambia todas las incursiones mientras dure la temporada', options: 'anomalies' },
    finish: { label: 'Acabado exclusivo' },
    finishChance: { label: 'Probabilidad del acabado exclusivo', unit: 'percent' },
  },
  planetarium: {
    slots: { label: 'Pedestales' },
    points: { label: 'Prestigio por galaxia expuesta' },
    'points.tiers': { label: 'Por rareza', items: TIER_NAMES },
    'points.finish': { label: 'Extra por acabado especial' },
    xpPerPoint: { label: 'Experiencia extra por punto', unit: 'percent' },
    cap: { label: 'Experiencia extra como máximo', unit: 'percent' },
    featured: { label: 'Planetarios destacados' },
  },
  sectors: {
    unlocks: { label: 'Qué abre cada sector', options: 'sectors' },
    'unlocks.*.sector': { label: 'En el sector', options: 'sectors' },
    season: { label: 'Sector de temporada', hint: 'Abierto a todos; vacío si no hay', options: 'sectors' },
  },
  missions: {
    ...pool('daily', 'Diarias'),
    ...pool('weekly', 'Semanales'),
    season: { label: 'De temporada', noun: 'misión' },
  },
  seasonRoute: {
    currency: { label: 'Moneda de temporada' },
    'currency.perPoint': { label: 'Se gana por punto' },
    'currency.dustRate': { label: 'Polvo por cada una al cerrar la temporada' },
    steps: { label: 'Escalones de la ruta', noun: 'escalón' },
    'steps[].at': { label: 'A los puntos', unit: 'points' },
    shop: { label: 'Tienda', noun: 'artículo' },
    'shop[].price': { label: 'Precio' },
    'shop[].limit': { label: 'Compras por jugador' },
    closing: { label: 'Premios del cierre' },
    'closing.tiers': { label: 'Por rango', items: SEASON_TIER_NAMES },
    'closing.podium': { label: 'Extra del podio' },
    'closing.podiumSize': { label: 'Puestos del podio' },
  },
  redshift: {
    minLevel: { label: 'Nivel de cuenta para empezar' },
    maxRank: { label: 'Rangos' },
    labLevels: { label: 'Niveles de laboratorio que pide cada rango', items: (i) => `Rango ${i + 1}` },
    bonus: { label: 'Bonificación por rango' },
    'bonus.xp': { label: 'Experiencia', unit: 'percent' },
    'bonus.luck': { label: 'Suerte', unit: 'percent' },
    titles: { label: 'Título de cada rango', lines: true, hint: 'Uno por línea, del primero al último' },
  },
  events: {
    list: { label: 'Eventos', noun: 'evento' },
    'list[].goals': { label: 'Metas', noun: 'meta' },
    'list[].goals[].scope': { label: 'Para' },
  },
  catalog: {
    rewards: { label: 'Premios del álbum', noun: 'premio' },
    'rewards[].percent': { label: 'Al completar el', unit: 'percent' },
  },
  achievements: {
    list: { label: 'Logros', noun: 'logro' },
    'list[].tier': { label: 'Categoría' },
  },
  boosts: {
    list: { label: 'Multiplicadores', noun: 'multiplicador' },
    'list[].currency': { label: 'Qué multiplica' },
    'list[].factor': { label: 'Por cuánto', unit: 'factor' },
  },
};

/** Labels by last segment, shared by every key. */
export const COMMON: Record<string, FieldInfo> = {
  id: { label: 'Identificador', hint: 'Interno: minúsculas, números y guiones' },
  name: { label: 'Nombre' },
  description: { label: 'Descripción' },
  startsAt: { label: 'Empieza' },
  endsAt: { label: 'Termina' },
  stat: { label: 'Qué cuenta' },
  target: { label: 'Objetivo' },
  value: { label: 'Cantidad' },
  reward,
  cost: { label: 'Coste' },
  condition: { label: 'Condición' },
  coins: { label: 'Monedas' },
  dust: { label: 'Polvo estelar' },
  signal: { label: 'Señales' },
  xp: { label: 'Experiencia' },
  points: { label: 'Puntos de temporada' },
  shards: { label: 'Moneda de temporada' },
  title: { label: 'Título', hint: 'Vacío: ninguno' },
  frame: { label: 'Marco' },
  eventSignals: { label: 'Señales del evento', hint: 'Sirven en su escáner de evento' },
  components: { label: 'Componentes' },
  material: { label: 'Material' },
  rate: { label: 'Ritmo' },
  minLevel: { label: 'Nivel mínimo' },
};

/** The Spanish names of the values a field can take. */
export const VALUES: Record<string, string> = {
  // What missions, achievements and unlocks count.
  runs: 'Incursiones jugadas',
  minutes: 'Minutos jugados',
  kills: 'Enemigos eliminados',
  bossKills: 'Núcleos derrotados',
  extractions: 'Extracciones',
  depth: 'Capa más profunda',
  maxDepth: 'Capa más profunda',
  pulls: 'Escaneos',
  legendaries: 'Legendarias conseguidas',
  fusions: 'Fusiones',
  disintegrations: 'Desintegraciones',
  components: 'Componentes refinados',
  // Currencies.
  coins: 'Monedas',
  dust: 'Polvo estelar',
  material: 'Material',
  signal: 'Señales',
  // Tiers and frames.
  bronze: 'Bronce',
  silver: 'Plata',
  gold: 'Oro',
  nebula: 'Nebulosa',
  abyss: 'Abismo',
  crown: 'Corona',
  // Events, banners and the lab.
  personal: 'Cada jugador',
  clan: 'Todo el clan',
  standard: 'Estándar',
  event: 'De evento',
  probe: 'Sonda',
  relics: 'Reliquias',
  station: 'Estación',
  extraction: 'Extracción',
  stat: 'Estadística',
  payout: 'Pago de las incursiones',
  refinery: 'Refinería',
  antenna: 'Antena',
  disintegrate: 'Desintegrar',
  fusion: 'Fusión',
  rate: 'Ritmo',
  queue: 'Cola',
  rift: 'Fisura',
  // Galaxy traits.
  galaxy_type: 'Tipo de galaxia',
  arms: 'Brazos',
  size: 'Tamaño',
  inclination: 'Inclinación',
  core: 'Núcleo',
  star_density: 'Densidad de estrellas',
  palette: 'Paleta',
  background: 'Fondo',
  phenomenon: 'Fenómeno',
  // Probe stats.
  maxHp: 'Vida máxima',
  speed: 'Velocidad',
  cooldown: 'Recarga',
  damage: 'Daño',
  area: 'Área',
  pickup: 'Alcance de recogida',
  projectiles: 'Proyectiles',
  regen: 'Regeneración',
  armor: 'Blindaje',
  crit: 'Crítico',
  critDamage: 'Daño crítico',
  xp: 'Experiencia',
  luck: 'Suerte',
  lifesteal: 'Robo de vida',
  velocity: 'Velocidad de proyectil',
  duration: 'Duración',
  pierce: 'Perforación',
  elemental: 'Potencia elemental',
  barrier: 'Barrera',
  curse: 'Maldición',
};

export const valueName = (v: unknown): string => (typeof v === 'string' ? (VALUES[v] ?? v) : String(v));

/** «maxLength» → «Max length»: the last resort for a field nobody named. */
function humanize(segment: string): string {
  const words = segment.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What a field at `pattern` of `key` says. */
export function fieldInfo(key: ConfigKey, pattern: string): FieldInfo {
  const own = FIELDS[key]?.[pattern];
  if (own) return own;
  const last = pattern.replace(/\[\]$/, '').split(/[.[\]*]+/).filter(Boolean).at(-1) ?? pattern;
  return COMMON[last] ?? { label: humanize(last) };
}

/** The name of item `i` of a list or row. */
export function itemName(info: FieldInfo, i: number): string | null {
  if (!info.items) return null;
  return typeof info.items === 'function' ? info.items(i) : (info.items[i] ?? null);
}

export const UNIT_SUFFIX: Record<Unit, string> = { percent: '%', factor: '×', hours: 'h', days: 'días', minutes: 'min', seconds: 's', points: 'puntos' };
