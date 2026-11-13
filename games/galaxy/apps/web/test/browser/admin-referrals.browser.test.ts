import { type AdminReferralCode, type AdminReferralOwner, type AdminReferralRow, type AdminReferralSummary, CONFIG_KEYS, type MeResponse, parseConfig, type ReferralFlag } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AdminLayout } from '../../src/admin/AdminLayout';
import { ReferralsScreen } from '../../src/admin/referrals/ReferralsScreen';
import '../../src/styles/app.css';

// «Referidos» in a real browser (plan «referidos», part R2): each tab inside the panel at four desktop widths, with full
// tables (a page of 50 newcomers, every mark), a mark's explanation floating over the table, an owner's own rewards and
// the global editor; the page never grows sideways (the tables scroll inside their frame). Screenshots with
// VITE_REFERRALS_SHOTS=1.

const me: MeResponse = { id: 'ad1', username: 'rayelus', roles: ['superadmin'], mfa: true, level: 30 };
const NAMES = ['vega', 'orion', 'lyra', 'altair', 'deneb', 'rigel', 'sirius', 'antares', 'polaris', 'capella'];
const keys = CONFIG_KEYS.map((key) => ({ key, version: 1, data: parseConfig(key, {}), createdAt: null, author: null, note: null }));
const summary: AdminReferralSummary = { codes: { active: 9, total: 12 }, signups: { days7: 37, days30: 142, total: 318 }, activation: 0.42, held: 6, rewarded: 121 };
const codes: AdminReferralCode[] = Array.from({ length: 12 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  code: `${NAMES[i % NAMES.length]!.toUpperCase()}-${['7K2P', 'AB12', 'X9QZ', 'M4RT'][i % 4]}`,
  owner: NAMES[i % NAMES.length]!,
  enabled: i % 5 !== 3,
  maxUses: i % 3 === 0 ? null : 50,
  expiresAt: i % 4 === 1 ? '2026-12-31T22:59:00.000Z' : i === 6 ? '2026-11-01T00:00:00.000Z' : null,
  note: i % 2 === 0 ? 'Streamer de la comunidad hispana, campaña de otoño' : null,
  createdAt: new Date(Date.UTC(2026, 10, 12 - i, 10)).toISOString(),
  createdBy: i % 3 === 2 ? null : 'rayelus',
  uses: i === 2 ? 50 : 40 - i * 3,
  rewarded: 12 - i,
  held: i % 4 === 0 ? 2 : 0,
}));
const FLAGS: ReferralFlag[][] = [[], ['owner_ip'], ['sibling_ip', 'ip_burst'], [], ['code_cap', 'owner_cap', 'ip_burst'], []];
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
];
const rows: AdminReferralRow[] = Array.from({ length: 50 }, (_, i) => {
  const flags = FLAGS[i % FLAGS.length]!;
  const state = flags.length ? (i % 7 === 0 ? 'rejected' : 'held') : i % 3 === 0 ? 'rewarded' : 'pending';
  return {
    username: `nova_${String(i).padStart(2, '0')}`,
    code: codes[i % codes.length]!.code,
    owner: codes[i % codes.length]!.owner,
    createdAt: new Date(Date.UTC(2026, 10, 12, 23 - (i % 24), i)).toISOString(),
    state,
    flags,
    ip: i % 9 === 4 ? '2a02:9130:84a1:3f00:1c2d:ab12:9e0f:7701' : `81.${40 + (i % 9)}.12.${i}`,
    userAgent: UAS[i % UAS.length]!,
    level: state === 'rewarded' ? 9 + (i % 6) : 1 + (i % 4),
    activatedAt: null,
    newcomerPaid: state !== 'held' && state !== 'rejected',
    ownerPaid: state === 'rewarded',
    reviewedBy: i % 11 === 0 && state !== 'held' ? 'rayelus' : null,
  };
});
const owner: AdminReferralOwner = {
  owner: 'vega',
  override: { ownerGifts: { coins: 500, dust: 100 }, newcomerGifts: null, activationLevel: 8 },
  rules: { ownerGifts: { coins: 500, dust: 100 }, newcomerGifts: { coins: 100, dust: 50, signal: 2 }, activationLevel: 8 },
};

