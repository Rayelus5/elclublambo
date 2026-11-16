import type { Gift } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { GiftPicker } from '../src/gifts/GiftPicker';
import { giftCatalog } from '../src/gifts/words';
import { jsonResponse, mockApi, renderAt } from './render';

afterEach(() => vi.unstubAllGlobals());

// The panel's gift picker (mail v2, P3): every kind of gift by tabs, each added with its own control — an amount of a
// currency, a piece from the gallery, a galaxy built by tier, finish and trait, a probe, XP or season points, a pack
// of the library — and the tabs move with the arrows.

const g = copy.gifts;
const now = new Date();
const cat = giftCatalog(
  [
    { key: 'mail', data: { packs: [{ id: 'bienvenida', name: 'Bienvenida', art: 'chest', items: [{ kind: 'xp', amount: 10 }] }] } },
    { key: 'season', data: { id: 's1', startsAt: new Date(now.getTime() - 86_400_000).toISOString(), endsAt: new Date(now.getTime() + 86_400_000 * 20).toISOString() } },
  ],
  DEFAULT_CONTENT.probes,
  now,
);

function setup(extra: Partial<Parameters<typeof GiftPicker>[0]> = {}) {
  const onAdd = vi.fn<(gift: Gift) => void>();
  const onAddPack = vi.fn<(id: string) => void>();
  // The pieces draw a title in its style from the player's own catalog: none here.
  mockApi({ 'GET /galaxy/api/profile/cosmetics': () => jsonResponse(200, {}) });
  renderAt('/x', { '/x': <GiftPicker catalog={cat} onAdd={onAdd} onAddPack={onAddPack} packsChosen={[]} itemsFull={false} packsFull={false} {...extra} /> });
  return { onAdd, onAddPack };
}
const tab = (name: string) => screen.getByRole('tab', { name });

test('recursos: una cantidad de cualquier moneda', async () => {
  const { onAdd } = setup();
  const panel = screen.getByRole('tabpanel');
  await userEvent.type(within(panel).getByLabelText(g.amountOf(g.currency.components)), '25');
  await userEvent.click(within(panel).getByRole('button', { name: g.addOf(g.currency.components) }));
  expect(onAdd).toHaveBeenCalledWith({ kind: 'currency', currency: 'components', amount: 25 });
});

test('las pestañas se recorren con las flechas', async () => {
  setup();
  tab(g.tabs.resources).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(tab(g.tabs.style)).toHaveFocus();
  expect(tab(g.tabs.style)).toHaveAttribute('aria-selected', 'true');
});

test('estilo: una pieza de la galería, filtrada por tipo; las de serie no salen', async () => {
  const { onAdd } = setup();
  await userEvent.click(tab(g.tabs.style));
  await userEvent.click(screen.getByRole('radio', { name: g.pieces.frame }));
  const gold = cat.cosmetics.frames.find((f) => f.id === 'gold')!;
  await userEvent.click(screen.getByRole('button', { name: g.addOf(g.cosmetic('frame', gold.name)) }));
  expect(onAdd).toHaveBeenCalledWith({ kind: 'cosmetic', piece: 'frame', id: 'gold' });
  await userEvent.click(screen.getByRole('radio', { name: g.pieces.avatar }));
  const plain = cat.cosmetics.avatars.find((a) => a.source === 'default')!;
  expect(screen.queryByRole('button', { name: g.addOf(g.cosmetic('avatar', plain.name)) })).toBeNull();
});

test('galaxias: rareza, acabado y cuántas', async () => {
  const { onAdd } = setup();
  await userEvent.click(tab(g.tabs.galaxies));
  await userEvent.click(screen.getByRole('radio', { name: copy.tiers.legendary }));
  await userEvent.click(screen.getByRole('radio', { name: copy.finishes.holo }));
  const count = screen.getByLabelText(g.galaxy.count);
  await userEvent.clear(count);
  await userEvent.type(count, '2');
  await userEvent.click(screen.getByRole('button', { name: g.add }));
  expect(onAdd).toHaveBeenCalledWith({ kind: 'galaxy', tier: 'legendary', finish: 'holo', trait: null, count: 2 });
});

test('sondas, progreso y packs', async () => {
  const { onAdd, onAddPack } = setup();
  const probe = DEFAULT_CONTENT.probes[2]!;
  await userEvent.click(tab(g.tabs.probes));
  await userEvent.click(screen.getByRole('button', { name: g.addOf(g.probe(probe.name)) }));
  expect(onAdd).toHaveBeenCalledWith({ kind: 'probe', probe: probe.id });
  await userEvent.click(tab(g.tabs.progress));
  await userEvent.type(screen.getByLabelText(g.amountOf(g.progress.xp)), '500');
  await userEvent.click(screen.getByRole('button', { name: g.addOf(g.progress.xp) }));
  expect(onAdd).toHaveBeenCalledWith({ kind: 'xp', amount: 500 });
  await userEvent.click(tab(g.tabs.packs));
  await userEvent.click(screen.getByRole('button', { name: g.addOf(g.pack('Bienvenida')) }));
  expect(onAddPack).toHaveBeenCalledWith('bienvenida');
});

test('con la bandeja llena no se añade nada más', async () => {
  setup({ itemsFull: true });
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByRole('button', { name: g.addOf(g.currency.coins) })).toBeDisabled();
  expect(within(panel).getByText(g.tray.full)).toBeInTheDocument();
});
