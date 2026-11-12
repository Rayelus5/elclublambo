import { type CosmeticsView, DEFAULT_COSMETICS, SCRAP_SKIN_RUNS } from '@galaxy/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { HangarScreen } from '../src/hangar/HangarScreen';
import { WorkshopScreen } from '../src/workshop/WorkshopScreen';
import { PROBES, view } from './hangar-fixtures';
import { jsonResponse, mockApi, renderAt } from './render';

// Plan «skins», part C: the Taller's skin picker. The base drawing and the probe's skins as radio cards: the ones the
// player has go on at once; the rest are locked and say how they are won (Chatarra with its runs so far).

const t = copy.workshop;
const gacha = { banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 0, signal: 0, components: 0 } };
const cosmetics: CosmeticsView = { equipped: { avatar: null, frame: null, title: null, banner: null, backdrop: [] }, owned: { avatars: [], frames: [], titles: [], skins: ['skin-lumen-coral'] }, catalog: DEFAULT_COSMETICS };
const withSkins = (skin: string | null) => view({ probes: PROBES.map((p) => (p.id === 'lumen' ? { ...p, skin, skins: ['skin-lumen-coral'], runs: 12 } : p)) });

test('el Taller enseña las skins de la sonda: la de serie, las suyas y las bloqueadas con cómo se ganan', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, withSkins(null)),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, cosmetics),
    'PUT /galaxy/api/hangar/probes/lumen/skin': (b) => jsonResponse(200, withSkins((b as { skin: string | null }).skin)),
  });
  const user = userEvent.setup();
  renderAt('/taller?sonda=lumen', { '/taller': <WorkshopScreen /> });
  const group = await screen.findByRole('radiogroup', { name: t.skins });
  expect(within(group).getByRole('radio', { name: new RegExp(t.skinBase) })).toBeChecked();
  const scrap = within(group).getByRole('radio', { name: /Lumen de chatarra/ });
  expect(scrap).toBeDisabled();
  expect(scrap.closest('label')).toHaveTextContent(t.scrapProgress(12, SCRAP_SKIN_RUNS, 'Lumen'));
  const coral = within(group).getByRole('radio', { name: /Lumen de coral/ });
  expect(coral).toBeEnabled();
  await user.click(coral);
  await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probes/lumen/skin' && init?.method === 'PUT' && String(init.body).includes('skin-lumen-coral'))).toBe(true));
  expect(await within(group).findByRole('radio', { name: /Lumen de coral/ })).toBeChecked();
});

test('en el lobby, la sonda grande cambia de skin al momento entre las que tienes, y sin skins no hay selector', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, withSkins(null)),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, cosmetics),
    'PUT /galaxy/api/hangar/probes/lumen/skin': (b) => jsonResponse(200, withSkins((b as { skin: string | null }).skin)),
  });
  const user = userEvent.setup();
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const group = await screen.findByRole('radiogroup', { name: copy.lobby.skins });
  expect(within(group).getAllByRole('radio')).toHaveLength(2);
  await user.click(within(group).getByRole('radio', { name: 'Lumen de coral' }));
  await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probes/lumen/skin' && init?.method === 'PUT')).toBe(true));
  expect(await within(group).findByRole('radio', { name: 'Lumen de coral' })).toHaveAttribute('aria-checked', 'true');
});

test('sin skins de la sonda, el lobby no enseña selector', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: copy.lobby.skins })).not.toBeInTheDocument();
});

test('si el servidor no deja ponerla, el lobby lo dice y vuelve a la que llevaba', async () => {
  mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, withSkins(null)),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, cosmetics),
    'PUT /galaxy/api/hangar/probes/lumen/skin': () => jsonResponse(409, { error: 'cosmetic_locked' }),
  });
  const user = userEvent.setup();
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const group = await screen.findByRole('radiogroup', { name: copy.lobby.skins });
  await user.click(within(group).getByRole('radio', { name: 'Lumen de coral' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(within(group).getByRole('radio', { name: copy.lobby.skinBase })).toHaveAttribute('aria-checked', 'true');
});
