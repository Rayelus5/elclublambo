import type { MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { TopBar } from '../../src/hub/TopBar';
import { WalletBar } from '../../src/hub/WalletBar';
import { BackLink } from '../../src/ui/BackLink';
import '../../src/styles/app.css';

// Every screen's top bar sits where the home's does (the owner, 2026-11-24: «normalizar la altura en la que se
// encuentran los botones/hud»; the lobby's was higher than the home's, and so were or lower the other screens'): its
// buttons at the same height and of the same size at every width, the wallet at the bar's right end (the scanner's sat
// beside its title). With VITE_BAR_SHOTS=1 it saves screenshots.

const wallet = { coins: 1840, dust: 64, signal: 6, components: 22, material: 0 };
const me: MeResponse = { id: 'a1', username: 'vega', roles: [], mfa: false, level: 17, avatar: 'crew-cat', frame: null };

/** A screen's root and its page, with the bar those screens draw: Volver, the title, the wallet. */
const bar = (root: string, inner: string, extra?: ReactNode) =>
  createElement(
    'div',
    { className: `screen-root ${root}` },
    createElement(
      'div',
      { className: inner },
      createElement(
        'header',
        { className: 'collection-bar' },
        createElement(BackLink, { fallback: '/' }),
        createElement('h1', null, 'Título'),
        extra ?? null,
        createElement('div', { className: 'lip panel hud' }, createElement(WalletBar, { wallet })),
      ),
    ),
  );

const SCREENS: Record<string, () => ReactNode> = {
  inicio: () => createElement('div', { className: 'screen-root hub-root' }, createElement('div', { className: 'hub' }, createElement(TopBar, { me, wallet, freePull: false, scanner: false, onLogout: () => {} }))),
  incursion: () =>
    createElement(
      'div',
      { className: 'screen-root lobby-root' },
      createElement('div', { className: 'lobby' }, createElement('div', { className: 'lobby-top' }, createElement(BackLink, { fallback: '/', className: 'lip pill lobby-back', iconOnly: true }), createElement(TopBar, { me, wallet, freePull: false }))),
    ),
  coleccion: () => bar('collection-root', 'collection', createElement('span', { className: 'collection-count' }, '12 galaxias')),
  escaner: () => bar('collection-root scanner-root', 'collection scanner'),
  misiones: () => bar('missions-root', 'missions'),
  torneos: () => bar('tn-root', 'tn-screen'),
  estacion: () => bar('station-root', 'station'),
  laboratorio: () => bar('lab-root', 'lab'),
  taller: () => bar('workshop-root', 'workshop'),
  hangar: () => bar('hangar-root', 'hangar'),
  planetario: () => bar('planetarium-root', 'planetarium'),
  clasificacion: () => bar('leaderboard-root', 'leaderboard'),
  perfil: () => bar('profile-root', 'profile'),
  clanes: () => bar('clans-root', 'clans'),
  mercado: () => bar('market-root', 'market'),
  tienda: () =>
    createElement(
      'main',
      { className: 'shop-screen' },
      createElement('header', { className: 'shop-bar' }, createElement(BackLink, { fallback: '/' }), createElement('h1', { className: 'shop-title' }, 'Tienda'), createElement('div', { className: 'lip panel hud shop-wallet' }, createElement(WalletBar, { wallet, components: true }))),
    ),
};

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  document.body.classList.remove('ready', 'settled');
  vi.unstubAllGlobals();
});

type Bar = { button: DOMRect; wallet: DOMRect; bar: DOMRect };

async function measure(name: string, w: number): Promise<Bar> {
  root?.unmount();
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, SCREENS[name]!()))));
  await new Promise((r) => setTimeout(r, 120));
  const header = host.querySelector<HTMLElement>('.topbar, .collection-bar, .shop-bar')!;
  // The home's first button is Mercado; every other screen's is Volver.
  const button = host.querySelector<HTMLElement>('.lobby-back, .collection-bar > .pill, .shop-bar > .pill, .topbar .pill')!;
  const wallet = header.querySelector<HTMLElement>('.hud')!;
  if (import.meta.env['VITE_BAR_SHOTS']) await page.screenshot({ path: `__shots__/barra-${name}-${w}.png` });
  return { button: button.getBoundingClientRect(), wallet: wallet.getBoundingClientRect(), bar: header.getBoundingClientRect() };
}

const mid = (r: DOMRect) => r.top + r.height / 2;

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2400, 1350],
  [2560, 1440],
  [3440, 1440],
] as const) {
  test(`a ${w}×${h} los botones y el monedero de cada pantalla están a la altura de los del inicio`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    // The hub's entrance has played (its .enter pieces sit in place).
    document.body.classList.add('ready', 'settled');
    const home = await measure('inicio', w);
    for (const name of Object.keys(SCREENS)) {
      if (name === 'inicio') continue;
      const it = await measure(name, w);
      expect.soft(Math.abs(mid(it.button) - mid(home.button)), `${name}: altura de los botones`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(it.button.height - home.button.height), `${name}: tamaño de los botones`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(mid(it.wallet) - mid(home.wallet)), `${name}: altura del monedero`).toBeLessThanOrEqual(1);
      // The wallet closes the bar on the right, whatever comes before it (the lobby's bar is the home's, with its
      // missions and mail after the wallet).
      if (name !== 'incursion') expect.soft(Math.abs(it.wallet.right - it.bar.right), `${name}: el monedero a la derecha`).toBeLessThanOrEqual(1);
    }
  }, 60_000);
}
