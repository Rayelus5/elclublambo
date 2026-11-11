import { type LabNode, type LabView, labEffects, labNodeStatus, nodeNextGain, nodeTotal, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { segments } from '../src/lab/board/LabBoard';
import { LabScreen } from '../src/lab/LabScreen';
import { jsonResponse, LocationProbe, mockApi, renderAt } from './render';

// The Laboratorio's whiteboard (shop and lab plan, F3): the default view, both cores while a season is open, every node
// a button that says its level and state, its ring one segment per level; a node opens its panel (now and next level,
// cost, «Mejorar»), from the keyboard too; a seasonal node buys naming its season; the list stays one press away.

const t = copy.lab;
const tb = copy.lab.board;
afterEach(() => vi.unstubAllGlobals());
const cfg = parseConfig('lab', {
  season: [
    { id: 'swarm-hunt', branch: 'probe', name: 'Cazador del enjambre', effect: { kind: 'stat', stat: 'damage' }, per: 0.03, max: 3, requires: null, cost: { dust: 30, components: 10 }, growth: 1.5 },
    { id: 'swarm-reap', branch: 'extraction', name: 'Cosecha', effect: { kind: 'payout', currency: 'dust' }, per: 0.04, max: 3, requires: 'swarm-hunt', cost: { dust: 40, components: 10 }, growth: 1.5 },
  ],
});

const nodeView = (n: LabNode, levels: Record<string, number>, tree: LabNode[]) => {
  const status = labNodeStatus(n, levels, tree);
  return { id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...status, now: nodeTotal(n, status.level), nextGain: nodeNextGain(n, status.level), at: n.at };
};

function view(levels: Record<string, number> = {}, over: Partial<LabView> = {}, seasonLevels: Record<string, number> = {}): LabView {
  return {
    open: true,
    nodes: cfg.nodes.map((n) => nodeView(n, levels, cfg.nodes)),
    season: { id: 'season-2', name: 'Temporada 2', endsAt: '2027-01-04T23:00:00.000Z', nodes: cfg.season.map((n) => nodeView(n, seasonLevels, cfg.season)) },
    effects: labEffects(levels, cfg, seasonLevels),
    wallet: { coins: 0, dust: 500, signal: 0, components: 200 },
    ...over,
  };
}

function open(v: LabView, routes: Record<string, (b: unknown) => Response> = {}) {
  const fetch = mockApi({
    'GET /galaxy/api/lab': () => jsonResponse(200, v),
    'GET /galaxy/api/redshift': () => jsonResponse(200, { rank: 0, maxRank: 5, minLevel: 25, level: 3, labLevels: 0, needed: 10, eligible: false, bonus: { xp: 0, luck: 0 }, next: null }),
    ...routes,
  });
  renderAt('/laboratorio', { '/laboratorio': <><LabScreen /><LocationProbe /></> });
  return fetch;
}
const nodeButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, nivel`) });

test('la pizarra es la vista de siempre: los dos núcleos y cada nodo con su nivel y su estado', async () => {
  open(view({ hull: 2 }, {}, { 'swarm-hunt': 1 }));
  expect(await screen.findByRole('group', { name: tb.label })).toBeInTheDocument();
  expect(nodeButton('Blindaje reforzado')).toHaveAccessibleName(tb.node('Blindaje reforzado', 2, 5, tb.states.affordable));
  expect(nodeButton('Propulsores')).toHaveAccessibleName(tb.node('Propulsores', 0, 5, tb.states.affordable));
  expect(nodeButton('Reactor')).toHaveAccessibleName(tb.node('Reactor', 0, 5, tb.states.locked));
  expect(nodeButton('Cazador del enjambre')).toHaveAccessibleName(tb.node('Cazador del enjambre', 1, 3, tb.states.affordable));
  // Both cores, the season's with the day it restarts; and the rings by level.
  expect(screen.getByText(tb.permanent, { selector: 'text' })).toBeInTheDocument();
  expect(screen.getByText('Temporada 2', { selector: 'text' })).toBeInTheDocument();
  const ring = nodeButton('Blindaje reforzado').querySelector('.lab-ring')!;
  expect(ring.getAttribute('stroke-dasharray')).toBe(segments(2, 5));
  expect(ring.getAttribute('pathLength')).toBe('5');
  expect(screen.getAllByRole('button', { name: /, nivel \d+ de \d+, / })).toHaveLength(18);
});

test('sin temporada abierta solo está el núcleo permanente', async () => {
  open(view({}, { season: null }));
  await screen.findByRole('group', { name: tb.label });
  expect(screen.queryByText('Temporada 2', { selector: 'text' })).toBeNull();
  expect(screen.queryByRole('button', { name: tb.season })).toBeNull();
  expect(screen.getAllByRole('button', { name: /, nivel \d+ de \d+, / })).toHaveLength(16);
});

test('un nodo abre su panel con lo que da ahora y al siguiente nivel, su coste y Mejorar', async () => {
  const fetch = open(view({ hull: 2 }), { 'POST /galaxy/api/lab/nodes/hull/upgrade': () => jsonResponse(200, view({ hull: 3 })) });
  fireEvent.click(await screen.findByRole('button', { name: /^Blindaje reforzado, nivel/ }));
  const panel = screen.getByRole('complementary', { name: 'Blindaje reforzado' });
  expect(within(panel).getByText(tb.gain('stat', 0.04))).toBeInTheDocument();
  expect(within(panel).getByText(tb.gain('stat', 0.06))).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: t.upgrade(3) }));
  await waitFor(() => {
    const call = fetch.mock.calls.find(([url]) => url === '/galaxy/api/lab/nodes/hull/upgrade');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ level: 3 });
  });
  expect(await screen.findByRole('button', { name: tb.node('Blindaje reforzado', 3, 5, tb.states.affordable) })).toBeInTheDocument();
});

test('un nodo de temporada se mejora nombrando su temporada', async () => {
  const fetch = open(view({}, {}, {}), { 'POST /galaxy/api/lab/nodes/swarm-hunt/upgrade': () => jsonResponse(200, view({}, {}, { 'swarm-hunt': 1 })) });
  fireEvent.click(await screen.findByRole('button', { name: /^Cazador del enjambre, nivel/ }));
  const panel = screen.getByRole('complementary', { name: 'Cazador del enjambre' });
  expect(within(panel).getByText(tb.resets('5 de enero'))).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: t.upgrade(1) }));
  await waitFor(() => {
    const call = fetch.mock.calls.find(([url]) => url === '/galaxy/api/lab/nodes/swarm-hunt/upgrade');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ level: 1, season: 'season-2' });
  });
});

test('bloqueado o sin material, el botón lo dice y no se pulsa', async () => {
  open(view({}, { wallet: { coins: 0, dust: 5, signal: 0, components: 0 } }));
  fireEvent.click(await screen.findByRole('button', { name: /^Reactor, nivel/ }));
  expect(within(screen.getByRole('complementary', { name: 'Reactor' })).getByRole('button', { name: tb.locked })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /^Blindaje reforzado, nivel/ }));
  const panel = screen.getByRole('complementary', { name: 'Blindaje reforzado' });
  expect(within(panel).getByRole('button', { name: tb.short })).toBeDisabled();
  expect(within(panel).getByText(t.missing(35, 15))).toBeInTheDocument();
});

test('con el teclado: Intro abre el panel, Escape lo cierra y devuelve el foco', async () => {
  open(view());
  const node = await screen.findByRole('button', { name: /^Blindaje reforzado, nivel/ });
  node.focus();
  fireEvent.keyDown(node, { key: 'Enter' });
  expect(screen.getByRole('complementary', { name: 'Blindaje reforzado' })).toBeInTheDocument();
  fireEvent.keyDown(node, { key: 'Escape' });
  expect(screen.queryByRole('complementary', { name: 'Blindaje reforzado' })).toBeNull();
  expect(node).toHaveFocus();
});

test('la leyenda se abre y la lista está a un botón, en la dirección', async () => {
  open(view());
  await screen.findByRole('group', { name: tb.label });
  fireEvent.click(screen.getByRole('button', { name: tb.legend }));
  expect(screen.getByRole('heading', { name: tb.legendTitle })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: tb.views.list }));
  expect(screen.getByTestId('location').textContent).toContain('vista=lista');
  expect(await screen.findByRole('list', { name: t.branches.probe })).toBeInTheDocument();
});

test('cerrado, ni pizarra ni lista: lleva a la estación', async () => {
  open(view({}, { open: false }));
  expect(await screen.findByText(copy.errors.lab_closed)).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: tb.label })).toBeNull();
});
