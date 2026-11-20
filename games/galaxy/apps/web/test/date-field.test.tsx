import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { DateField } from '../src/ui/DateField';
import { Dialog } from '../src/ui/Dialog';

// The admin's dates without the system's calendar (C1, decision 10 of the November plan): a field that takes the date
// written in Spanish (or pasted as ISO) and a button that opens the game's own calendar, after the WAI-ARIA APG date
// picker dialog: arrows, Home and End, the pages for months, Enter, Escape (without closing the dialog around it), Hoy,
// and the hour and minutes when the field has a time. The value keeps the format of the native inputs it replaces.

const t = copy.picker;
const dayName = (y: number, m: number, d: number) => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y, m - 1, d));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 12, 9, 30));
});
afterEach(() => vi.useRealTimers());

function Day({ value = '', time = false, onPick }: { value?: string; time?: boolean; onPick?: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <>
      <label htmlFor="dia">Desde</label>
      <DateField
        id="dia"
        time={time}
        value={v}
        onChange={(x) => {
          onPick?.(x);
          setV(x);
        }}
      />
      <output data-testid="valor">{v}</output>
      <button type="button">Después</button>
    </>
  );
}

const field = () => screen.getByLabelText('Desde');
const valueNow = () => screen.getByTestId('valor').textContent;
const opener = (time = false) => screen.getByRole('button', { name: time ? t.openTime : t.open });
const calendar = () => screen.getByRole('dialog', { name: t.title });

test('enseña la fecha en español y se escribe a mano, también en ISO', async () => {
  const user = userEvent.setup();
  render(<Day value="2026-11-03" />);
  expect(field()).toHaveValue('03/11/2026');
  expect(field()).toHaveAttribute('placeholder', t.datePlaceholder);
  await user.clear(field());
  expect(valueNow()).toBe('');
  await user.type(field(), '25/12/2026');
  expect(valueNow()).toBe('2026-12-25');
  await user.clear(field());
  await user.type(field(), '31/02/2026');
  expect(valueNow()).toBe('');
  await user.clear(field());
  await user.type(field(), '2026-01-05');
  expect(valueNow()).toBe('2026-01-05');
  await user.tab();
  expect(field()).toHaveValue('05/01/2026');
});

test('el calendario empieza en el día elegido; las flechas, Inicio, Fin y las páginas lo recorren e Intro elige', async () => {
  const user = userEvent.setup();
  render(<Day value="2026-11-03" />);
  await user.click(opener());
  const cal = calendar();
  expect(opener()).toHaveAttribute('aria-expanded', 'true');
  expect(within(cal).getByRole('heading', { name: 'Noviembre de 2026' })).toBeInTheDocument();
  expect(within(cal).getByRole('grid', { name: 'Noviembre de 2026' })).toBeInTheDocument();
  expect(within(cal).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 3) })).toHaveFocus();
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 3) })).toHaveAttribute('aria-pressed', 'true');
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 12) })).toHaveAttribute('aria-current', 'date');
  await user.keyboard('{ArrowRight}');
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 4) })).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 11) })).toHaveFocus();
  await user.keyboard('{PageDown}');
  expect(within(cal).getByRole('heading', { name: 'Diciembre de 2026' })).toBeInTheDocument();
  expect(within(cal).getByRole('button', { name: dayName(2026, 12, 11) })).toHaveFocus();
  // The 11th of December 2026 is a Friday: Home goes to that Monday, End to that Sunday.
  await user.keyboard('{Home}');
  expect(within(cal).getByRole('button', { name: dayName(2026, 12, 7) })).toHaveFocus();
  await user.keyboard('{End}');
  expect(within(cal).getByRole('button', { name: dayName(2026, 12, 13) })).toHaveFocus();
  await user.keyboard('{ArrowLeft}{PageUp}');
  expect(within(cal).getByRole('button', { name: dayName(2026, 11, 12) })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(valueNow()).toBe('2026-11-12');
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
  expect(opener()).toHaveFocus();
  expect(field()).toHaveValue('12/11/2026');
});

test('sin fecha empieza en hoy, y «Hoy» la elige', async () => {
  const user = userEvent.setup();
  render(<Day />);
  await user.click(opener());
  expect(within(calendar()).getByRole('button', { name: dayName(2026, 11, 12) })).toHaveFocus();
  await user.click(within(calendar()).getByRole('button', { name: t.today }));
  expect(valueNow()).toBe('2026-11-12');
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
});

