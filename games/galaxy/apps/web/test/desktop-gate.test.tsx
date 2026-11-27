import type { DeviceEnv } from '@galaxy/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { DesktopGate } from '../src/shell/DesktopGate';

// Computers play, phones and tablets see the notice (the owner, 2026-11-27): the DEVICE decides, never the size of its
// screen, so a laptop at 125 % or 150 % (its screen reported as 1280×720 or less) plays. The notice is bold: the logo,
// a fleet of probes, «Solo en ordenador», and the link to send to yourself (the share sheet or a copy).

const t = copy.desktop;
const device = (userAgent: string, touch = 0): DeviceEnv => ({
  navigator: { userAgent, maxTouchPoints: touch },
  matchMedia: (q: string) => ({ matches: q === '(any-pointer: fine)' ? touch === 0 : q === '(hover: none) and (pointer: coarse)' ? touch > 0 : false }),
});
const LAPTOP = device('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
const PHONE = device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 5);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('un portátil juega, sea cual sea el tamaño de su pantalla', () => {
  vi.stubGlobal('screen', { width: 1093, height: 614 });
  render(
    <DesktopGate win={LAPTOP}>
      <p>juego</p>
    </DesktopGate>,
  );
  expect(screen.getByText('juego')).toBeInTheDocument();
});

test('en un móvil se ve el aviso, con el enlace al juego y la portada', () => {
  render(
    <DesktopGate win={PHONE}>
      <p>juego</p>
    </DesktopGate>,
  );
  expect(screen.queryByText('juego')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: t.title })).toBeInTheDocument();
  expect(screen.getByText(t.badge)).toBeInTheDocument();
  expect(screen.getByText(`${window.location.host}/galaxy`, { exact: false })).toBeInTheDocument();
  // The landing of galaxysurvivor.es tells the visitor what the game is (the move, 2026-11-17).
  expect(screen.getByRole('link', { name: t.landing })).toHaveAttribute('href', '/');
});

test('«Copiar el enlace» copia la dirección del juego y lo dice', async () => {
  const writeText = vi.fn(async () => {});
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(
    <DesktopGate win={PHONE}>
      <p>juego</p>
    </DesktopGate>,
  );
  await user.click(screen.getByRole('button', { name: t.copy }));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/galaxy`);
  expect(await screen.findByRole('status')).toHaveTextContent(t.copied);
});

test('con la hoja de compartir del móvil, «Enviarme el enlace» la abre con la dirección del juego', async () => {
  const share = vi.fn(async () => {});
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
  const user = userEvent.setup();
  render(
    <DesktopGate win={PHONE}>
      <p>juego</p>
    </DesktopGate>,
  );
  await user.click(screen.getByRole('button', { name: t.share }));
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/galaxy` }));
});
