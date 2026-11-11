import { type LabNode, type LabView, labEffects, labNodeStatus, nodeNextGain, nodeTotal, parseConfig } from '@galaxy/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { copy } from '../src/copy/es';
import { LabScreen } from '../src/lab/LabScreen';
import { jsonResponse, mockApi, renderAt } from './render';

// The Laboratorio (GDD §10.6, M4b-2): closed until its room is repaired; four branches of nodes, each with what it
// adds per level, what it adds now, its pips and its next level with the cost and what is missing; a closed node says
// what opens it; buying sends the level with its key.

const t = copy.lab;
const cfg = parseConfig('lab', {});
/** A node as the server sends it. */
const nodeView = (n: LabNode, levels: Record<string, number>) => {
  const status = labNodeStatus(n, levels, cfg);
  return { id: n.id, branch: n.branch, name: n.name, effect: n.effect, per: n.per, requires: n.requires, ...status, now: nodeTotal(n, status.level), nextGain: nodeNextGain(n, status.level), at: n.at };
};

/** The view of an account with these node levels and this wallet. */
function view(levels: Record<string, number> = {}, over: Partial<LabView> = {}): LabView {
  return {
    open: true,
    nodes: cfg.nodes.map((n) => nodeView(n, levels)),
    season: null,
    effects: labEffects(levels, cfg),
    wallet: { coins: 0, dust: 500, signal: 0, components: 200 },
    ...over,
  };
}
const open = (v = view(), routes: Record<string, (b: unknown) => Response> = {}) => {
  const fetch = mockApi({ 'GET /galaxy/api/lab': () => jsonResponse(200, v), ...routes });
  renderAt('/laboratorio?vista=lista', { '/laboratorio': <LabScreen /> });
  return fetch;
};
const card = (name: string) => screen.getByText(name, { selector: 'b' }).closest('li')!;

test('cerrado, dice que hay que repararlo y lleva a la estación', async () => {
  open(view({}, { open: false }));
  expect(await screen.findByText(copy.errors.lab_closed)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: t.goStation })).toHaveAttribute('href', '/estacion');
  expect(screen.queryByRole('list', { name: t.branches.probe })).toBeNull();
});

test('abierto: cuatro ramas de cuatro nodos, cada uno con lo que da, sus pips y su mejora con coste', async () => {
  open(view({ hull: 2 }));
  for (const branch of ['probe', 'relics', 'station', 'extraction'] as const) {
    const list = await screen.findByRole('list', { name: t.branches[branch] });
    expect(within(list).getAllByRole('listitem'), branch).toHaveLength(4);
  }
  const hull = card('Blindaje reforzado');
  expect(hull).toHaveTextContent(t.effect({ kind: 'stat', stat: 'maxHp' }, 0.02));
  expect(t.effect({ kind: 'stat', stat: 'maxHp' }, 0.02)).toBe('+2 % de vida por nivel');
  expect(hull).toHaveTextContent(t.now({ kind: 'stat', stat: 'maxHp' }, 0.04));
  expect(hull).toHaveTextContent(t.level(2, 5));
  const up = within(hull).getByRole('button', { name: new RegExp(t.upgrade(3)) });
  expect(up).toBeEnabled();
  expect(up).toHaveTextContent(t.cost(102, 38));
  // Other effects say what they do.
  expect(card('Caudal')).toHaveTextContent('La refinería va un 5 % más rápida por nivel');
  expect(card('Fusión estable')).toHaveTextContent('Fusionar cuesta un 4 % menos de polvo por nivel');
});

test('un nodo cerrado dice qué lo abre y no se mejora; uno al máximo lo dice', async () => {
  open(view({ magnet: 5 }));
  const thrusters = (await screen.findByText('Propulsores', { selector: 'b' })).closest('li')!;
  expect(thrusters).toHaveTextContent(t.needs('Blindaje reforzado'));
  expect(within(thrusters).queryByRole('button')).toBeNull();
  expect(card('Imán')).toHaveTextContent(t.maxed);
});

test('sin fondos el botón está desactivado y dice cuánto falta', async () => {
  open(view({}, { wallet: { coins: 0, dust: 10, signal: 0, components: 0 } }));
  const hull = (await screen.findByText('Blindaje reforzado', { selector: 'b' })).closest('li')!;
  expect(within(hull).getByRole('button', { name: new RegExp(t.upgrade(1)) })).toBeDisabled();
  expect(hull).toHaveTextContent(t.missing(30, 15));
});

test('mejorar envía el nivel con su clave y enseña la vista nueva; un 409 dice su texto y refresca', async () => {
  let views = 0;
  const fetch = mockApi({
    'GET /galaxy/api/lab': () => jsonResponse(200, views++ === 0 ? view() : view({ hull: 1 })),
    'POST /galaxy/api/lab/nodes/hull/upgrade': () => jsonResponse(200, view({ hull: 1 })),
    'POST /galaxy/api/lab/nodes/resonance/upgrade': () => jsonResponse(409, { error: 'lab_changed' }),
  });
  renderAt('/laboratorio?vista=lista', { '/laboratorio': <LabScreen /> });
  const hull = (await screen.findByText('Blindaje reforzado', { selector: 'b' })).closest('li')!;
  fireEvent.click(within(hull).getByRole('button', { name: new RegExp(t.upgrade(1)) }));
  await waitFor(() => expect(card('Blindaje reforzado')).toHaveTextContent(t.level(1, 5)));
  const call = fetch.mock.calls.find(([url, init]) => url === '/galaxy/api/lab/nodes/hull/upgrade' && init?.method === 'POST')!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({ level: 1 });
  expect((call[1]!.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  fireEvent.click(within(card('Resonancia')).getByRole('button', { name: new RegExp(t.upgrade(1)) }));
  expect(await screen.findByText(copy.errors.lab_changed)).toBeInTheDocument();
  await waitFor(() => expect(views).toBeGreaterThan(1));
});

test('lo que falta concuerda en número', () => {
  expect(t.missing(0, 1)).toBe('Te falta 1 componente');
  expect(t.missing(30, 15)).toBe('Te faltan 30 de polvo y 15 componentes');
  expect(copy.station.missing(1, 0)).toBe('Te falta 1 componente');
  expect(copy.station.missing(0, 1)).toBe('Te falta 1 moneda');
  expect(copy.station.missing(18, 0)).toBe('Te faltan 18 componentes');
});

test('cada nodo cuelga del que lo abre, también cuando su padre no es el último de la rama', async () => {
  open(view());
  const station = await screen.findByRole('list', { name: t.branches.station });
  const names = within(station).getAllByRole('listitem').map((li) => li.querySelector('b')!.textContent);
  expect(names).toEqual(['Caudal', 'Silos', 'Chatarrería', 'Receptor']);
  // Chatarrería (needs Silos) is inside Silos's item, Receptor (needs Caudal) is not.
  const silos = card('Silos');
  expect(within(silos).getByText('Chatarrería', { selector: 'b' })).toBeInTheDocument();
  expect(within(silos).queryByText('Receptor', { selector: 'b' })).toBeNull();
  const ledger = card('Contabilidad');
  expect(within(ledger).getByText('Estudio', { selector: 'b' })).toBeInTheDocument();
});
