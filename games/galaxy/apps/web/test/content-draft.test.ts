import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterEach, expect, test, vi } from 'vitest';
import { clearContentDraft, readContentDraft, saveContentDraft } from '../src/admin/content-draft';

// A content draft taken from the panel to a test run (admin debug mode, 2026-11-15): kept for the tab's session, read
// back only if it still validates, and never breaking anything when the browser storage refuses.

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

test('guardar y leer dan el mismo borrador, ya validado', () => {
  const raw = structuredClone(DEFAULT_CONTENT);
  raw.sectors[0]!.name = 'Nebulosa de prueba';
  saveContentDraft({ baseVersion: 12, raw, content: DEFAULT_CONTENT });
  const back = readContentDraft();
  expect(back?.baseVersion).toBe(12);
  expect(back?.content.sectors[0]!.name).toBe('Nebulosa de prueba');
  clearContentDraft();
  expect(readContentDraft()).toBeNull();
});

test('un borrador que ya no valida se lee como ninguno', () => {
  sessionStorage.setItem('galaxy:content-draft', JSON.stringify({ baseVersion: 3, raw: { sectors: 'mal' } }));
  expect(readContentDraft()).toBeNull();
  sessionStorage.setItem('galaxy:content-draft', '{no es json');
  expect(readContentDraft()).toBeNull();
});

test('si el almacenamiento falla, no rompe nada', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  expect(() => saveContentDraft({ baseVersion: 1, raw: {}, content: DEFAULT_CONTENT })).not.toThrow();
  expect(readContentDraft()).toBeNull();
  expect(() => clearContentDraft()).not.toThrow();
});
