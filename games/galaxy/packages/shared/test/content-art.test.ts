import { DEFAULT_CONTENT } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { ART, configIssues } from '../src/index';

// The content's drawings exist (the content editor, 2026-11-16, P5): a sprite or icon id the arena does not have would
// crash a run, so publishing it is refused — in the panel, the server and the CLI alike.

test('el contenido por defecto solo usa dibujos que existen', () => {
  expect(configIssues('content', DEFAULT_CONTENT)).toEqual([]);
  expect(ART[DEFAULT_CONTENT.enemies[0]!.sprite]).toBeDefined();
});

test('un dibujo o un icono que no existe no se publica, y dice cuál', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.enemies[0]!.sprite = 'zz-no-existe';
  c.weapons[1]!.icon = 'icon-zz';
  expect(configIssues('content', c)).toEqual([
    { path: 'weapons.1.icon', message: 'content_art:icon-zz' },
    { path: 'enemies.0.sprite', message: 'content_art:zz-no-existe' },
  ]);
});

test('el catálogo dice el grupo, el tamaño y los fotogramas de cada dibujo', () => {
  const mite = ART[DEFAULT_CONTENT.enemies.find((e) => e.id === 'mite')!.sprite]!;
  expect(mite.group).toBe('fauna');
  expect(mite.w).toBeGreaterThan(0);
  expect(mite.frames).toBeGreaterThan(0);
  expect(ART[DEFAULT_CONTENT.bosses[0]!.sprite]!.group).toBe('nucleos');
  expect(ART[DEFAULT_CONTENT.probes[0]!.sprite]!.group).toBe('sondas');
  expect(ART[DEFAULT_CONTENT.weapons[0]!.icon]!.group).toBe('iconos');
});
