import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { getSettings, readSettings, setSettings } from '../src/audio/mixer';
import { copy } from '../src/copy/es';
import { SettingsScreen } from '../src/hub/SettingsScreen';
import { renderAt } from './render';

// Ajustes (GDD §17.4; M8a): the volumes and the mute live in this browser and survive a reload; the scanner's old mute
// still counts; PERKINS and the first steps can come back.
afterEach(() => {
  localStorage.clear();
  setSettings({ music: 0.5, sfx: 0.8, muted: false });
  vi.unstubAllGlobals();
});
const t = copy.settings;

test('los volúmenes y el silencio se guardan, se acotan y se leen al volver', () => {
  setSettings({ music: 0.3, sfx: 1.7, muted: true });
  expect(getSettings()).toEqual({ music: 0.3, sfx: 1, muted: true });
  expect(readSettings()).toEqual({ music: 0.3, sfx: 1, muted: true });
  localStorage.clear();
  localStorage.setItem('galaxy.sfx.muted', '1');
  expect(readSettings()).toEqual({ music: 0.5, sfx: 0.8, muted: true });
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
