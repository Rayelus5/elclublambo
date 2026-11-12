import type { CatalogView } from '@galaxy/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CatalogScreen } from '../src/collection/CatalogScreen';
import { copy } from '../src/copy/es';
import { jsonResponse, mockApi, renderAt } from './render';

// The ECN Catalogue (GDD §12.3; M7b): what is found by name, the rest as «?», and each share's reward.
afterEach(() => vi.unstubAllGlobals());

test('el álbum enseña lo descubierto por su nombre, lo demás como ?, y el premio alcanzado se puede recoger', async () => {
  const view: CatalogView = {
    entries: [
      { kind: 'galaxy_type', value: 'spiral', found: true },
      { kind: 'galaxy_type', value: 'ring', found: false },
      { kind: 'finish', value: 'holo', found: true },
    ],
    found: 2,
    total: 3,
    percent: 66,
    rewards: [
      { percent: 10, reward: { coins: 0, dust: 300, signal: 0, title: null, frame: null, avatar: null, skin: null }, reached: true, claimed: false },
      { percent: 100, reward: { coins: 0, dust: 0, signal: 10, title: 'Guardián del cielo', frame: 'gold', avatar: null, skin: null }, reached: false, claimed: false },
    ],
  };
  mockApi({ 'GET /galaxy/api/catalog': () => jsonResponse(200, view) });
  renderAt('/catalogo', { '/catalogo': <CatalogScreen /> });
  const types = await screen.findByRole('region', { name: /Tipos/ });
  expect(within(types).getByText('Espiral')).toBeInTheDocument();
  expect(within(types).getByLabelText(copy.catalog.missing)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: copy.catalog.claimOf(10) })).toBeEnabled();
  expect(screen.getByRole('button', { name: copy.catalog.claimOf(100) })).toBeDisabled();
  expect(screen.getByText(/el título Guardián del cielo, el marco Oro/)).toBeInTheDocument();
});
