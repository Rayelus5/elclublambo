import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Segmented } from '../src/ui/Segmented';
import { Slider } from '../src/ui/Slider';
import { Switch } from '../src/ui/Switch';

// The settings' own controls (plan «escáner pro», part A; the owner: «sliders, checkboxes o selectores, que tengan un
// estilo propio»): a styled native slider, a switch and a segmented choice, each with the keyboard and ARIA of its
// WAI-ARIA pattern.

test('el deslizador es un range nativo con nombre, texto del valor y relleno', () => {
  const onChange = vi.fn();
  render(
    <>
      <span id="l">Música</span>
      <Slider aria-labelledby="l" value={40} onChange={onChange} valueText={(v) => `${v} %`} />
    </>,
  );
  const input = screen.getByRole('slider', { name: 'Música' });
  expect(input).toHaveValue('40');
  expect(input).toHaveAttribute('aria-valuetext', '40 %');
  expect(screen.getByText('40 %')).toBeInTheDocument();
  expect(input.closest('.slider')).toHaveStyle({ '--fill': '40%' });
  fireEvent.change(input, { target: { value: '65' } });
  expect(onChange).toHaveBeenCalledWith(65);
});

test('el deslizador pone el relleno en proporción a su rango y se puede desactivar', () => {
  render(<Slider aria-label="Zoom" value={2} min={1} max={3} step={0.5} onChange={() => {}} disabled />);
  const input = screen.getByRole('slider', { name: 'Zoom' });
  expect(input).toBeDisabled();
  expect(input.closest('.slider')).toHaveStyle({ '--fill': '50%' });
});

test('el interruptor es un switch que cambia con clic y con el teclado', async () => {
  function Host() {
    const [on, setOn] = useState(false);
    return <Switch aria-label="Silenciar todo" checked={on} onChange={setOn} />;
  }
  render(<Host />);
  const sw = screen.getByRole('switch', { name: 'Silenciar todo' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(sw);
  expect(sw).toHaveAttribute('aria-checked', 'true');
  sw.focus();
  await userEvent.keyboard(' ');
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await userEvent.keyboard('{Enter}');
  expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('el interruptor desactivado no cambia', async () => {
  const onChange = vi.fn();
  render(<Switch aria-label="Sonidos" checked onChange={onChange} disabled />);
  await userEvent.click(screen.getByRole('switch', { name: 'Sonidos' }));
  expect(onChange).not.toHaveBeenCalled();
});

test('la elección segmentada es un radiogroup con una sola parada de tabulador y flechas', async () => {
  function Host() {
    const [v, setV] = useState<'a' | 'b' | 'c' | 'd'>('a');
    return (
      <Segmented
        aria-label="Movimiento"
        value={v}
        onChange={setV}
        options={[
          { value: 'a', label: 'Sistema' },
          { value: 'b', label: 'Reducido' },
          { value: 'c', label: 'Apagado', disabled: true },
          { value: 'd', label: 'Completo' },
        ]}
      />
    );
  }
  render(<Host />);
  expect(screen.getByRole('radiogroup', { name: 'Movimiento' })).toBeInTheDocument();
  const radio = (name: string) => screen.getByRole('radio', { name });
  expect(radio('Sistema')).toHaveAttribute('aria-checked', 'true');
  expect(radio('Sistema')).toHaveAttribute('tabindex', '0');
  expect(radio('Reducido')).toHaveAttribute('tabindex', '-1');
  radio('Sistema').focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(radio('Reducido')).toHaveAttribute('aria-checked', 'true');
  expect(radio('Reducido')).toHaveFocus();
  // The disabled one is skipped.
  await userEvent.keyboard('{ArrowRight}');
  expect(radio('Completo')).toHaveAttribute('aria-checked', 'true');
  await userEvent.keyboard('{ArrowRight}');
  expect(radio('Sistema')).toHaveAttribute('aria-checked', 'true');
  await userEvent.keyboard('{End}');
  expect(radio('Completo')).toHaveFocus();
  await userEvent.keyboard('{Home}');
  expect(radio('Sistema')).toHaveFocus();
  await userEvent.click(radio('Reducido'));
  expect(radio('Reducido')).toHaveAttribute('aria-checked', 'true');
});
