import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { getSettings, readSettings, setSettings } from '../src/audio/mixer';
import { copy } from '../src/copy/es';
import { SettingsScreen } from '../src/hub/SettingsScreen';
import { PauseMenu } from '../src/arena/hud/PauseMenu';
import { readCursor } from '../src/ui/cursor';
import { renderAt } from './render';

// Ajustes (GDD §17.4; M8a): the volumes and the mute live in this browser and survive a reload; the scanner's old mute
// still counts; PERKINS and the first steps can come back.
afterEach(() => {
  localStorage.clear();
  setSettings({ music: 0.5, sfx: 0.8, muted: false, ui: true });
  vi.unstubAllGlobals();
});
const t = copy.settings;

test('los volúmenes y el silencio se guardan, se acotan y se leen al volver', () => {
  setSettings({ music: 0.3, sfx: 1.7, muted: true });
  expect(getSettings()).toEqual({ music: 0.3, sfx: 1, muted: true, ui: true });
  expect(readSettings()).toEqual({ music: 0.3, sfx: 1, muted: true, ui: true });
  localStorage.clear();
  localStorage.setItem('galaxy.sfx.muted', '1');
  expect(readSettings()).toEqual({ music: 0.5, sfx: 0.8, muted: true, ui: true });
});

test('la pantalla cambia la música, silencia todo y devuelve a PERKINS', async () => {
  localStorage.setItem('galaxy.radio.seen', 'start,levelup');
  renderAt('/ajustes', { '/ajustes': <SettingsScreen /> });
  fireEvent.change(screen.getByLabelText(t.music), { target: { value: '20' } });
  expect(getSettings().music).toBe(0.2);
  await userEvent.click(screen.getByLabelText(t.muteAll));
  expect(getSettings().muted).toBe(true);
  expect(screen.getByLabelText(t.effects)).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: t.radio }));
  expect(localStorage.getItem('galaxy.radio.seen')).toBeNull();
  expect(screen.getByText(t.radioDone)).toBeInTheDocument();
});

// Open beta: the game's cursor is chosen here, and the pause has the same settings as the home menu.
test('la sección Cursor cambia el color y el tamaño al momento, lo recuerda, y se puede volver al del sistema', async () => {
  renderAt('/ajustes', { '/ajustes': <SettingsScreen /> });
  const section = screen.getByRole('region', { name: t.cursor });
  await userEvent.click(within(section).getByRole('radio', { name: t.cursorColors.terminal }));
  await userEvent.click(within(section).getByRole('radio', { name: t.cursorSizes.large }));
  expect(readCursor()).toMatchObject({ on: true, size: 'large', color: '#45e3a6' });
  expect(document.documentElement.style.getPropertyValue('--cursor-default')).toContain(encodeURIComponent('#45e3a6'));
  await userEvent.click(within(section).getByLabelText(t.cursorOn));
  expect(readCursor().on).toBe(false);
  expect(document.documentElement.classList.contains('custom-cursor')).toBe(false);
  await userEvent.click(within(section).getByLabelText(t.cursorOn));
});

test('la pausa tiene los mismos ajustes que el menú de inicio; la ayuda espera al menú', async () => {
  renderAt('/ajustes', { '/ajustes': <SettingsScreen /> });
  const sections = (root: HTMLElement) => within(root).getAllByRole('region').map((r) => within(r).getAllByRole('heading')[0]!.textContent);
  const home = sections(document.body);
  document.body.innerHTML = '';
  render(<PauseMenu manualAim={false} onManualAim={() => {}} onResume={() => {}} onAbandon={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: t.title }));
  const dialog = screen.getByRole('dialog');
  expect(sections(dialog)).toEqual(home);
  expect(home).toEqual([t.sound, t.arena, t.cursor, t.help]);
  expect(within(dialog).getByRole('button', { name: t.radio })).toBeDisabled();
  expect(within(dialog).getByText(t.helpInRun)).toBeInTheDocument();
  expect(within(dialog).getByLabelText(t.manualAim)).toBeInTheDocument();
  expect(within(dialog).getByLabelText(t.music)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.back }));
  expect(screen.getByRole('button', { name: copy.arena.resume })).toBeInTheDocument();
});
