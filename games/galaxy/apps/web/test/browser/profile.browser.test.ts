import { renderFromSeed } from '@galaxy/engine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ProfileScreen } from '../../src/social/ProfileScreen';
import '../../src/styles/app.css';

// A profile with a galaxy banner and its finish's theme (Nov plan C4) in a real browser: the banner draws, the page
// never grows sideways, and the panels stay readable over it. VITE_PROFILE_SHOTS=1 saves screenshots.
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const banner = (finish: string) => ({
  id: 'g1',
  seed: '9000017',
  tier: 'legendary',
  finish,
  traits: renderFromSeed(9_000_017n, { columns: 48 }).traits as unknown as Record<string, string>,
  name: 'Kathra',
  designation: 'GX-00F7A1',
  featured: false,
  level: 4,
});
const profile = (finish: string) => ({
  username: 'vega',
  since: '2026-11-03T10:00:00.000Z',
  level: 17,
  xp: { into: 1240, next: 2000 },
  season: { score: 2400, rank: 4, tier: 'silver', maxDepth: 6, purges: 3, extractions: 5 },
  records: { maxDepth: 9, purges: 12, runs: 40 },
  collection: { total: 24, counts: { common: 10, uncommon: 6, rare: 4, epic: 2, legendary: 1, mythic: 1 } },
  planetarium: { prestige: 31, exhibits: 4, cover: null },
  clan: { tag: 'NEB', name: 'Nebulosa Roja', emblem: 'star', color: 'nova' },
  title: 'Mecenas estelar',
  avatar: 'crew-cat',
  frame: 'prism',
  banner: banner(finish),
  // Plan «skins», part D: the showcase (with skins) and every probe below.
  probes: {
    showcase: [
      { id: 'lumen', level: 6, skin: 'skin-lumen-leyenda', variant: 'pulse-twin' },
      { id: 'prism', level: 3, skin: 'skin-prism-coral', variant: null },
      { id: 'bastion', level: 2, skin: null, variant: null },
    ],
    all: ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'].map((id, i) => ({ id, level: 8 - i, skin: id === 'lumen' ? 'skin-lumen-leyenda' : id === 'prism' ? 'skin-prism-coral' : null, variant: null })),
  },
});

for (const [finish, width, height] of [
  ['rift', 1920, 1080],
  ['holo', 1280, 720],
  ['corrupt', 1600, 900],
  ['prismatic', 390, 844],
] as const) {
  test(`perfil con banner ${finish} a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('/profiles/vega') ? new Response(JSON.stringify(profile(finish)), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }))),
    );
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.style.height = '100vh';
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/perfil/vega'] }, createElement(Routes, null, createElement(Route, { path: '/perfil/:username', element: createElement(ProfileScreen) })))));
    // The first one starts cold (fonts, the galaxy worker, software WebGL) on a CI runner shared with the other suites:
    // 15 s on a quiet run, past 30 s on a busy one. The next ones take their usual time, so a real hang still fails.
    await vi.waitFor(() => expect(document.querySelector('.profile-banner-art canvas')).not.toBeNull(), { timeout: 60_000, interval: 200 });
    expect(document.querySelector('.profile-root')).toHaveAttribute('data-finish', finish);
    const scroller = document.querySelector('.profile-root')!;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
    await new Promise((r) => setTimeout(r, 400));
    if (import.meta.env['VITE_PROFILE_SHOTS']) await page.screenshot({ path: `__shots__/profile-${finish}-${width}.png` });
  }, 100_000);
}

// Plan «referidos», part R2: on my own profile, «Tus códigos de invitación» (one on, one off) sits in the grid with the
// other panels and the page still never grows sideways.
const mine = {
  codes: [
    { code: 'VEGA-7K2P', enabled: true, uses: 4, maxUses: 20, expiresAt: '2026-12-31T22:59:00.000Z' },
    { code: 'VEGA-OTONO', enabled: false, uses: 12, maxUses: null, expiresAt: null },
  ],
  joined: 16,
  waiting: 3,
  rewarded: 11,
  activationLevel: 5,
  ownerGifts: { coins: 100, dust: 50, signal: 2 },
  newcomerGifts: { coins: 100, dust: 50, signal: 2 },
};
for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`mi perfil con mis códigos de invitación a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/me')
          ? json({ id: 'a1', username: 'vega', roles: [], mfa: false })
          : url.endsWith('/profiles/vega')
            ? json({ ...profile('normal'), banner: null })
            : url.endsWith('/referrals/mine')
              ? json(mine)
              : new Response('{"error":"not_found"}', { status: 404, headers: { 'content-type': 'application/json' } }),
      ),
    );
    document.body.style.margin = '0';
    const host = document.createElement('div');
    host.style.height = '100vh';
    document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: ['/perfil/vega'] }, createElement(Routes, null, createElement(Route, { path: '/perfil/:username', element: createElement(ProfileScreen) })))));
    await vi.waitFor(() => expect(document.querySelectorAll('.profile-invite .invite-codes > li')).toHaveLength(2), { timeout: 10_000, interval: 100 });
    const scroller = document.querySelector('.profile-root')!;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
    const panel = document.querySelector<HTMLElement>('.profile-invite')!.getBoundingClientRect();
    expect(panel.right).toBeLessThanOrEqual(width);
    await new Promise((r) => setTimeout(r, 300));
    // The whole grid of panels: a taller window for the picture only (the checks above ran at the real size).
    if (import.meta.env['VITE_PROFILE_SHOTS']) {
      await page.viewport(width, 1700);
      await new Promise((r) => setTimeout(r, 200));
      await page.screenshot({ path: `__shots__/profile-invite-${width}.png` });
    }
  }, 60_000);
}
