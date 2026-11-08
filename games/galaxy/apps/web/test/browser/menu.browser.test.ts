import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { MainMenu } from '../../src/hub/MainMenu';
import '../../src/styles/app.css';

// The title menu in a real Chromium (M6d-1, the owner's request): the illustrated icon of Supervivencia, Hogar and
// Eventos sits in the middle of its square chip (the filters' own .chip padding and lip do not reach it).
test('el icono de Supervivencia, Hogar y Eventos queda centrado en su recuadro', async () => {
  await page.viewport(1400, 900);
  const host = document.createElement('div');
  host.style.width = '700px';
  document.body.append(host);
  const client = new QueryClient();
  flushSync(() => createRoot(host).render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(MainMenu, { galaxies: 3 })))));
  const chips = host.querySelectorAll<HTMLElement>('.mode .chip, .event .chip');
  expect(chips.length).toBeGreaterThanOrEqual(3);
  for (const chip of chips) {
    const box = chip.getBoundingClientRect();
    const icon = chip.querySelector('svg, .ico')!.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - (icon.left + icon.width / 2))).toBeLessThan(1);
    expect(Math.abs(box.top + box.height / 2 - (icon.top + icon.height / 2))).toBeLessThan(1);
  }
  host.remove();
});
