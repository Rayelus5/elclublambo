import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Dialog } from '../src/ui/Dialog';
import { typing } from '../src/ui/keys';
import { Select, type SelectOption } from '../src/ui/Select';
import { pickOption } from './pick';

// The game's own dropdown (C1, the owner: «nunca con diseño por defecto del ordenador»): a select-only combobox after
// the WAI-ARIA APG pattern, with its keyboard (arrows, Home and End, pages, type-ahead, Enter, Space, Escape, Tab), the
// mouse, disabled options, the aria wiring and the hidden input of a form.

const PLANETS: SelectOption[] = [
  { value: 'mercurio', label: 'Mercurio' },
  { value: 'venus', label: 'Venus' },
  { value: 'tierra', label: 'Tierra' },
  { value: 'marte', label: 'Marte' },
  { value: 'jupiter', label: 'Júpiter', disabled: true },
  { value: 'saturno', label: 'Saturno' },
  { value: 'urano', label: 'Urano' },
  { value: 'neptuno', label: 'Neptuno' },
];

type Props = Partial<ComponentProps<typeof Select>> & { onPick?: (v: string) => void };

function Planet({ onPick, value = 'tierra', options = PLANETS, ...rest }: Props) {
  const [v, setV] = useState(value);
  return (
    <>
      <label htmlFor="planeta">Planeta</label>
      <Select
        id="planeta"
        value={v}
        options={options}
        onChange={(x) => {
          onPick?.(x);
          setV(x);
        }}
        {...rest}
      />
      <button type="button">Después</button>
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Planeta' });
const active = () => {
  const id = box().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : null;
};

test('el desplegable se nombra por su etiqueta, enseña el valor y conecta su lista al abrirse', async () => {
  const user = userEvent.setup();
  render(<Planet />);
  const combo = box();
  expect(combo).toHaveAttribute('aria-haspopup', 'listbox');
  expect(combo).toHaveAttribute('aria-expanded', 'false');
  expect(combo).not.toHaveAttribute('aria-activedescendant');
  expect(combo).toHaveTextContent('Tierra');
  expect(screen.queryByRole('listbox')).toBeNull();

  await user.click(combo);
  expect(combo).toHaveAttribute('aria-expanded', 'true');
  const list = screen.getByRole('listbox', { name: 'Planeta' });
  expect(combo).toHaveAttribute('aria-controls', list.id);
  const options = within(list).getAllByRole('option');
  expect(options).toHaveLength(8);
  expect(within(list).getByRole('option', { name: 'Tierra' })).toHaveAttribute('aria-selected', 'true');
  expect(within(list).getByRole('option', { name: 'Venus' })).toHaveAttribute('aria-selected', 'false');
  expect(within(list).getByRole('option', { name: 'Júpiter' })).toHaveAttribute('aria-disabled', 'true');
  expect(combo).toHaveAttribute('aria-activedescendant', within(list).getByRole('option', { name: 'Tierra' }).id);
  expect(combo).toHaveFocus();
});

test('también se nombra con aria-label o aria-labelledby', () => {
  render(
    <>
      <span id="otro">Órbita</span>
      <Select aria-label="Luna" value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />
      <Select aria-labelledby="otro" value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />
    </>,
  );
  expect(screen.getByRole('combobox', { name: 'Luna' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Órbita' })).toBeInTheDocument();
});

test('con el teclado: la flecha abre sin cambiar nada, las flechas recorren saltando lo deshabilitado e Intro elige', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  box().focus();
  await user.keyboard('{ArrowDown}');
  expect(box()).toHaveAttribute('aria-expanded', 'true');
  expect(active()).toBe('Tierra');
  await user.keyboard('{ArrowDown}');
  expect(active()).toBe('Marte');
  await user.keyboard('{ArrowDown}');
  expect(active()).toBe('Saturno');
  await user.keyboard('{ArrowUp}');
  expect(active()).toBe('Marte');
  expect(onPick).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('marte');
  expect(box()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(box()).toHaveTextContent('Marte');
  expect(box()).toHaveFocus();
});

test('Intro, Espacio, la flecha arriba y Alt+abajo abren; Espacio también elige', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  box().focus();
  for (const key of ['{Enter}', '{ }', '{ArrowUp}', '{Alt>}{ArrowDown}{/Alt}']) {
    await user.keyboard(key);
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe('Tierra');
    await user.keyboard('{Escape}');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  }
  await user.keyboard('{ }{ArrowUp}{ }');
  expect(onPick).toHaveBeenCalledWith('venus');
  expect(box()).toHaveAttribute('aria-expanded', 'false');
});

test('Inicio y Fin van a la primera y la última, también con la lista cerrada; las páginas saltan de diez en diez', async () => {
  const user = userEvent.setup();
  render(<Planet />);
  box().focus();
  await user.keyboard('{End}');
  expect(box()).toHaveAttribute('aria-expanded', 'true');
  expect(active()).toBe('Neptuno');
  await user.keyboard('{Home}');
  expect(active()).toBe('Mercurio');
  await user.keyboard('{ArrowUp}');
  expect(active()).toBe('Mercurio');
  await user.keyboard('{PageDown}');
  expect(active()).toBe('Neptuno');
  await user.keyboard('{PageUp}');
  expect(active()).toBe('Mercurio');
  await user.keyboard('{Escape}{Home}');
  expect(active()).toBe('Mercurio');
});

test('Escape cierra la lista sin elegir y no cierra el diálogo que la contiene', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onPick = vi.fn();
  render(
    <Dialog title="Fusión" onClose={onClose}>
      <Planet onPick={onPick} />
    </Dialog>,
  );
  box().focus();
  await user.keyboard('{ArrowDown}{ArrowDown}{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(box()).toHaveTextContent('Tierra');
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Tab elige la opción activa y sigue al siguiente control', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  box().focus();
  await user.keyboard('{ArrowDown}{ArrowUp}');
  await user.tab();
  expect(onPick).toHaveBeenCalledWith('venus');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus();
});

test('buscar al escribir: salta a la siguiente que empieza así, sin acentos ni mayúsculas, y repetir la letra recorre', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  box().focus();
  await user.keyboard('m');
  expect(box()).toHaveAttribute('aria-expanded', 'true');
  expect(active()).toBe('Marte');
  await user.keyboard('m');
  expect(active()).toBe('Mercurio');
  await user.keyboard('{Escape}');
  await new Promise((r) => setTimeout(r, 600));
  await user.keyboard('NE');
  expect(active()).toBe('Neptuno');
  // Júpiter is disabled: typing its letter finds nothing and the active one stays.
  await new Promise((r) => setTimeout(r, 600));
  await user.keyboard('j');
  expect(active()).toBe('Neptuno');
  expect(onPick).not.toHaveBeenCalled();
});

test('buscar al escribir no distingue acentos', async () => {
  const user = userEvent.setup();
  render(
    <Planet
      value="c"
      options={[
        { value: 'c', label: 'Común' },
        { value: 'e', label: 'Épica' },
        { value: 'l', label: 'Legendaria' },
      ]}
    />,
  );
  box().focus();
  await user.keyboard('ep');
  expect(active()).toBe('Épica');
});

test('con el ratón: abre, elige una opción, ignora las deshabilitadas y se cierra al pulsar fuera', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  await user.click(box());
  await user.hover(screen.getByRole('option', { name: 'Urano' }));
  expect(active()).toBe('Urano');
  await user.click(screen.getByRole('option', { name: 'Júpiter' }));
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: 'Venus' }));
  expect(onPick).toHaveBeenCalledWith('venus');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(box()).toHaveTextContent('Venus');
  expect(box()).toHaveFocus();

  await user.click(box());
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await user.click(box());
  expect(screen.queryByRole('listbox')).toBeNull();

  await user.click(box());
  await user.click(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onPick).toHaveBeenCalledTimes(1);
});

