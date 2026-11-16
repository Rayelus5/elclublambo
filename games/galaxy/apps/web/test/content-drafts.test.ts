import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { changedFields, draftContent } from '../src/admin/content/drafts';

// The content editor's drafts (2026-11-16, P2): what a draft holds is only the top-level fields that differ from what is
// live; the content it plays is the draft over what is live.

test('solo los campos que cambian respecto a lo publicado; los que vuelven a ser iguales se quitan', () => {
  const live = { hitCap: 0.4, crit: { chance: 0.05, damage: 1.5 }, xp: { base: 5 } };
  const edited = { hitCap: 0.3, crit: { chance: 0.05, damage: 1.5 }, xp: { base: 6 } };
  expect(changedFields(live, edited, { xp: { base: 6 } })).toEqual({ hitCap: 0.3 });
  expect(changedFields(live, live, { hitCap: 0.3 })).toEqual({ hitCap: null });
});

test('el contenido del borrador es el borrador sobre lo publicado, con los valores por defecto', () => {
  const c = draftContent(DEFAULT_CONTENT, { hitCap: 0.33 });
  expect(c.ok).toBe(true);
  if (c.ok) {
    expect(c.content.hitCap).toBe(0.33);
    expect(c.content.enemies).toEqual(DEFAULT_CONTENT.enemies);
  }
  const bad = draftContent(DEFAULT_CONTENT, { hitCap: 5 });
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.issues[0]!.path).toBe('hitCap');
});
