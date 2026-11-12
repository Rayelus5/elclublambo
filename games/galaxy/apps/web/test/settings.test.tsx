import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { getSettings, readSettings, setSettings } from '../src/audio/mixer';
import { copy } from '../src/copy/es';
import { SettingsScreen } from '../src/hub/SettingsScreen';
import { PauseMenu } from '../src/arena/hud/PauseMenu';
import { getPrefs, resetPrefs } from '../src/settings/prefs';
import { readCursor } from '../src/ui/cursor';
import { LocationProbe, locationOf, renderAt } from './render';

// Ajustes (GDD §17.4; M8a; redesigned in the «escáner pro» plan, part A): the volumes and the mute live in this
// browser and survive a reload; the scanner's old mute still counts; PERKINS and the first steps can come back. The
// screen is a set of tabs (sound, display, accessibility, the run, help) with the game's own controls, the tab in the
// address, and the run's pause shows the same tabs.
afterEach(() => {
  localStorage.clear();
  setSettings({ music: 0.5, sfx: 0.8, muted: false, ui: true });
  resetPrefs();
  vi.unstubAllGlobals();
});
const t = copy.settings;
const TABS = [t.sound, t.display, t.access, t.arena, t.help];

function openSettings(path = '/ajustes') {
  return renderAt(path, {
    '/ajustes': (
      <>
        <SettingsScreen />
        <LocationProbe />
      </>
    ),
  });
}

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
  openSettings();
  const music = screen.getByRole('slider', { name: t.music });
  fireEvent.change(music, { target: { value: '20' } });
  expect(getSettings().music).toBe(0.2);
  expect(music).toHaveAttribute('aria-valuetext', t.percent(20));
  await userEvent.click(screen.getByRole('switch', { name: t.muteAll }));
  expect(getSettings().muted).toBe(true);
  expect(screen.getByRole('slider', { name: t.effects })).toBeDisabled();
  expect(screen.getByRole('switch', { name: t.uiSounds })).toBeDisabled();
  await userEvent.click(screen.getByRole('tab', { name: t.help }));
  await userEvent.click(screen.getByRole('button', { name: t.radio }));
  expect(localStorage.getItem('galaxy.radio.seen')).toBeNull();
  expect(screen.getByText(t.radioDone)).toBeInTheDocument();
});

test('las secciones son pestañas: la dirección dice cuál, y las flechas cambian de una a otra', async () => {
  openSettings('/ajustes?seccion=accesibilidad');
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((x) => x.textContent)).toEqual(TABS);
  expect(screen.getByRole('tab', { name: t.access })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: t.access })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: t.sound })).toHaveAttribute('tabindex', '-1');
  await userEvent.click(screen.getByRole('tab', { name: t.sound }));
  expect(locationOf(screen.getByTestId('location')).search).toBe('?seccion=sonido');
  screen.getByRole('tab', { name: t.sound }).focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('tab', { name: t.display })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: t.display })).toBeInTheDocument();
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('tab', { name: t.help })).toHaveAttribute('aria-selected', 'true');
});

test('una sección desconocida en la dirección abre la de sonido', () => {
  openSettings('/ajustes?seccion=nada');
  expect(screen.getByRole('tab', { name: t.sound })).toHaveAttribute('aria-selected', 'true');
});

test('Accesibilidad: el movimiento se elige entre Sistema, Reducido y Completo y se guarda', async () => {
  openSettings('/ajustes?seccion=accesibilidad');
  const group = screen.getByRole('radiogroup', { name: t.motion });
  expect(within(group).getByRole('radio', { name: t.motions.system })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText(t.motionSystem(false))).toBeInTheDocument();
  await userEvent.click(within(group).getByRole('radio', { name: t.motions.reduced }));
  expect(getPrefs().motion).toBe('reduced');
  expect(JSON.parse(localStorage.getItem('galaxy.prefs')!).state.motion).toBe('reduced');
  await userEvent.click(within(group).getByRole('radio', { name: t.motions.full }));
  expect(getPrefs().motion).toBe('full');
});

// Open beta: the game's cursor is chosen here, and the pause has the same settings as the home menu.
test('Pantalla: el cursor cambia de color y de tamaño al momento, lo recuerda, y se puede volver al del sistema', async () => {
  openSettings('/ajustes?seccion=pantalla');
  const panel = screen.getByRole('tabpanel', { name: t.display });
  await userEvent.click(within(panel).getByRole('radio', { name: t.cursorColors.terminal }));
  await userEvent.click(within(panel).getByRole('radio', { name: t.cursorSizes.large }));
  expect(readCursor()).toMatchObject({ on: true, size: 'large', color: '#45e3a6' });
  expect(document.documentElement.style.getPropertyValue('--cursor-default')).toContain(encodeURIComponent('#45e3a6'));
  await userEvent.click(within(panel).getByRole('switch', { name: t.cursorOn }));
  expect(readCursor().on).toBe(false);
  expect(document.documentElement.classList.contains('custom-cursor')).toBe(false);
  expect(within(panel).getByRole('radio', { name: t.cursorSizes.large })).toBeDisabled();
  await userEvent.click(within(panel).getByRole('switch', { name: t.cursorOn }));
});

test('Pantalla: la presentación pro del escáner viene activada y se puede apagar (solo desde el menú)', async () => {
  openSettings('/ajustes?seccion=pantalla');
  const sw = screen.getByRole('switch', { name: t.scannerPro });
  expect(sw).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(sw);
  expect(getPrefs().scannerPro).toBe(false);
  expect(JSON.parse(localStorage.getItem('galaxy.prefs')!).state.scannerPro).toBe(false);
});

test('la pausa tiene las mismas pestañas que el menú de inicio; la ayuda espera al menú', async () => {
  renderAt('/', { '/': <PauseMenu manualAim={false} onManualAim={() => {}} onResume={() => {}} onAbandon={() => {}} /> });
  await userEvent.click(screen.getByRole('button', { name: t.title }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('tab').map((x) => x.textContent)).toEqual(TABS);
  expect(within(dialog).getByRole('slider', { name: t.music })).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('tab', { name: t.display }));
  expect(within(dialog).queryByRole('switch', { name: t.scannerPro })).toBeNull();
  await userEvent.click(within(dialog).getByRole('tab', { name: t.arena }));
  expect(within(dialog).getByRole('switch', { name: t.manualAim })).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('tab', { name: t.help }));
  expect(within(dialog).getByRole('button', { name: t.radio })).toBeDisabled();
  expect(within(dialog).getByText(t.helpInRun)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: t.back }));
  expect(screen.getByRole('button', { name: copy.arena.resume })).toBeInTheDocument();
});

test('en la pausa, el apuntado manual cambia al momento', async () => {
  const onAim = vi.fn();
  renderAt('/', { '/': <PauseMenu manualAim={false} onManualAim={onAim} onResume={() => {}} onAbandon={() => {}} /> });
  await userEvent.click(screen.getByRole('button', { name: t.title }));
  await userEvent.click(screen.getByRole('tab', { name: t.arena }));
  await userEvent.click(screen.getByRole('switch', { name: t.manualAim }));
  expect(onAim).toHaveBeenCalledWith(true);
});