test('pulsar la etiqueta abre la lista', async () => {
  const user = userEvent.setup();
  render(<Planet />);
  await user.click(screen.getByText('Planeta'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('elegir el mismo valor no avisa de un cambio', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  await pickOption(user, box(), 'Tierra');
  expect(onPick).not.toHaveBeenCalled();
});

test('deshabilitado no se abre', async () => {
  const user = userEvent.setup();
  render(<Planet disabled />);
  expect(box()).toBeDisabled();
  await user.click(box());
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('con name lleva un campo oculto con el valor para el formulario, e Intro no envía el formulario', async () => {
  const user = userEvent.setup();
  const submit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(
    <form aria-label="Viaje" onSubmit={submit}>
      <Planet name="planeta" />
    </form>,
  );
  const form = screen.getByRole('form', { name: 'Viaje' }) as HTMLFormElement;
  expect(new FormData(form).get('planeta')).toBe('tierra');
  box().focus();
  await user.keyboard('{Enter}');
  expect(submit).not.toHaveBeenCalled();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(new FormData(form).get('planeta')).toBe('marte');
  expect(submit).not.toHaveBeenCalled();
});

test('sin una opción con ese valor enseña el texto de relleno', () => {
  render(<Planet value="pluton" placeholder="Elige un planeta" />);
  expect(box()).toHaveTextContent('Elige un planeta');
});

test('la ayuda de los tests elige por el nombre visible o por el valor', async () => {
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(<Planet onPick={onPick} />);
  await pickOption(user, box(), 'Saturno');
  await pickOption(user, box(), 'urano');
  expect(onPick.mock.calls).toEqual([['saturno'], ['urano']]);
});

test('los atajos del juego no saltan con las letras que se escriben en el desplegable', () => {
  render(<Planet />);
  let typed: boolean | null = null;
  const listen = (e: KeyboardEvent) => (typed = typing(e));
  window.addEventListener('keydown', listen);
  box().dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
  window.removeEventListener('keydown', listen);
  expect(typed).toBe(true);
});
