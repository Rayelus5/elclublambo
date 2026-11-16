import { configJsonSchema, type JsonSchema } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { ConfigForm } from '../src/admin/forms/ConfigForm';
import { fieldInfo } from '../src/admin/forms/labels';
import { itemsOf, kindOf, unwrap } from '../src/admin/forms/schema';
import { pickOption } from './pick';

// The form engine for the run content (the content editor, 2026-11-16, P3): tuples ([min, max], a pair of elements),
// unions of fixed values (4 | 8, a stat or «vision»), unions of objects told apart by their key ({passive} | {element}),
// labels per variant («shooter»'s range) that fall back to the plain field's, and widgets that replace a field.

const content = configJsonSchema('content');
const props = (node: JsonSchema | undefined) => node?.properties ?? {};
const weapon = itemsOf(content.properties!.weapons!);
const sector = itemsOf(content.properties!.sectors!);

test('una tupla, una unión de valores fijos y una unión de objetos tienen su tipo', () => {
  expect(kindOf(props(itemsOf(props(sector).spawns!)).group!)).toBe('tuple');
  const unlockAt = unwrap(props(props(weapon).variant).unlockAt!).node;
  expect(kindOf(unlockAt)).toBe('enum');
  expect(unlockAt.enum).toEqual([4, 8]);
  const stat = unwrap(props(content.properties!.relics!.properties!.backgrounds!.additionalProperties as JsonSchema).stat!).node;
  expect(kindOf(stat)).toBe('enum');
  expect(stat.enum).toContain('vision');
  expect(stat.enum).toContain('damage');
  expect(kindOf(unwrap(props(props(weapon).evolution).requires!).node)).toBe('choice');
});

/** A form over one part of the content, kept in state like the editor does. */
type FormProps = Parameters<typeof ConfigForm>[0];
function Harness({ schema, start, prefix, widgets, describe, options = {} }: { schema: JsonSchema; start: unknown; prefix: string; widgets?: FormProps['widgets']; describe?: FormProps['describe']; options?: FormProps['options'] }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <ConfigForm cfgKey="content" schema={schema} value={value} onChange={setValue} issues={new Map()} options={options} prefix={prefix} widgets={widgets} describe={describe} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
const valueNow = () => JSON.parse(screen.getByTestId('value').textContent ?? 'null') as Record<string, unknown>;

test('una tupla [mín, máx] se edita casilla a casilla', () => {
  const spawn = itemsOf(props(sector).spawns!);
  render(<Harness schema={spawn} start={{ ...DEFAULT_CONTENT.sectors[0]!.spawns[0]! }} prefix="sectors[].spawns[]" />);
  const group = screen.getByRole('group', { name: fieldInfo('content', 'sectors[].spawns[].group').label });
  const inputs = within(group).getAllByRole('textbox');
  expect(inputs).toHaveLength(2);
  fireEvent.change(inputs[1]!, { target: { value: '9' } });
  expect((valueNow().group as number[])[1]).toBe(9);
});

test('una unión de números se elige y guarda un número, no un texto', async () => {
  const variant = props(weapon).variant!;
  render(<Harness schema={{ type: 'object', properties: { variant } }} start={{ variant: { of: 'pulse', unlockAt: 4 } }} prefix="weapons[]" />);
  await pickOption(userEvent.setup(), screen.getByRole('combobox', { name: fieldInfo('content', 'weapons[].variant.unlockAt').label }), '8');
  expect((valueNow().variant as { unlockAt: unknown }).unlockAt).toBe(8);
});

test('una unión de objetos elige su forma y cambia sus campos', async () => {
  const evolution = props(weapon).evolution!;
  render(<Harness schema={{ type: 'object', properties: { evolution } }} start={{ evolution: { from: 'pulse', requires: { passive: 'power' } } }} prefix="weapons[]" />);
  const which = screen.getByRole('combobox', { name: fieldInfo('content', 'weapons[].evolution.requires').label });
  await pickOption(userEvent.setup(), which, fieldInfo('content', 'weapons[].evolution.requires.element').label);
  expect((valueNow().evolution as { requires: Record<string, unknown> }).requires).toHaveProperty('element');
  expect((valueNow().evolution as { requires: Record<string, unknown> }).requires).not.toHaveProperty('passive');
});

test('la etiqueta de un campo de una variante cae a la del campo sin variante', () => {
  expect(fieldInfo('content', 'enemies[].behavior<shooter>.range')).toEqual(fieldInfo('content', 'enemies[].behavior.range'));
});

/** A widget made once, as the content editor's are. */
function Own({ value }: { value: unknown }) {
  return <p>propio {String(value)}</p>;
}

test('un control propio sustituye al de un campo', () => {
  render(
    <Harness
      schema={{ type: 'object', properties: { hitCap: content.properties!.hitCap! } }}
      start={{ hitCap: 0.4 }}
      prefix=""
      widgets={{ hitCap: Own }}
    />,
  );
  expect(screen.getByText('propio 0.4')).toBeInTheDocument();
});

test('las descripciones propias mandan, y una entrada con nombre se elige de su fuente', async () => {
  const palettes = content.properties!.elements!.properties!.palettes!;
  render(
    <Harness
      schema={{ type: 'object', properties: { palettes } }}
      start={{ palettes: {} }}
      prefix="elements"
      describe={(pattern) => (pattern === 'elements.palettes' ? { label: 'Paletas de las galaxias', options: 'trait:palette' } : undefined)}
      options={{ 'trait:palette': [{ value: 'ember', label: 'Brasa' }] }}
    />,
  );
  const list = screen.getByRole('region', { name: 'Paletas de las galaxias' });
  await pickOption(userEvent.setup(), within(list).getByRole('combobox'), 'Brasa');
  fireEvent.click(within(list).getByRole('button', { name: /Añadir/ }));
  expect(valueNow().palettes).toHaveProperty('ember');
});

