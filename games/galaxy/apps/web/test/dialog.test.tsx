import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Dialog } from '../src/ui/Dialog';

// The shared modal (DESIGN_SYSTEM §7). A button disabled while its request runs drops the focus to the page (seen in
// the station's e2e): Escape and Tab must still reach the dialog on top, and only that one.

const lose = () => (document.activeElement as HTMLElement | null)?.blur();

test('Escape cierra el diálogo aunque el foco se haya perdido', () => {
  const onClose = vi.fn();
  render(
    <Dialog title="Panel" onClose={onClose}>
      <button type="button">Cargar</button>
    </Dialog>,
  );
  lose();
  expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Tab con el foco perdido vuelve dentro del diálogo', () => {
  render(
    <Dialog title="Panel" onClose={() => {}}>
      <button type="button">Uno</button>
      <button type="button">Dos</button>
    </Dialog>,
  );
  lose();
  fireEvent.keyDown(document.body, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Uno' })).toHaveFocus();
  lose();
  fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Dos' })).toHaveFocus();
});

test('con dos diálogos abiertos, Escape con el foco perdido cierra solo el de encima', () => {
  const under = vi.fn();
  const over = vi.fn();
  render(
    <>
      <Dialog title="Debajo" onClose={under}>
        <button type="button">a</button>
      </Dialog>
      <Dialog title="Encima" onClose={over}>
        <button type="button">b</button>
      </Dialog>
    </>,
  );
  lose();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(over).toHaveBeenCalledTimes(1);
  expect(under).not.toHaveBeenCalled();
});

test('Escape dentro del diálogo lo cierra una sola vez y lo que diga onEscape manda', () => {
  const onClose = vi.fn();
  const onEscape = vi.fn();
  const { unmount } = render(
    <Dialog title="Panel" onClose={onClose}>
      <button type="button">Cargar</button>
    </Dialog>,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cargar' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  render(
    <Dialog title="Pausa" onClose={onClose} onEscape={onEscape}>
      <button type="button">Continuar</button>
    </Dialog>,
  );
  lose();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onEscape).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
