import { expect, test } from 'vitest';
import { musicLibrary } from '../src/audio/music/files';

// The owner's own music (plan «banda sonora», part A; the owner: «si en un futuro me gustaría introducir música creada
// por mí, espero que sea sencillo»): a file named as a piece, in its style's folder, takes that piece's place — whole,
// or as layers (-capa0…-capa3) that follow the intensity. Unknown names and folders are left out; files in «propia»
// make the «Mi música» style appear.

const P = '../../assets/audio/musica';
const found = {
  [`${P}/ambiente/menu-deriva.ogg`]: '/galaxy/assets/menu-deriva-1a2b.ogg',
  [`${P}/ambiente/menu-deriva.m4a`]: '/galaxy/assets/menu-deriva-3c4d.m4a',
  [`${P}/ambiente/menu-faro.m4a`]: '/galaxy/assets/menu-faro-9z.m4a',
  [`${P}/propia/sector-hielo-capa2.ogg`]: '/galaxy/assets/hielo-2.ogg',
  [`${P}/propia/sector-hielo-capa0.ogg`]: '/galaxy/assets/hielo-0.ogg',
  [`${P}/propia/no-existe.ogg`]: '/galaxy/assets/x.ogg',
  [`${P}/otra-carpeta/menu-faro.ogg`]: '/galaxy/assets/y.ogg',
};

test('un archivo con el nombre de una pieza la sustituye, en su formato o en el otro si falta', () => {
  const lib = musicLibrary(found, 'ogg');
  expect(lib.piece('ambient', 'menu-deriva')).toEqual({ layers: ['/galaxy/assets/menu-deriva-1a2b.ogg'] });
  expect(lib.piece('ambient', 'menu-faro')).toEqual({ layers: ['/galaxy/assets/menu-faro-9z.m4a'] });
  expect(lib.piece('ambient', 'menu-marea')).toBeNull();
  expect(musicLibrary(found, 'm4a').piece('ambient', 'menu-deriva')).toEqual({ layers: ['/galaxy/assets/menu-deriva-3c4d.m4a'] });
});

test('por capas, en su orden; los nombres y las carpetas que no existen se ignoran', () => {
  const lib = musicLibrary(found, 'ogg');
  expect(lib.piece('own', 'sector-hielo')).toEqual({ layers: ['/galaxy/assets/hielo-0.ogg', '/galaxy/assets/hielo-2.ogg'] });
  expect(lib.count).toBe(4);
});

test('«Mi música» solo aparece si hay archivos propios', () => {
  expect(musicLibrary(found, 'ogg').hasOwn).toBe(true);
  expect(musicLibrary({ [`${P}/ambiente/menu-deriva.ogg`]: '/a.ogg' }, 'ogg').hasOwn).toBe(false);
  expect(musicLibrary({}, 'ogg').count).toBe(0);
});
