import { afterEach, expect, test, vi } from 'vitest';
import { applyPrefs, DEFAULT_PREFS, getPrefs, prefersReduced, readStoredPrefs, resetPrefs, setPrefs } from '../src/settings/prefs';

// The game's own preferences (plan «escáner pro», part A): the pro scanner, motion and colour vision, kept in this
// browser under one versioned key, applied to <html> at once, and never trusted blindly from storage.

function stubMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: reduce,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    set(on: boolean) {
      media.matches = on;
      listeners.forEach((fn) => fn());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetPrefs();
  localStorage.clear();
  delete document.documentElement.dataset['motion'];
  delete document.documentElement.dataset['cvd'];
});

test('sin nada guardado: escáner pro, movimiento del sistema y visión normal', () => {
  expect(getPrefs()).toEqual({ scannerPro: true, motion: 'system', colorVision: 'none', notesSeen: null, musicStyle: 'ambient', probeGlow: false });
  expect(DEFAULT_PREFS.scannerPro).toBe(true);
});

test('se guardan con versión en galaxy.prefs y se leen al volver', () => {
  setPrefs({ scannerPro: false, motion: 'reduced' });
  expect(getPrefs()).toMatchObject({ scannerPro: false, motion: 'reduced' });
  const stored = JSON.parse(localStorage.getItem('galaxy.prefs')!);
  expect(stored.version).toBe(1);
  expect(readStoredPrefs()).toEqual({ scannerPro: false, motion: 'reduced', colorVision: 'none', notesSeen: null, musicStyle: 'ambient', probeGlow: false });
});

test('lo guardado que no vale se cambia por el valor de siempre', () => {
  localStorage.setItem('galaxy.prefs', JSON.stringify({ state: { scannerPro: 'sí', motion: 'rapido', colorVision: 'deutan', notesSeen: 'beta' }, version: 1 }));
  expect(readStoredPrefs()).toEqual({ scannerPro: true, motion: 'system', colorVision: 'deutan', notesSeen: null, musicStyle: 'ambient', probeGlow: false });
  localStorage.setItem('galaxy.prefs', JSON.stringify({ state: { notesSeen: '1.4' }, version: 1 }));
  expect(readStoredPrefs().notesSeen).toBe('1.4');
  localStorage.setItem('galaxy.prefs', '{roto');
  expect(readStoredPrefs()).toEqual(DEFAULT_PREFS);
});

test('el movimiento reducido sigue al ajuste y, en «Sistema», al sistema', () => {
  const os = stubMotion(false);
  expect(prefersReduced()).toBe(false);
  os.set(true);
  expect(prefersReduced()).toBe(true);
  setPrefs({ motion: 'full' });
  expect(prefersReduced()).toBe(false);
  setPrefs({ motion: 'reduced' });
  os.set(false);
  expect(prefersReduced()).toBe(true);
});

test('applyPrefs marca <html> y lo mantiene al día con el ajuste y con el sistema', () => {
  const os = stubMotion(false);
  const stop = applyPrefs();
  const html = document.documentElement;
  expect(html.dataset['motion']).toBe('full');
  expect(html.dataset['cvd']).toBe('none');
  os.set(true);
  expect(html.dataset['motion']).toBe('reduced');
  setPrefs({ motion: 'full', colorVision: 'tritan' });
  expect(html.dataset['motion']).toBe('full');
  expect(html.dataset['cvd']).toBe('tritan');
  stop();
  setPrefs({ motion: 'reduced' });
  expect(html.dataset['motion']).toBe('full');
});

test('sin localStorage (ventana privada) funciona en memoria', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  });
  expect(() => setPrefs({ motion: 'reduced' })).not.toThrow();
  expect(getPrefs().motion).toBe('reduced');
});

test('el estilo de música: Ambiente espacial por defecto; uno que no existe vuelve a él', () => {
  expect(getPrefs().musicStyle).toBe('ambient');
  setPrefs({ musicStyle: 'own' });
  expect(readStoredPrefs().musicStyle).toBe('own');
  localStorage.setItem('galaxy.prefs', JSON.stringify({ state: { musicStyle: 'reguetón' }, version: 1 }));
  expect(readStoredPrefs().musicStyle).toBe('ambient');
});
