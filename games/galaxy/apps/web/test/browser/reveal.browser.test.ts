import { renderFromSeed } from '@galaxy/engine';
import type { PulledGalaxy, Tier } from '@galaxy/shared';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { copy } from '../../src/copy/es';
import { ClassicStage as RevealStage } from '../../src/scanner/ClassicStage';
import '../../src/styles/app.css';

// The scan's reveal in a real Chromium: the featured galaxy's sign, the card's beams and the burst animate over the
// screen, yet the popup never grows scrollbars (the beams turning behind an epic or legendary card used to grow them).
// VITE_REVEAL_SHOTS=1 also saves screenshots for review.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const pulled = (tier: Tier): PulledGalaxy =>
  ({
    id: `g-${tier}`,
    seed: '9000017',
    tier,
    finish: 'holo',
    traits: renderFromSeed(9_000_017n, { columns: 48 }).traits as unknown as Record<string, string>,
    name: 'Kathra',
    designation: 'GX-00F7A1',
    featured: true,
    level: 1,
    createdAt: '2026-11-10T20:00:00Z',
  }) as PulledGalaxy;

const until = async (check: () => boolean, ms = 30_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};

for (const [tier, width, height] of [
  ['uncommon', 1280, 720],
  ['epic', 1366, 768],
  ['legendary', 1280, 720],
  ['legendary', 1920, 1080],
  // The «Mítica» (plan «rareza Mítica» M1): its iridescent beams and burst stay inside the popup too.
  ['mythic', 1280, 720],
  ['mythic', 1600, 900],
  ['mythic', 1920, 1080],
  ['mythic', 2560, 1440],
] as const) {
  test(`una destacada ${tier} a ${width}×${height}: el popup no saca barras de desplazamiento`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(RevealStage, { pulls: [pulled(tier)], onClose: () => {} }));
    await until(() => document.querySelector('.stage-next') !== null);
    // Seguir jumps from inside the pull to its card.
    (document.querySelector('.stage-next') as HTMLButtonElement).click();
    await until(() => document.querySelector('.stage-featured') !== null);
    const modal = document.querySelector('.modal.reveal-stage') as HTMLElement;
    const overflowed: string[] = [];
    // The sign lands after .35 s and bounces for .55 s; the beams keep turning.
    const start = performance.now();
    while (performance.now() - start < 1800) {
      // Scrollbars: the popup scrolls (auto) and its content does not fit.
      const { overflowX, overflowY } = getComputedStyle(modal);
      const scrolls = (o: string) => o === 'auto' || o === 'scroll';
      if ((scrolls(overflowX) && modal.scrollWidth > modal.clientWidth) || (scrolls(overflowY) && modal.scrollHeight > modal.clientHeight)) {
        overflowed.push(`${Math.round(performance.now() - start)}ms ${modal.scrollWidth}×${modal.scrollHeight} > ${modal.clientWidth}×${modal.clientHeight}`);
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/reveal-${tier}-${width}.png` });
    expect(overflowed).toEqual([]);
  }, 60_000);
}

// A Mítica lights a sixth, iridescent bar past the five, inside the screen, and makes the screen fail like a legendary.
for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la señal de una mítica a ${width}×${height}: seis barras dentro de la pantalla y el fallo de pantalla`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(RevealStage, { pulls: [{ ...pulled('mythic'), featured: false }], onClose: () => {} }));
    // Every step the stage goes through (a screenshot can take longer than the glitch lasts).
    const steps: string[] = [];
    const watch = new MutationObserver(() => {
      const st = document.querySelector('.crt')?.getAttribute('data-step');
      if (st && steps.at(-1) !== st) steps.push(st);
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-step'], childList: true });
    await until(() => document.querySelector('.signal-bars i[data-extra][data-on]') !== null);
    // The bars rise one after another (120 ms apart).
    await new Promise((r) => setTimeout(r, 1100));
    const bars = [...document.querySelectorAll<HTMLElement>('.signal-bars i')];
    expect(bars).toHaveLength(6);
    expect(bars.every((b) => b.hasAttribute('data-on'))).toBe(true);
    const screen = document.querySelector('.crt-screen')!.getBoundingClientRect();
    for (const b of bars) {
      const r = b.getBoundingClientRect();
      expect(r.top).toBeGreaterThanOrEqual(screen.top);
      expect(r.right).toBeLessThanOrEqual(screen.right);
    }
    expect(getComputedStyle(bars[5]!).backgroundImage).toContain('gradient');
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/reveal-mythic-signal-${width}.png` });
    // Then the screen fails before the card, as a legendary's does.
    await until(() => document.querySelector('.crt[data-step="card"]') !== null);
    watch.disconnect();
    expect(steps.indexOf('glitch')).toBeGreaterThan(steps.indexOf('scan'));
    // M2: then it holds its breath, right before the card.
    expect(steps.indexOf('hush')).toBeGreaterThan(steps.indexOf('glitch'));
    expect(steps.indexOf('card')).toBe(steps.indexOf('hush') + 1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  }, 60_000);
}

// Plan «rareza Mítica» M2: a Mítica's card comes after a held breath (the screen dims), and lands with twice the
// beams, one flash sweeping its four iridescent tones and a longer shake. A legendary's stays exactly as it was.
const shots = !!import.meta.env['VITE_REVEAL_SHOTS'];
function mountClassic(g: PulledGalaxy) {
  document.body.style.margin = '0';
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(createElement(RevealStage, { pulls: [g], onClose: () => {} }));
}
/** The flash's and the shake's own animations (not the dialog's entrance). */
const fxAnimations = () =>
  [...document.querySelectorAll<HTMLElement>('.reveal-flash, .modal.reveal-stage')]
    .flatMap((el) => el.getAnimations())
    .filter((a) => /^(reveal-flash|iris-sweep|reveal-shake-long)$/.test((a as CSSAnimation).animationName ?? ''));
/** Holds the flash and the shake still `ms` into their animation, for a screenshot of that very moment. */
function freeze(ms: number) {
  for (const a of fxAnimations()) {
    a.pause();
    a.currentTime = ms;
  }
}

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`la carta de una mítica a ${width}×${height}: silencio, doble haz, destello iridiscente y temblor largo`, async () => {
    await page.viewport(width, height);
    mountClassic({ ...pulled('mythic'), featured: false });
    // The long shake lasts under a second: watch for it from the start (a slow CI runner may look at the card step
    // only after it is over).
    let shookLong = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector('.modal.reveal-stage.shake-long')) shookLong = true;
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    await until(() => document.querySelector('.crt[data-step="hush"]') !== null);
    // The dim fades in over .35 s.
    await new Promise((r) => setTimeout(r, 250));
    expect(getComputedStyle(document.querySelector('.crt-screen')!).filter).toContain('brightness');
    if (shots) await page.screenshot({ path: `__shots__/reveal-mythic-hush-${width}.png` });
    await until(() => document.querySelector('.crt[data-step="card"]') !== null);
    expect(document.querySelectorAll('.stage-card .stage-beams')).toHaveLength(2);
    await until(() => shookLong, 15_000);
    watch.disconnect();
    // Waits, not durations: a CI runner shared with every other suite is slow, never stuck.
    await until(() => document.querySelector('.reveal-flash') !== null, 15_000);
    const flash = document.querySelector<HTMLElement>('.reveal-flash')!;
    expect(flash.dataset['iris']).toBe('true');
    expect(getComputedStyle(flash).backgroundImage).toContain('conic-gradient');
    expect(getComputedStyle(flash).animationName).toContain('iris-sweep');
    freeze(200);
    if (shots) await page.screenshot({ path: `__shots__/reveal-mythic-flash-${width}.png` });
    freeze(700);
    if (shots) await page.screenshot({ path: `__shots__/reveal-mythic-flash-late-${width}.png` });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    // The shake lets go after its 0,9 s.
    for (const a of fxAnimations()) a.play();
    await until(() => !document.querySelector('.modal.reveal-stage')!.classList.contains('shake'), 15_000);
    if (shots) await page.screenshot({ path: `__shots__/reveal-mythic-beams-${width}.png` });
  }, 60_000);
}

test('la carta de una legendaria sigue como estaba: sin silencio, un haz, temblor corto y destello de su color', async () => {
  await page.viewport(1280, 720);
  mountClassic({ ...pulled('legendary'), featured: false });
  const steps: string[] = [];
  const watch = new MutationObserver(() => {
    const st = document.querySelector('.crt')?.getAttribute('data-step');
    if (st && steps.at(-1) !== st) steps.push(st);
  });
  watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-step'], childList: true });
  await until(() => document.querySelector('.crt[data-step="card"]') !== null);
  watch.disconnect();
  expect(steps).not.toContain('hush');
  expect(document.querySelectorAll('.stage-card .stage-beams')).toHaveLength(1);
  const modal = document.querySelector('.modal.reveal-stage')!;
  expect(modal.classList.contains('shake')).toBe(true);
  expect(modal.classList.contains('shake-long')).toBe(false);
  await until(() => document.querySelector('.reveal-flash') !== null, 3000);
  const flash = document.querySelector<HTMLElement>('.reveal-flash')!;
  expect(flash.dataset['iris']).toBeUndefined();
  expect(getComputedStyle(flash).backgroundImage).not.toContain('conic-gradient');
}, 60_000);

// «¡Escanear otra!» and «Colección» (Nov plan A1): the summary's buttons fit, with the missing line over them.
for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el resumen de un escaneo con «¡Escanear otra!» y «Colección» cabe a ${width}×${height}`, async () => {
    await page.viewport(width, height);
    document.body.style.margin = '0';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const actions = createElement(
      Fragment,
      null,
      createElement('button', { type: 'button', className: 'lip pill pill-solar scan-again', disabled: true }, createElement('span', null, copy.scanner.again(1)), createElement('small', null, copy.scanner.costCoins(100))),
      createElement('a', { href: '#', className: 'lip pill pill-uv' }, createElement('span', null, copy.scanner.toCollection)),
    );
    const status = createElement('p', { className: 'summary-missing' }, copy.scanner.missingCoins(50));
    root.render(createElement(RevealStage, { pulls: [pulled('rare')], onClose: () => {}, actions, status }));
    await until(() => [...document.querySelectorAll('button')].some((b) => b.textContent === copy.scanner.skip));
    ([...document.querySelectorAll('button')].find((b) => b.textContent === copy.scanner.skip) as HTMLButtonElement).click();
    await until(() => document.querySelector('.summary-actions .pill-uv') !== null);
    await new Promise((r) => setTimeout(r, 600));
    const modal = document.querySelector('.modal.reveal-stage') as HTMLElement;
    expect(modal.scrollHeight).toBeLessThanOrEqual(modal.clientHeight + 1);
    for (const el of document.querySelectorAll<HTMLElement>('.summary-actions > *')) expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
    const uv = getComputedStyle(document.querySelector('.pill-uv')!);
    expect(uv.backgroundImage).toContain('gradient');
    if (import.meta.env['VITE_REVEAL_SHOTS']) await page.screenshot({ path: `__shots__/reveal-summary-${width}.png` });
  }, 60_000);
}
