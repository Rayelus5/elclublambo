import { ENGINE_VERSION, type BrailleRender } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { GalaxyCache, galaxyKey } from '../src/galaxy/cache';

// Renders cached in memory (LRU of 12) and in IndexedDB; jsdom has no IndexedDB, which is Review Focus 5.
const fake = (id: number) => ({ text: `galaxy ${id}` }) as unknown as BrailleRender;

describe('GalaxyCache', () => {
  test('la LRU de 12 expulsa la entrada menos usada al guardar la 13', async () => {
    const cache = new GalaxyCache({ indexedDB: null });
    for (let i = 1; i <= 12; i++) await cache.put(`k${i}`, fake(i));
    expect((await cache.get('k1'))?.text).toBe('galaxy 1'); // k1 becomes the most recently used
    await cache.put('k13', fake(13));
    expect(await cache.get('k2')).toBeUndefined();
    expect((await cache.get('k1'))?.text).toBe('galaxy 1');
    expect((await cache.get('k13'))?.text).toBe('galaxy 13');
  });

  test('la clave lleva la versión del motor, la semilla, las columnas y los rasgos fijados', async () => {
    expect(galaxyKey(42n, 96)).toBe(`${ENGINE_VERSION}:42:96:-`);
    expect(galaxyKey(42n, 96, { phenomenon: 'none', galaxy_type: 'ring' })).toBe(`${ENGINE_VERSION}:42:96:galaxy_type=ring,phenomenon=none`);
    const cache = new GalaxyCache({ indexedDB: null });
    await cache.put(galaxyKey(42n, 96, undefined, '1.0.0'), fake(1));
    expect(await cache.get(galaxyKey(42n, 96, undefined, '2.0.0'))).toBeUndefined();
  });

  test('sin IndexedDB funciona solo en memoria y no lanza (Review Focus 5)', async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const cache = new GalaxyCache();
    await cache.put('a', fake(1));
    expect((await cache.get('a'))?.text).toBe('galaxy 1');
    expect(await cache.get('missing')).toBeUndefined();
  });

  test('si IndexedDB falla al abrirse, sigue en memoria', async () => {
    const broken = {
      open() {
        throw new Error('blocked by the browser');
      },
    } as unknown as IDBFactory;
    const cache = new GalaxyCache({ indexedDB: broken });
    await cache.put('a', fake(1));
    expect((await cache.get('a'))?.text).toBe('galaxy 1');
  });
});
