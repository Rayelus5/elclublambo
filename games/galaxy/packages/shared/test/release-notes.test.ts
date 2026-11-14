import { describe, expect, test } from 'vitest';
import { compareVersions, nextNoteVersion, noteShelf, RELEASE_NOTES, releaseNoteSchema, versionLabel } from '../src';

// «Notas de versión» (plan «notas de versión»): what changed in the game, version by version, from the open beta on.
// The notes written in the code must be valid, in order (the newest first) and never repeat an id or a version.

describe('las notas de versión del código', () => {
  test('cada nota es válida', () => {
    for (const note of RELEASE_NOTES) expect(releaseNoteSchema.safeParse(note).success, note.id).toBe(true);
  });

  test('van de la más nueva a la más antigua, sin repetir versión ni id', () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      const [newer, older] = [RELEASE_NOTES[i - 1]!, RELEASE_NOTES[i]!];
      expect(compareVersions(newer.version, older.version), `${newer.version} antes que ${older.version}`).toBeGreaterThan(0);
      expect(newer.date >= older.date, `${newer.id} no es anterior a ${older.id}`).toBe(true);
    }
    expect(new Set(RELEASE_NOTES.map((n) => n.id)).size).toBe(RELEASE_NOTES.length);
  });

  test('empiezan en la beta abierta, la 1.0 del 10 de noviembre', () => {
    const first = RELEASE_NOTES.at(-1)!;
    expect(first).toMatchObject({ version: '1.0', date: '2026-11-10' });
  });

  test('los textos siguen el estilo del juego: sin punto final ni símbolos en los títulos', () => {
    for (const note of RELEASE_NOTES) {
      expect(note.title, note.id).not.toMatch(/[.·:—→]|\/\//);
      expect(note.summary, note.id).not.toMatch(/\.$/);
      for (const item of note.items) expect(item.text, note.id).not.toMatch(/\.$/);
    }
  });
});

// The owner (2026-11-14): the beta's notes under «BETA»; from 2027, year › month › vYY.NN, numbered through the year.
describe('las categorías y la numeración', () => {
  test('las 1.x son de la BETA; desde 2027 van por su año y su mes', () => {
    expect(noteShelf({ version: '1.22', date: '2026-11-13' })).toEqual({ kind: 'beta' });
    expect(noteShelf({ version: '1.40', date: '2026-12-30' })).toEqual({ kind: 'beta' });
    expect(noteShelf({ version: '27.01', date: '2027-01-02' })).toEqual({ kind: 'month', year: 2027, month: 1 });
    expect(noteShelf({ version: '27.09', date: '2027-02-14' })).toEqual({ kind: 'month', year: 2027, month: 2 });
    for (const note of RELEASE_NOTES) if (note.date < '2027-01-01') expect(noteShelf(note), note.id).toEqual({ kind: 'beta' });
  });

  test('la siguiente versión: la beta sigue con 1.x hasta 2026; en 2027 empieza en 27.01 y sigue todo el año', () => {
    expect(nextNoteVersion([], '2026-11-10')).toBe('1.0');
    expect(nextNoteVersion(['1.22', '1.9'], '2026-12-31')).toBe('1.23');
    expect(nextNoteVersion(['1.22'], '2027-01-01')).toBe('27.01');
    expect(nextNoteVersion(['1.22', '27.01', '27.07'], '2027-02-03')).toBe('27.08');
    expect(nextNoteVersion(['27.12'], '2028-01-05')).toBe('28.01');
    expect(versionLabel('27.01')).toBe('v27.01');
    // The new ones still come after the beta's, as numbers.
    expect(compareVersions('27.01', '1.40')).toBeGreaterThan(0);
    expect(compareVersions('27.10', '27.09')).toBeGreaterThan(0);
  });
});

describe('las versiones', () => {
  test('se comparan como números, no como texto', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '1.12')).toBeGreaterThan(0);
    expect(compareVersions('1.4', '1.4')).toBe(0);
    expect(compareVersions('1.3', '1.4')).toBeLessThan(0);
  });

  test('una nota sin cambios, con fecha o versión mal escritas, o con un tipo desconocido no vale', () => {
    const ok = { id: 'v9-9-prueba', version: '9.9', date: '2026-12-01', title: 'Prueba', summary: '', items: [{ kind: 'nuevo', text: 'Algo' }] };
    expect(releaseNoteSchema.safeParse(ok).success).toBe(true);
    expect(releaseNoteSchema.safeParse({ ...ok, items: [] }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, date: '1/12/2026' }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, date: '2026-02-31' }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, date: '2026-13-01' }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, version: 'v9' }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, items: [{ kind: 'secreto', text: 'x' }] }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, id: 'Con Espacios' }).success).toBe(false);
  });
});
