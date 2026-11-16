import { parseConfig } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ContentScreen } from '../../src/admin/content/ContentScreen';
import '../../src/styles/app.css';

// The run content's page (the content editor, 2026-11-16, P2 and P4): the drafts list, an open draft and the visual
// editor on each kind of area fit the screen with no sideways scroll, from 1280 to 2560. VITE_ADMIN_SHOTS=1 saves them.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const draft = {
  id: 'd1',
  title: 'Más vida al ácaro y un sector nuevo para la temporada',
  status: 'open',
  revision: 2,
  fields: [
    { key: 'content', field: 'hitCap' },
    { key: 'content', field: 'enemies' },
  ],
  createdBy: 'rayelus',
  updatedBy: 'rayelus',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T11:00:00.000Z',
  stale: true,
  data: { content: { hitCap: 0.35 } },
  baseVersions: { content: 4 },
  publishedVersions: null,
};

function mount(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const known: Record<string, unknown> = {
        '/admin/config/content': { key: 'content', version: 5, data: parseConfig('content', {}), createdAt: null, author: null, note: null },
        '/admin/config/content/versions': [
          { version: 4, createdAt: '2026-11-15T10:00:00.000Z', author: 'rayelus', note: 'Vida de enemigos' },
          { version: 5, createdAt: '2026-11-16T09:00:00.000Z', author: 'otro_admin', note: 'Peligros más grandes' },
        ],
        '/admin/config-drafts': [draft, { ...draft, id: 'd2', title: 'Armas nuevas', stale: false }],
        '/admin/config-drafts/d1': draft,
        '/auth/me': { id: 'a1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 },
      };
      const key = Object.keys(known).find((k) => url.endsWith(k));
      if (!key) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(known[key]), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  const host = document.createElement('div');
  document.body.style.margin = '0';
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(host);
  root.render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '/admin/configuracion/content', element: createElement(ContentScreen) }))),
    ),
  );
}

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`borradores del contenido a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/admin/configuracion/content');
    await vi.waitFor(() => {
      if (!document.querySelector('.content-draft-list li')) throw new Error('sin lista');
    });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w + 1);
    if (import.meta.env['VITE_ADMIN_SHOTS']) await page.screenshot({ path: `__shots__/content-drafts-${w}.png` });
  });

  test(`un borrador abierto a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    mount('/admin/configuracion/content?borrador=d1');
    await vi.waitFor(() => {
      if (!document.querySelector('.content-editor .ce')) throw new Error('sin editor');
    });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w + 1);
    if (import.meta.env['VITE_ADMIN_SHOTS']) await page.screenshot({ path: `__shots__/content-draft-open-${w}.png` });
  });
}

/** The visual editor's views: an entity of each big list, and a form of rules. */
const VIEWS = [
  ['fauna', 'zona=fauna&id=mite'],
  ['nucleos', 'zona=nucleos&id=hive'],
  ['sectores', 'zona=sectores&id=outer-nebula'],
  ['arsenal', 'zona=arsenal&id=pulse'],
  ['reglas', 'zona=reglas&lista=healing'],
] as const;

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  for (const [name, query] of w === 1280 || w === 1920 ? VIEWS : VIEWS.slice(0, 1)) {
    test(`el editor visual (${name}) a ${w}×${h}`, async () => {
      await page.viewport(w, h);
      mount(`/admin/configuracion/content?borrador=d1&${query}`);
      await vi.waitFor(
        () => {
          if (!document.querySelector('.ce-entity, .ce-object')) throw new Error('sin ficha');
        },
        { timeout: 8000 },
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w + 1);
      if (import.meta.env['VITE_ADMIN_SHOTS']) await page.screenshot({ path: `__shots__/content-editor-${name}-${w}.png` });
    });
  }
}
