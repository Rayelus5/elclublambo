import { describe, expect, test } from 'vitest';
import { compareVersions, RELEASE_NOTES, releaseNoteSchema } from '../src';

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
    expect(releaseNoteSchema.safeParse({ ...ok, version: 'v9' }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, items: [{ kind: 'secreto', text: 'x' }] }).success).toBe(false);
    expect(releaseNoteSchema.safeParse({ ...ok, id: 'Con Espacios' }).success).toBe(false);
  });
});
