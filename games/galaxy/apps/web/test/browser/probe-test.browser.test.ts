import { PROBE_TEST } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { ProbeTestScreen } from '../../src/probe-test/ProbeTest';
import '../../src/styles/app.css';

// The probe test with the app's real styles, for review screenshots (VITE_ARENA_SHOTS=1).

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient();
  root.render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(ProbeTestScreen))));
}

test('la pregunta y el revelado del test de la sonda', async () => {
  // The hangar says the test is still to take; the test gives Chispa.
  const answer = (url: string) => (url.endsWith('/hangar') ? { test: { taken: false, probe: null } } : { probe: 'spark' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(answer(url)), { status: 200, headers: { 'content-type': 'application/json' } })));
  await page.viewport(1440, 900);
  mount();
  await vi.waitFor(() => expect(document.querySelector('.probe-test .launch')).not.toBeNull());
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/probe-test-intro.png' });
  (document.querySelector('.probe-test .launch') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll('.probe-answer')).toHaveLength(3));
  (document.querySelectorAll('.probe-answer')[0] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('.probe-test-dots .done')).not.toBeNull());
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/probe-test-question.png' });
  for (let q = 1; q < 5; q++) {
    const i = PROBE_TEST.questions[q]!.answers.indexOf('spark');
    (document.querySelectorAll('.probe-answer')[i] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
  }
  // The last step asks to confirm before sending.
  await vi.waitFor(() => expect(document.querySelector('.probe-test .launch')).not.toBeNull());
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/probe-test-confirm.png' });
  (document.querySelector('.probe-test .launch') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('.probe-reveal-art')).not.toBeNull(), { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1200));
  if (import.meta.env['VITE_ARENA_SHOTS']) await page.screenshot({ path: '__shots__/probe-test-reveal.png' });
}, 60_000);
