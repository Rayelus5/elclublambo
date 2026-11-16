import { describe, expect, test } from 'vitest';
import { rebaseDraft } from '../src/config/rebase';

// Rebasing a config draft (the content editor, 2026-11-16, P2): a draft made on version N, while someone published
// N + 1. Each field the draft changes is merged three ways — what it was based on, what is live now, what the draft
// says: a list of things with ids entity by entity, an object property by property, anything else whole. What both
// changed differently is a conflict, unless a resolution says whose wins.

const mite = { id: 'mite', name: 'Ácaro', hp: 10 };
const cell = { id: 'cell', name: 'Célula', hp: 20 };
const ray = { id: 'ray', name: 'Raya', hp: 30 };

describe('listas con id', () => {
  test('cada lado cambia una entidad distinta: se juntan las dos', () => {
    const base = { enemies: [mite, cell] };
    const live = { enemies: [mite, { ...cell, hp: 25 }] };
    const r = rebaseDraft(base, live, { enemies: [{ ...mite, hp: 12 }, cell] });
    expect(r.conflicts).toEqual([]);
    expect(r.fields).toEqual({ enemies: [{ ...mite, hp: 12 }, { ...cell, hp: 25 }] });
  });

  test('una entidad que el borrador no tocó y se quitó en lo publicado se va; una nueva publicada entra tras su anterior', () => {
    const base = { enemies: [mite, cell] };
    const live = { enemies: [mite, ray] };
    const r = rebaseDraft(base, live, { enemies: [{ ...mite, hp: 12 }, cell] });
    expect(r.conflicts).toEqual([]);
    expect(r.fields).toEqual({ enemies: [{ ...mite, hp: 12 }, ray] });
  });

  test('lo nuevo del borrador se queda, en su sitio', () => {
    const base = { enemies: [mite] };
    const live = { enemies: [{ ...mite, hp: 11 }] };
    const r = rebaseDraft(base, live, { enemies: [mite, ray] });
    expect(r.fields).toEqual({ enemies: [{ ...mite, hp: 11 }, ray] });
  });

  test('los dos cambian la misma entidad de forma distinta: conflicto, hasta que se elige', () => {
    const base = { enemies: [mite] };
    const live = { enemies: [{ ...mite, hp: 11 }] };
    const mine = { enemies: [{ ...mite, hp: 13 }] };
    const r = rebaseDraft(base, live, mine);
    expect(r.conflicts).toEqual([{ field: 'enemies', id: 'mite' }]);
    expect(rebaseDraft(base, live, mine, { enemies: { mite: 'mine' } }).fields).toEqual({ enemies: [{ ...mite, hp: 13 }] });
    expect(rebaseDraft(base, live, mine, { enemies: { mite: 'live' } }).fields).toEqual({ enemies: [{ ...mite, hp: 11 }] });
  });

  test('el mismo cambio en los dos lados no es conflicto', () => {
    const base = { enemies: [mite] };
    const same = { enemies: [{ ...mite, hp: 11 }] };
    expect(rebaseDraft(base, same, same).conflicts).toEqual([]);
  });
});

describe('objetos y valores', () => {
  test('un objeto se junta propiedad a propiedad', () => {
    const base = { healing: { base: 0.01, perLifesteal: 0.4 } };
    const live = { healing: { base: 0.02, perLifesteal: 0.4 } };
    const r = rebaseDraft(base, live, { healing: { base: 0.01, perLifesteal: 0.5 } });
    expect(r.fields).toEqual({ healing: { base: 0.02, perLifesteal: 0.5 } });
  });

  test('un valor cambiado en los dos lados es conflicto del campo entero', () => {
    const r = rebaseDraft({ hitCap: 0.4 }, { hitCap: 0.5 }, { hitCap: 0.3 });
    expect(r.conflicts).toEqual([{ field: 'hitCap' }]);
    expect(rebaseDraft({ hitCap: 0.4 }, { hitCap: 0.5 }, { hitCap: 0.3 }, { hitCap: { '*': 'live' } }).fields).toEqual({ hitCap: 0.5 });
  });

  test('si lo publicado no tocó un campo, el borrador manda', () => {
    expect(rebaseDraft({ hitCap: 0.4 }, { hitCap: 0.4 }, { hitCap: 0.3 })).toEqual({ fields: { hitCap: 0.3 }, conflicts: [] });
  });
});
