import type { AdminStorage } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { formatBytes, StorageScreen } from '../src/admin/StorageScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// «Almacenamiento» in the panel (the owner: «desde admin deberíamos de poder visualizar el almacenamiento del servidor»):
// the database and the game's part of it, the server's disk, the galaxies alive and disintegrated (their pictures are
// drawn in each player's browser, so the server keeps none), and the biggest tables.

afterEach(() => vi.unstubAllGlobals());
const t = copy.admin.storage;

const view: AdminStorage = {
  readAt: '2026-11-13T00:40:00.000Z',
  database: { bytes: 34 * 1024 * 1024, gameBytes: 20 * 1024 * 1024 },
  disk: { totalBytes: 80 * 1024 ** 3, freeBytes: 50 * 1024 ** 3 },
  galaxies: { live: 440, disintegrated: 597, bytes: 752 * 1024 },
  tables: [
    { name: 'ledger', rows: 52_000, bytes: 6 * 1024 * 1024, indexBytes: 2 * 1024 * 1024 },
    { name: 'galaxies', rows: 1037, bytes: 752 * 1024, indexBytes: 200 * 1024 },
    { name: 'fresh', rows: null, bytes: 16 * 1024, indexBytes: 8 * 1024 },
  ],
};
const open = (body: AdminStorage = view) => {
  mockApi({ 'GET /galaxy/api/admin/storage': () => jsonResponse(200, body) });
  renderAt('/admin/almacenamiento', { '/admin/almacenamiento': <StorageScreen /> });
};

test('los bytes se leen en la unidad que toca', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(752 * 1024)).toBe('752 kB');
  expect(formatBytes(34 * 1024 * 1024)).toBe('34 MB');
  expect(formatBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
});

test('las fichas: base de datos, disco, galaxias y sus imágenes', async () => {
  open();
  const db = await screen.findByRole('group', { name: t.tiles.database });
  expect(db).toHaveTextContent('34 MB');
  expect(db).toHaveTextContent(t.tiles.game('20 MB'));
  const disk = screen.getByRole('group', { name: t.tiles.disk });
  expect(disk).toHaveTextContent('50 GB');
  expect(disk).toHaveTextContent(t.tiles.used('30 GB', '80 GB', '38 %'));
  const galaxies = screen.getByRole('group', { name: t.tiles.galaxies });
  expect(galaxies).toHaveTextContent('1037');
  expect(galaxies).toHaveTextContent(t.tiles.alive('440', '597'));
  // The galaxies' pictures are never stored on the server.
  expect(screen.getByRole('group', { name: t.tiles.images })).toHaveTextContent(t.tiles.imagesDetail);
});

test('las tablas más grandes, con sus filas aproximadas y sus índices', async () => {
  open();
  const table = await screen.findByRole('table', { name: t.tablesTitle });
  const [first, second, third] = within(table).getAllByRole('row').slice(1);
  expect(first).toHaveTextContent('ledger');
  expect(first).toHaveTextContent('52.000');
  expect(first).toHaveTextContent('6 MB');
  expect(first).toHaveTextContent('2 MB');
  expect(second).toHaveTextContent('galaxies');
  // A table never analysed has no row estimate yet.
  expect(third).toHaveTextContent(t.noEstimate);
});

test('sin el dato del disco lo dice en vez de inventarlo', async () => {
  open({ ...view, disk: null });
  expect(await screen.findByRole('group', { name: t.tiles.disk })).toHaveTextContent(t.tiles.noDisk);
});
