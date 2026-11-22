import { configIssues } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { issueText } from '../src/admin/forms/issues';

// The run content's own checks (the content editor, 2026-11-16, P4) arrive as codes; an admin reads them in Spanish, with
// the thing that is wrong named.

test('una referencia que no existe dice cuál', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.sectors[0]!.spawns[0]!.enemy = 'no-existe';
  const issue = configIssues('content', c).find((i) => i.message.startsWith('content_ref'))!;
  expect(issueText(issue.message, c)).toBe('Apunta a «no-existe», que no existe');
});

test('cada código del contenido tiene su frase en español', () => {
  for (const code of [
    'content_dup:enemies',
    'content_evolution:weapons.3',
    'content_variant:weapons.3',
    'content_reaction:elements.reactions.1',
    'content_set:relics.sets.0',
    'content_phases:bosses.2',
    'content_cycle:sectors.0.bossCycle',
    'group_order',
    'props_dust_range',
    'satellites_window',
    'satellites_chances',
    'events_slot',
    'dash_too_fast',
    'pickups_fade',
    'content_art:icon-zz',
  ]) {
    const text = issueText(code, DEFAULT_CONTENT);
    expect(text, code).not.toBe(code);
    expect(text, code).not.toMatch(/content_|_/);
  }
});

test('«Qué cambia» y los problemas nombran los campos con las descripciones del editor', async () => {
  const { configJsonSchema } = await import('@galaxy/shared');
  const { humanDiff, placeOf } = await import('../src/admin/forms/humanDiff');
  const named = (p: string) => (p === 'hitCap' ? { label: 'Tope de daño por golpe', hint: 'x' } : undefined);
  const schema = configJsonSchema('content');
  expect(humanDiff('content', schema, DEFAULT_CONTENT, { ...DEFAULT_CONTENT, hitCap: 0.35 }, {}, named)).toEqual([expect.stringMatching(/^Tope de daño por golpe pasa de/)]);
  expect(placeOf('content', schema, DEFAULT_CONTENT, 'hitCap', named)).toBe('Tope de daño por golpe');
});
