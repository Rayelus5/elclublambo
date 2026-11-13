import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { RevealRehearsal } from '../../src/admin/RevealRehearsal';
import { copy } from '../../src/copy/es';
import '../../src/styles/app.css';

// The scanner's Ensayo in a real browser (plan «rareza Mítica» M2): its «Presentación» picks the classic reveal or the
// pro one, the panel fits with no sideways scroll either way, and «Clásica» plays real invented galaxies through the
// classic CRT. VITE_REVEAL_SHOTS=1 saves screenshots.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const t = copy.admin.rehearsal;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 30_000) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw new Error('timeout');
    await wait(40);
  }
}
/** The control (matching `selector`) whose label reads `label`. */
const labelled = (selector: string, label: string) => [...document.querySelectorAll<HTMLElement>(selector)].find((el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent === label)!;
const radio = (group: string, label: string) => [...labelled('[role="radiogroup"]', group).querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(RevealRehearsal)))));
}

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el Ensayo del escáner a ${w}×${h}: elige Clásica o Pro y cabe sin desplazarse de lado`, async () => {
    await page.viewport(w, h);
    mount();
    await wait(200);
    expect(radio(t.presentation, 'Pro').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/rehearsal-pro-${w}.png` });
    radio(t.presentation, 'Clásica').click();
    await wait(200);
    expect(radio(t.presentation, 'Clásica').getAttribute('aria-checked')).toBe('true');
    // The pro's own controls go: its durations, its surge and its speed.
    expect(document.querySelector('.rehearsal-durations')).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/rehearsal-clasica-${w}.png` });
  }, 60_000);
}

test('«Clásica» con una mítica reproduce el escáner clásico con una galaxia inventada', async () => {
  await page.viewport(1600, 900);
  mount();
  radio(t.presentation, 'Clásica').click();
  await wait(100);
  radio(t.count, t.counts.one).click();
  await wait(100);
  // The tier: open the select and pick «Mítica».
  labelled('[role="combobox"]', t.tier).click();
  await until(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].some((o) => o.textContent === copy.tiers.mythic));
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === copy.tiers.mythic)!.click();
  await wait(100);
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(t.play))!.click();
  await until(() => document.querySelector('.modal.reveal-stage .crt') !== null, 60_000);
  expect(document.querySelector('.pro-root')).toBeNull();
  await until(() => document.querySelector('.signal-bars i[data-extra]') !== null);
  await wait(900);
  if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/rehearsal-clasica-mitica.png` });
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1600);
}, 90_000);
