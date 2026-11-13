import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Briefing } from '../../src/arena/hud/Briefing';
import '../../src/styles/app.css';

// The first run's briefing in a real browser: four things to know (SIM 1.12.0 added the dash: its key goes down and
// the probe jumps), side by side and inside the screen. VITE_ARENA_SHOTS=1 saves it.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el briefing con sus cuatro pistas, la del dash incluida, cabe a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    document.body.style.cssText = 'margin:0;background:#070a1c;';
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(Briefing, { onLaunch: () => {}, onSkip: () => {} })));
    const tips = [...document.querySelectorAll<HTMLElement>('.briefing-tips li')];
    expect(tips).toHaveLength(4);
    expect(tips[3]!.textContent).toContain('Haz un dash');
    expect(tips[3]!.textContent).toContain('SHIFT o Espacio');
    // In one row, all within the card and the screen.
    const tops = new Set(tips.map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(tops.size).toBe(1);
    const card = document.querySelector<HTMLElement>('.briefing-card')!.getBoundingClientRect();
    for (const t of tips) expect(t.getBoundingClientRect().right).toBeLessThanOrEqual(card.right + 0.5);
    expect(card.bottom).toBeLessThanOrEqual(h);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_ARENA_SHOTS']) {
      await new Promise((r) => setTimeout(r, 250));
      await page.screenshot({ path: `__shots__/briefing-${w}.png` });
    }
  });
}
