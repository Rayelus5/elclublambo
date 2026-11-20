import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MusicRehearsal } from '../src/admin/MusicRehearsal';
import { copy } from '../src/copy/es';
import { FakeAudioContext } from './fake-audio';
import { pickOption } from './pick';
import { renderAt } from './render';

// The music Ensayo (plan «banda sonora», part A2): the owner listens to any piece in any style, forces its intensity, the
// level-up dim, the pause and the stingers, changes each instrument's level and the seed, sees what is playing, and
// copies the settings as JSON to hand them over.

const t = copy.admin.music;
beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});
// userEvent brings its own clipboard: what was copied is read back from it.
const copied = () => navigator.clipboard.readText();
afterEach(() => vi.unstubAllGlobals());

test('reproduce la pieza elegida en el estilo elegido, con su intensidad, y dice lo que suena', async () => {
  const user = userEvent.setup();
  renderAt('/admin/musica', { '/admin/musica': <MusicRehearsal /> });
  await user.click(screen.getByRole('radio', { name: t.styles.lofi }));
  await pickOption(user, screen.getByRole('combobox', { name: t.piece }), 'sector-hielo');
  await user.click(screen.getByRole('radio', { name: t.intensities[3] }));
  await user.click(screen.getByRole('button', { name: t.play }));
  const now = await screen.findByRole('status', { name: t.now });
  await waitFor(() => expect(now).toHaveTextContent('Anillos de escarcha'));
  expect(now).toHaveTextContent(t.styles.lofi);
  await user.click(screen.getByRole('button', { name: t.stingers.extract }));
  await user.click(screen.getByRole('switch', { name: t.choosing }));
  await user.click(screen.getByRole('button', { name: t.stop }));
  expect(screen.getByRole('button', { name: t.play })).toBeInTheDocument();
});

test('los niveles de cada instrumento y la semilla van en «Copiar ajustes»', async () => {
  const user = userEvent.setup();
  renderAt('/admin/musica', { '/admin/musica': <MusicRehearsal /> });
  await pickOption(user, screen.getByRole('combobox', { name: t.piece }), 'nucleo-1');
  await user.click(screen.getByRole('button', { name: t.play }));
  const mixer = screen.getByRole('group', { name: t.mixer });
  const lead = within(mixer).getByRole('slider', { name: t.roles.lead });
  fireEvent.change(lead, { target: { value: '0' } });
  await user.click(screen.getByRole('button', { name: t.copy }));
  await waitFor(async () => expect(await copied()).not.toBe(''));
  const json = JSON.parse(await copied()) as { estilo: string; pieza: string; intensidad: number; semilla: number; mezcla: Record<string, number> };
  expect(json).toMatchObject({ estilo: 'ambient', pieza: 'nucleo-1' });
  expect(json.mezcla['lead']).toBe(0);
  expect(typeof json.semilla).toBe('number');
  const seed = json.semilla;
  await user.click(screen.getByRole('button', { name: t.reseed }));
  await user.click(screen.getByRole('button', { name: t.copied }));
  await waitFor(async () => expect((JSON.parse(await copied()) as { semilla: number }).semilla).not.toBe(seed));
});