function body(url: string): unknown {
  if (url.endsWith('/auth/me')) return me;
  if (url.endsWith('/admin/config/keys')) return keys;
  if (url.includes('/admin/config/referrals/versions')) return [];
  if (url.endsWith('/admin/referrals/summary')) return summary;
  if (url.includes('/admin/referrals/codes')) return codes;
  if (url.includes('/admin/referrals/owners/')) return owner;
  if (url.includes('/admin/referrals?')) return { rows, total: 318, page: 1, pages: 7 };
  return {};
}

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const shot = async (name: string, w: number) => {
  if (import.meta.env['VITE_REFERRALS_SHOTS']) await page.screenshot({ path: `__shots__/admin-referrals-${name}-${w}.png` });
};
const noSideways = (w: number) => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === name)!;

for (const [w, h] of [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
] as const) {
  test(`referidos a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(body(url)), { status: 200, headers: { 'content-type': 'application/json' } })));
    const host = document.createElement('div');
    document.body.style.margin = '0';
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(
          MemoryRouter,
          { initialEntries: ['/admin/referidos'] },
          createElement(Routes, null, createElement(Route, { path: '/admin', element: createElement(AdminLayout) }, createElement(Route, { path: 'referidos', element: createElement(ReferralsScreen) }))),
        ),
      ),
    );

    // Resumen: the seven tiles and how it works.
    await expect.poll(() => document.querySelectorAll('.ref-tiles .stat-tile').length, { timeout: 5000 }).toBe(7);
    await expect.poll(() => document.querySelector('.ref-how'), { timeout: 5000 }).not.toBeNull();
    noSideways(w);
    await shot('resumen', w);

    // Códigos: twelve codes, the table inside its frame.
    tab('Códigos').click();
    await expect.poll(() => document.querySelectorAll('.ref-table tbody tr').length, { timeout: 5000 }).toBe(12);
    noSideways(w);
    const frame = document.querySelector<HTMLElement>('.admin-table-wrap')!.getBoundingClientRect();
    expect(frame.right).toBeLessThanOrEqual(w);
    await shot('codigos', w);

    // Referidos: a page of 50, and a mark explained over the table.
    tab('Referidos').click();
    await expect.poll(() => document.querySelectorAll('.ref-table tbody tr').length, { timeout: 5000 }).toBe(50);
    noSideways(w);
    const chip = document.querySelector<HTMLElement>('.ref-flag')!;
    await userEvent.hover(chip);
    await expect.poll(() => document.querySelector<HTMLElement>('.ref-tip:not([hidden])'), { timeout: 3000 }).not.toBeNull();
    const tip = document.querySelector<HTMLElement>('.ref-tip:not([hidden])')!.getBoundingClientRect();
    expect(tip.right).toBeLessThanOrEqual(w);
    expect(tip.width).toBeGreaterThan(40);
    await shot('referidos', w);
    await userEvent.unhover(chip);

    // Premios: the global rules beside an owner's own.
    tab('Premios').click();
    await expect.poll(() => document.querySelector('.ref-global'), { timeout: 5000 }).not.toBeNull();
    const who = document.querySelector<HTMLInputElement>('.ref-find input')!;
    await userEvent.fill(who, 'vega');
    document.querySelector<HTMLButtonElement>('.ref-find button[type="submit"]')!.click();
    await expect.poll(() => document.querySelectorAll('.ref-owner-form fieldset').length, { timeout: 5000 }).toBe(3);
    noSideways(w);
    await shot('premios', w);

    // The global editor, embedded.
    document.querySelector<HTMLButtonElement>('.ref-global .ref-head button')!.click();
    await expect.poll(() => document.querySelector('.ref-global .cf-layout'), { timeout: 5000 }).not.toBeNull();
    noSideways(w);
    await shot('editor', w);
  }, 90_000);
}
