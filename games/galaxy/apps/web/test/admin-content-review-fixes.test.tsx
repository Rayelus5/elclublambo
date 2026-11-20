import { configIssues, configJsonSchema, type DraftView, type MeResponse, parseConfig } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { clock } from '../src/admin/content/Charts';
import { ContentScreen } from '../src/admin/content/ContentScreen';
import { uniqueId } from '../src/admin/content/ContentEditor';
import { ConfigForm } from '../src/admin/forms/ConfigForm';
import { itemsOf } from '../src/admin/forms/schema';
import { drawableId } from '../src/arena/sprites';
import { copy } from '../src/copy/es';
import { Select } from '../src/ui/Select';
import { jsonResponse, mockApi, renderAt } from './render';

// What the independent review of the content editor found (P4–P6, 2026-11-16), each proved fixed.
afterEach(() => vi.unstubAllGlobals());

const t = copy.admin.content;
const admin: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const live = parseConfig('content', {});
const draft = (content: Record<string, unknown> = {}): DraftView => ({
  id: 'd1',
  title: 'Revisión',
  status: 'open',
  revision: 1,
  fields: [],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  stale: false,
  data: { content },
  baseVersions: {},
  publishedVersions: null,
});
function open(path: string, content: Record<string, unknown> = {}) {
  mockApi({
    'GET /galaxy/api/auth/me': () => jsonResponse(200, admin),
    'GET /galaxy/api/admin/config/content': () => jsonResponse(200, { key: 'content', version: 4, data: live, createdAt: null, author: null, note: null }),
    'GET /galaxy/api/admin/config/content/versions': () => jsonResponse(200, []),
    'GET /galaxy/api/admin/config-drafts/d1': () => jsonResponse(200, draft(content)),
    'PUT /galaxy/api/admin/config-drafts/d1/field': () => jsonResponse(200, { ...draft(content), revision: 2 }),
  });
  renderAt(`/admin/configuracion/content?borrador=d1&${path}`, { '/admin/configuracion/content': <ContentScreen /> });
}

test('una entrada nueva sigue abierta al cambiar su nombre o su identificador', async () => {
  open('zona=fauna&lista=enemies');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Añadir/ }));
  expect(await screen.findByRole('heading', { name: t.newEntity })).toBeInTheDocument();
  const name = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === t.newEntity)!;
  fireEvent.change(name, { target: { value: 'Ácaro gigante' } });
  expect(screen.getByRole('heading', { name: 'Ácaro gigante' })).toBeInTheDocument();
  const id = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === 'acaro-gigante')!;
  fireEvent.change(id, { target: { value: 'acaro-grande' } });
  expect(screen.getByRole('heading', { name: 'Ácaro gigante' })).toBeInTheDocument();
});

test('un identificador libre siempre se encuentra, sin pasar de 32 letras', () => {
  const long = 'catapulta-de-singularidad-copia';
  const taken = new Set([long, `${long.slice(0, 30)}-2`, `${long.slice(0, 30)}-3`]);
  const id = uniqueId(long, (x) => taken.has(x));
  expect(taken.has(id)).toBe(false);
  expect(id.length).toBeLessThanOrEqual(32);
  expect(uniqueId('', () => false)).toBe('nueva-entrada');
});

test('un borrador con listas rotas no rompe el editor', async () => {
  open('zona=arsenal', { weapons: {}, bosses: 'x', enemies: [null] });
  expect(await screen.findByRole('tablist', { name: t.areas })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('tab', { name: 'Sectores' }));
  expect(screen.getByRole('tablist', { name: t.areas })).toBeInTheDocument();
});

test('una clave que el contenido no tiene no abre una zona «Otros» que rompa', async () => {
  open('', { zz: 1 });
  expect(await screen.findByRole('tablist', { name: t.areas })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: t.others })).toBeNull();
});

test('«constructor» no pasa por un dibujo', () => {
  const c = structuredClone(DEFAULT_CONTENT);
  c.enemies[0]!.sprite = 'constructor';
  expect(configIssues('content', c)).toContainEqual({ path: 'enemies.0.sprite', message: 'content_art:constructor' });
  expect(drawableId('constructor', 'mite')).toBe('mite');
  expect(drawableId('toString', 'mite', (x) => Object.hasOwn({ mite: 1 }, x))).toBe('mite');
});

test('una elección solo ofrece los valores que el campo admite', async () => {
  const passive = itemsOf(configJsonSchema('content').properties!.passives!);
  const start = DEFAULT_CONTENT.passives[0]!;
  const options = { 'vocab:stat': [...['maxHp', 'damage', 'vision'].map((v) => ({ value: v, label: v }))] };
  const describe = (p: string) => (p === 'passives[].stat' ? { label: 'Estadística', hint: 'h', options: 'vocab:stat' } : undefined);
  function Harness() {
    const [value, setValue] = useState<unknown>(start);
    return <ConfigForm cfgKey="content" schema={passive} value={value} onChange={setValue} issues={new Map()} options={options} prefix="passives[]" describe={describe} />;
  }
  render(<Harness />);
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Estadística' }));
  expect(screen.getByRole('option', { name: 'damage' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'vision' })).toBeNull();
});

test('la explicación de una opción la describe y no forma parte de su nombre', async () => {
  render(<Select aria-label="Planeta" value="a" onChange={() => {}} options={[{ value: 'a', label: 'Marte', hint: 'Rojo' }, { value: 'b', label: 'Venus' }]} />);
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Planeta' }));
  const marte = screen.getByRole('option', { name: 'Marte' });
  expect(marte).toHaveAccessibleDescription('Rojo');
});

test('con el JSON a medio escribir no se vuelve al editor ni se pierde lo escrito', async () => {
  open('');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: t.jsonTab }));
  const json = screen.getByRole('textbox', { name: copy.admin.drafts.json });
  fireEvent.change(json, { target: { value: '{ "hitCap": ' } });
  expect(screen.getByRole('tab', { name: t.visualTab })).toBeDisabled();
  await user.click(screen.getByRole('tab', { name: t.jsonTab }));
  expect(screen.getByRole('textbox', { name: copy.admin.drafts.json })).toHaveValue('{ "hitCap": ');
  expect(within(screen.getByRole('tablist', { name: t.modes })).getAllByRole('tab')).toHaveLength(2);
});

test('el reloj de los gráficos nunca dice 60 segundos', () => {
  expect(clock(59.6)).toBe('1:00');
  expect(clock(119.5)).toBe('2:00');
  expect(clock(75)).toBe('1:15');
});
