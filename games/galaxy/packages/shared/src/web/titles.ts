// The title of each screen (galaxysurvivor.es plan, PR 2; GDD §18.1): the browser tab, the installed app's window and
// the link previews say where the player is. The web sets document.title from it on every route change and the server
// writes it into the shell it sends, so both agree. Paths are the web's routes (apps/web/src/App.tsx), relative to the
// /galaxy basename; a web test fails when a route has no entry here.

/** The game's name: the title screen's whole title and every other title's suffix. */
export const GAME_TITLE = 'Galaxy Survivor';

/**
 * Each route pattern and its screen's name (null: the title screen, which is just the game's name). `:x` is any one
 * segment and a final `*` anything below, the administration included as a single screen.
 */
export const SCREEN_TITLES: readonly (readonly [pattern: string, screen: string | null])[] = [
  ['/', null],
  ['/entrar', 'Entrar'],
  ['/crear-cuenta', 'Crear cuenta'],
  ['/verificar', 'Verificación'],
  ['/recuperar', 'Recuperar la cuenta'],
  ['/sonda', 'Test de la sonda'],
  ['/incursion', 'Incursión'],
  ['/incursion/grupo', 'Incursión'],
  ['/incursion/sala', 'Incursión'],
  ['/escaner', 'Escáner profundo'],
  ['/estacion', 'Estación'],
  ['/laboratorio', 'Laboratorio'],
  ['/coleccion', 'Colección'],
  ['/coleccion/:id', 'Colección'],
  ['/catalogo', 'Catálogo ECN'],
  ['/taller', 'Taller de sondas'],
  ['/tienda', 'Tienda'],
  ['/planetario', 'Planetario'],
  ['/planetario/:username', 'Planetario'],
  ['/misiones', 'Misiones y logros'],
  ['/temporada', 'Temporada'],
  ['/trofeos', 'Trofeos'],
  ['/clasificacion', 'Clasificación'],
  ['/clanes', 'Clanes'],
  ['/clanes/:tag', 'Clan'],
  ['/mercado', 'Mercado'],
  ['/perfil/:username', 'Perfil'],
  ['/perfil/:username/coleccion', 'Colección de un jugador'],
  ['/codice', 'Códice'],
  ['/guia', 'Guía'],
  ['/ajustes', 'Ajustes'],
  ['/notas-de-version', 'Notas de versión'],
  ['/admin/*', 'Administración'],
];

const segmentsOf = (path: string) =>
  (path.split(/[?#]/)[0] ?? '')
    .toLowerCase()
    .split('/')
    .filter(Boolean);

function matches(pattern: string[], path: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p === '*' && i === pattern.length - 1) return true;
    const s = path[i];
    if (s === undefined || (!p.startsWith(':') && p !== s)) return false;
  }
  return pattern.length === path.length;
}

const COMPILED = SCREEN_TITLES.map(([pattern, screen]) => [segmentsOf(pattern), screen] as const);

/**
 * The title of the screen at `path` (a web path without /galaxy, its query and hash ignored, any case), or null when
 * no route matches it.
 */
export function routeTitle(path: string): string | null {
  const segments = segmentsOf(path);
  for (const [pattern, screen] of COMPILED) {
    if (matches(pattern, segments)) return screen ? `${screen} | ${GAME_TITLE}` : GAME_TITLE;
  }
  return null;
}

/** The title of the screen at `path`; an unknown path gets the game's name. */
export function titleFor(path: string): string {
  return routeTitle(path) ?? GAME_TITLE;
}
