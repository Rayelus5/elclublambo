import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { MusicRehearsal } from '../../src/admin/MusicRehearsal';
import '../../src/styles/app.css';

// The music Ensayo in a real browser (plan «banda sonora», part A2): it fits the panel with no sideways scroll, its
// mixer lays out in columns. VITE_MUSIC_SHOTS=1 saves a screenshot.

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
  test(`el Ensayo de música cabe a ${w}×${h}`, async () => {
    await page.viewport(w, h);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root!.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(MusicRehearsal)))));
    await new Promise((r) => setTimeout(r, 300));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    const sliders = document.querySelectorAll('.music-mixer-row input[type="range"]');
    expect(sliders.length).toBeGreaterThan(4);
    if (import.meta.env['VITE_MUSIC_SHOTS']) await page.screenshot({ path: `__shots__/music-rehearsal-${w}.png` });
  });
}