test('con el ratón cambia de mes y elige un día', async () => {
  const user = userEvent.setup();
  render(<Day value="2026-11-03" />);
  await user.click(opener());
  await user.click(within(calendar()).getByRole('button', { name: t.nextMonth }));
  expect(within(calendar()).getByRole('heading', { name: 'Diciembre de 2026' })).toBeInTheDocument();
  await user.click(within(calendar()).getByRole('button', { name: t.prevMonth }));
  await user.click(within(calendar()).getByRole('button', { name: t.prevMonth }));
  expect(within(calendar()).getByRole('heading', { name: 'Octubre de 2026' })).toBeInTheDocument();
  await user.click(within(calendar()).getByRole('button', { name: dayName(2026, 10, 24) }));
  expect(valueNow()).toBe('2026-10-24');
});

test('Escape cierra el calendario sin cerrar el diálogo que lo contiene; una pulsación fuera también lo cierra', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(
    <Dialog title="Auditoría" onClose={onClose}>
      <Day value="2026-11-03" />
    </Dialog>,
  );
  await user.click(opener());
  await user.keyboard('{ArrowRight}{Escape}');
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(valueNow()).toBe('2026-11-03');
  expect(opener()).toHaveFocus();
  await user.click(opener());
  await user.click(screen.getByRole('heading', { name: 'Auditoría' }));
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

test('Tab no sale del calendario abierto', async () => {
  const user = userEvent.setup();
  render(<Day value="2026-11-03" />);
  await user.click(opener());
  const cal = calendar();
  const prev = within(cal).getByRole('button', { name: t.prevMonth });
  const today = within(cal).getByRole('button', { name: t.today });
  today.focus();
  await user.tab();
  expect(prev).toHaveFocus();
  await user.tab({ shift: true });
  expect(today).toHaveFocus();
});

test('con hora: elige el día, la hora y los minutos sin cerrarse hasta «Listo»', async () => {
  const user = userEvent.setup();
  render(<Day time value="2026-11-03T10:15" />);
  expect(field()).toHaveValue('03/11/2026 10:15');
  expect(field()).toHaveAttribute('placeholder', t.dateTimePlaceholder);
  await user.click(opener(true));
  const cal = calendar();
  await user.click(within(cal).getByRole('button', { name: dayName(2026, 11, 5) }));
  expect(valueNow()).toBe('2026-11-05T10:15');
  expect(calendar()).toBeInTheDocument();
  const hour = within(cal).getByRole('spinbutton', { name: t.hour });
  const minute = within(cal).getByRole('spinbutton', { name: t.minute });
  expect(hour).toHaveValue('10');
  await user.clear(hour);
  await user.type(hour, '18');
  expect(valueNow()).toBe('2026-11-05T18:15');
  minute.focus();
  await user.keyboard('{ArrowUp}');
  expect(valueNow()).toBe('2026-11-05T18:16');
  await user.keyboard('{ArrowDown}{ArrowDown}');
  expect(valueNow()).toBe('2026-11-05T18:14');
  await user.click(within(cal).getByRole('button', { name: t.done }));
  expect(screen.queryByRole('dialog', { name: t.title })).toBeNull();
  expect(field()).toHaveValue('05/11/2026 18:14');
});

test('con hora: se escribe a mano, y sin la hora no vale', async () => {
  const user = userEvent.setup();
  render(<Day time />);
  await user.type(field(), '01/12/2026 7:05');
  expect(valueNow()).toBe('2026-12-01T07:05');
  await user.clear(field());
  await user.type(field(), '2026-11-09T10:00');
  expect(valueNow()).toBe('2026-11-09T10:00');
  await user.clear(field());
  await user.type(field(), '01/12/2026');
  expect(valueNow()).toBe('');
});

test('con hora y sin fecha, elegir un día empieza a las 00:00', async () => {
  const user = userEvent.setup();
  render(<Day time />);
  await user.click(opener(true));
  await user.click(within(calendar()).getByRole('button', { name: dayName(2026, 11, 20) }));
  expect(valueNow()).toBe('2026-11-20T00:00');
});
