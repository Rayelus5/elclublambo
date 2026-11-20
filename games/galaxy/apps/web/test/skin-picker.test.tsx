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
const gacha = { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 0, dust: 0, signal: 0, components: 0 } };
const cosmetics: CosmeticsView = { equipped: { avatar: null, frame: null, title: null, banner: null, backdrop: [] }, owned: { avatars: [], frames: [], titles: [], skins: ['skin-lumen-coral'] }, catalog: DEFAULT_COSMETICS };
const withSkins = (skin: string | null) => view({ probes: PROBES.map((p) => (p.id === 'lumen' ? { ...p, skin, skins: ['skin-lumen-coral'], runs: 12 } : p)) });

test('el Taller enseña las skins bajo «Equipar», en mini tarjetas: la de serie, las suyas y las bloqueadas', async () => {
  const fetch = mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, withSkins(null)),
    'GET /galaxy/api/gacha': () => jsonResponse(200, gacha),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, cosmetics),
    'PUT /galaxy/api/hangar/probes/lumen/skin': (b) => jsonResponse(200, withSkins((b as { skin: string | null }).skin)),
  });
  const user = userEvent.setup();
  renderAt('/taller?sonda=lumen', { '/taller': <WorkshopScreen /> });
  const group = await screen.findByRole('radiogroup', { name: t.skins });
  // Under the bay's plate, not in the sheet.
  expect(group.closest('.workshop-bay')).not.toBeNull();
  expect(group.closest('.workshop-info')).toBeNull();
  // The base and the one Lumen has (Coral) first, then the nine it can still win: eleven in all.
  const radios = within(group).getAllByRole('radio');
  expect(radios).toHaveLength(11);
  expect(radios.slice(0, 2).map((r) => r.getAttribute('aria-label'))).toEqual([t.skinBase, 'Lumen de coral']);
  expect(radios[0]).toBeChecked();
  // With nothing pointed at, the line under the grid tells the one it wears.
  const caption = screen.getByTestId('skin-caption');
  expect(caption).toHaveTextContent(t.skinBase);
  // A locked one can be reached (to read how it is won) but not worn.
  const scrap = within(group).getByRole('radio', { name: 'Lumen de chatarra' });
  expect(scrap).toHaveAttribute('aria-disabled', 'true');
  await user.hover(scrap.closest('label')!);
  expect(caption).toHaveTextContent(t.scrapProgress(12, SCRAP_SKIN_RUNS, 'Lumen'));
  await user.click(scrap);
  expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probes/lumen/skin' && init?.method === 'PUT')).toBe(false);
  // A locked one of the shop says which pack has it and leads to the shop's Estilo tab.
  const fire = within(group).getByRole('radio', { name: 'Lumen de fuego' });
  await user.hover(fire.closest('label')!);
  expect(caption).toHaveTextContent('Exclusiva del Pack Fuego');
  expect(within(caption).getByRole('link', { name: t.skinShop })).toHaveAttribute('href', '/tienda?pestana=estilo');
  // The bay's big probe previews the one pointed at, locked or not (the owner: every skin seen in full).
  const bayProbe = () => document.querySelector('.workshop-probe')!;
  expect(bayProbe()).toHaveAttribute('data-drawing', 'skin-lumen-fuego');
  expect(screen.getByText(t.preview('Lumen de fuego'))).toBeInTheDocument();
  // Pressing a locked one keeps it in the bay after the pointer leaves; one of mine puts it on and ends the preview.
  await user.click(fire);
  await user.unhover(fire.closest('label')!);
  expect(bayProbe()).toHaveAttribute('data-drawing', 'skin-lumen-fuego');
  // One it has goes on at once.
  const coral = within(group).getByRole('radio', { name: 'Lumen de coral' });
  await user.click(coral);
  await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probes/lumen/skin' && init?.method === 'PUT' && String(init.body).includes('skin-lumen-coral'))).toBe(true));
  expect(await within(group).findByRole('radio', { name: 'Lumen de coral' })).toBeChecked();
  await user.unhover(coral.closest('label')!);
  await waitFor(() => expect(bayProbe()).toHaveAttribute('data-drawing', 'skin-lumen-coral'));
  expect(screen.queryByText(t.preview('Lumen de fuego'))).toBeNull();
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

test('sin skins de la sonda, el lobby no enseña selector, solo el «+» que lleva a elegirlas en el Taller', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()) });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  expect(await screen.findByRole('heading', { name: 'Lumen' })).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: copy.lobby.skins })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: copy.lobby.moreSkins('Lumen') })).toHaveAttribute('href', '/taller?sonda=lumen');
});

// The owner (2026-11-17): the lobby shows a few skins at most, the worn one always among them, and a «+» square that
// leads to the Taller to choose among all of them.
test('con muchas skins, el lobby enseña unas pocas (la puesta siempre) y el «+» al Taller', async () => {
  const lines = ['coral', 'aurora', 'leyenda', 'navidad', 'fuego', 'agua', 'rubi'];
  const owned = lines.map((l) => `skin-lumen-${l}`);
  const many = view({ probes: PROBES.map((p) => (p.id === 'lumen' ? { ...p, skin: 'skin-lumen-rubi', skins: owned, runs: 12 } : p)) });
  mockApi({
    'GET /galaxy/api/hangar': () => jsonResponse(200, many),
    'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, { ...cosmetics, owned: { ...cosmetics.owned, skins: owned } }),
  });
  renderAt('/incursion', { '/incursion': <HangarScreen /> });
  const group = await screen.findByRole('radiogroup', { name: copy.lobby.skins });
  const radios = within(group).getAllByRole('radio');
  // The base and four skins at most.
  expect(radios).toHaveLength(5);
  expect(radios[0]).toHaveAccessibleName(copy.lobby.skinBase);
  expect(within(group).getByRole('radio', { name: 'Lumen de rubí' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('link', { name: copy.lobby.moreSkins('Lumen') })).toHaveAttribute('href', '/taller?sonda=lumen');
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
