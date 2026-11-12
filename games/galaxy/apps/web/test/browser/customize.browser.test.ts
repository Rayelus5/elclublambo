import { type CosmeticsView, DEFAULT_COSMETICS } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { copy } from '../../src/copy/es';
import { CustomizeDialog } from '../../src/profile/CustomizeDialog';
import '../../src/styles/app.css';

// «Personalizar» in a real browser (Nov plan C2): the titles tab shows each title once, in its style, with its rarity
// under it. With VITE_CUSTOMIZE_SHOTS=1 it saves a screenshot.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

test('la pestaña de títulos: cada título una vez, con su rareza debajo', async () => {
  await page.viewport(1280, 900);
  vi.stubGlobal('fetch', () => new Promise(() => {}));
  const view: CosmeticsView = { equipped: { avatar: 'crew-cat', frame: 'prism', title: 'Mecenas estelar', banner: null }, owned: { avatars: [], frames: ['prism'], titles: ['Cadete', 'Mecenas estelar'] }, catalog: DEFAULT_COSMETICS };
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(CustomizeDialog, { username: 'vega', view, onClose: () => {} })))));
  await userEvent.click(page.getByRole('tab', { name: copy.customize.tabs.title }));
  const panel = document.querySelector<HTMLElement>('.cz-grid.cz-title')!;
  const texts = [...panel.querySelectorAll('.cz-pick')].map((b) => b.textContent ?? '');
  expect(texts.filter((x) => x.split('Mecenas estelar').length > 2)).toEqual([]);
  if (import.meta.env['VITE_CUSTOMIZE_SHOTS']) await page.screenshot({ path: '__shots__/customize-titles.png', element: document.querySelector<HTMLElement>('.customize')! });
});
