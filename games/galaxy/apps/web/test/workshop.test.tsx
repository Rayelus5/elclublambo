import { DEFAULT_CONTENT } from '@galaxy/sim';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { WorkshopScreen } from '../src/workshop/WorkshopScreen';
import { PROBES, view } from './hangar-fixtures';
import { levelOne } from './probe-cards';
import { jsonResponse, locationOf, mockApi, renderAt } from './render';

// The probe workshop (the owner's «taller espacial»): every probe in the roster, the chosen one on the bay, equipping
// it apart from looking at it, levelling it up with a celebration, its starting weapon, and how a locked one is won.

const t = copy.workshop;
const lumenDef = DEFAULT_CONTENT.probes.find((p) => p.id === 'lumen')!;
const wallet = (components = 100, coins = 2000) => ({ coins, dust: 0, signal: 0, components });
const gacha = (w = wallet()) => ({ banners: [], costs: { coins: 100, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: w });
/** The hangar with Lumen at `level` (and its chosen weapon). */
const at = (level: number, variant: string | null = null) => view({ probes: PROBES.map((p) => (p.id === 'lumen' ? { ...p, ...levelOne(lumenDef, level, variant) } : p)) });
const open = (path = '/taller') => renderAt(path, { '/taller': <WorkshopScreen /> });

describe('la plantilla', () => {
  test('las 8 sondas: la equipada lo dice, las bloqueadas dicen qué las gana', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
    open();
    const roster = await screen.findByRole('list', { name: t.roster });
    expect(within(roster).getAllByRole('listitem')).toHaveLength(8);
    expect(within(roster).getByRole('button', { name: 'Lumen' })).toHaveTextContent(t.equipped);
    expect(within(roster).getByRole('button', { name: 'Vigía' }).closest('li')).toHaveTextContent(copy.hangar.unlock.bossKills(3));
  });

  test('elegir una la enseña en la bahía sin equiparla; ?sonda= abre esa', async () => {
    const fetch = mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
    const user = userEvent.setup();
    open('/taller?sonda=bastion');
    expect(await screen.findByRole('heading', { level: 2, name: 'Bastión' })).toBeInTheDocument();
    const roster = screen.getByRole('list', { name: t.roster });
    expect(within(roster).getByRole('button', { name: 'Bastión' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(roster).getByRole('button', { name: 'Vigía' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Vigía' })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
});

describe('equipar', () => {
  test('Equipar envía la sonda y luego dice Equipada', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, view()),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      'PUT /galaxy/api/hangar/probe': (b) => jsonResponse(200, view({ probe: (b as { probe: string }).probe })),
    });
    const user = userEvent.setup();
    open('/taller?sonda=bastion');
    await user.click(await screen.findByRole('button', { name: t.equip }));
    await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probe' && init?.method === 'PUT')).toBe(true));
    expect(await screen.findByRole('button', { name: t.equipped })).toBeDisabled();
  });

  test('una bloqueada no se equipa y dice cómo se consigue, con su progreso', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view()), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
    open('/taller?sonda=comet');
    expect(await screen.findByRole('button', { name: t.locked })).toBeDisabled();
    const how = screen.getByRole('region', { name: t.how });
    expect(how).toHaveTextContent(copy.hangar.unlock.kills(2000));
    expect(within(how).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1999');
  });
});

describe('mejorar', () => {
  test('subir de nivel envía el nivel y lo celebra', async () => {
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, at(3)),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      'POST /galaxy/api/hangar/probes/lumen/level-up': () => jsonResponse(200, at(4)),
    });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/galaxy/api/hangar/probes/lumen/level-up')).toBe(true));
    expect(await screen.findByText(t.levelBanner(4))).toBeInTheDocument();
  });

  test('sin fondos la subida está desactivada y dice cuánto falta', async () => {
    mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, at(3)), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha(wallet(0, 0))) });
    open();
    expect(await screen.findByRole('button', { name: new RegExp(copy.hangar.levelUp(4)) })).toBeDisabled();
  });

  test('el arma inicial: elegir la del nivel 4 la envía', async () => {
    const variant = levelOne(lumenDef, 4).variants[1]!;
    const fetch = mockApi({
      'GET /galaxy/api/hangar': () => jsonResponse(200, at(4)),
      'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()),
      [`PUT /galaxy/api/hangar/probes/lumen/variant`]: () => jsonResponse(200, at(4, variant.id)),
    });
    const user = userEvent.setup();
    open();
    const weapons = await screen.findByRole('radiogroup', { name: copy.hangar.startingWeapon });
    await user.click(within(weapons).getByRole('radio', { name: new RegExp(variant.name) }));
    await waitFor(() => expect(fetch.mock.calls.some(([u, init]) => u === '/galaxy/api/hangar/probes/lumen/variant' && init?.method === 'PUT')).toBe(true));
  });
});

test('sin el test de la sonda, el taller lleva al test', async () => {
  mockApi({ 'GET /galaxy/api/hangar': () => jsonResponse(200, view({ test: { taken: false, probe: null } })), 'GET /galaxy/api/gacha': () => jsonResponse(200, gacha()) });
  open();
  await waitFor(() => expect(locationOf(screen.getByTestId('location')).pathname).toBe('/sonda'));
});
