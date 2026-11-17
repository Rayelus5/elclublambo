import { describe, expect, test } from 'vitest';
import { GAME_TITLE, routeTitle, SCREEN_TITLES, titleFor } from '../src';

// The title of each screen (galaxysurvivor.es plan, PR 2): the tab, the installed app's window and the link previews
// say where you are. The web sets it on every route change and the server writes it into the shell it sends.

describe('el título de cada pantalla', () => {
  test('la pantalla de título lleva solo el nombre del juego', () => {
    expect(titleFor('/')).toBe('Galaxy Survivor');
    expect(titleFor('')).toBe('Galaxy Survivor');
    expect(GAME_TITLE).toBe('Galaxy Survivor');
  });

  test('cada pantalla lleva su nombre delante del juego', () => {
    expect(titleFor('/escaner')).toBe('Escáner profundo | Galaxy Survivor');
    expect(titleFor('/incursion')).toBe('Incursión | Galaxy Survivor');
    expect(titleFor('/crear-cuenta')).toBe('Crear cuenta | Galaxy Survivor');
    expect(titleFor('/notas-de-version')).toBe('Notas de versión | Galaxy Survivor');
  });

  test('las rutas con parámetros usan el nombre de su pantalla, sin el parámetro', () => {
    expect(titleFor('/perfil/rayelus')).toBe('Perfil | Galaxy Survivor');
    expect(titleFor('/perfil/rayelus/coleccion')).toBe('Colección de un jugador | Galaxy Survivor');
    expect(titleFor('/coleccion/123')).toBe('Colección | Galaxy Survivor');
    expect(titleFor('/clanes/ABC')).toBe('Clan | Galaxy Survivor');
    expect(titleFor('/planetario/rayelus')).toBe('Planetario | Galaxy Survivor');
  });

  test('toda la administración es una sola pantalla', () => {
    for (const path of ['/admin', '/admin/', '/admin/jugadores/rayelus', '/admin/moderacion/directo/solo/abc']) {
      expect(titleFor(path), path).toBe('Administración | Galaxy Survivor');
    }
  });

  test('da igual la barra final, la query, el hash o las mayúsculas', () => {
    expect(titleFor('/escaner/')).toBe('Escáner profundo | Galaxy Survivor');
    expect(titleFor('/crear-cuenta?ref=ABCD')).toBe('Crear cuenta | Galaxy Survivor');
    expect(titleFor('/misiones?pestana=logros#x')).toBe('Misiones y logros | Galaxy Survivor');
    expect(titleFor('/Escaner')).toBe('Escáner profundo | Galaxy Survivor');
  });

  test('una ruta que no existe se queda con el título del juego', () => {
    for (const path of ['/nada', '/escaner/otra', '/perfil', '/perfil/a/b/c', '//evil.example']) {
      expect(routeTitle(path), path).toBeNull();
      expect(titleFor(path), path).toBe('Galaxy Survivor');
    }
  });

  test('ningún título lleva punto final ni símbolos prohibidos, y ningún patrón se repite', () => {
    const patterns = SCREEN_TITLES.map(([pattern]) => pattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const [pattern, screen] of SCREEN_TITLES) {
      expect(pattern.startsWith('/'), pattern).toBe(true);
      expect(screen ?? '', pattern).not.toMatch(/[.·—→:|]|\/\//);
    }
  });
});
