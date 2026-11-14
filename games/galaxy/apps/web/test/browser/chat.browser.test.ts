import type { ChatHistory, ChatMessage, MeResponse } from '@galaxy/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ChatHost } from '../../src/chat/ChatPanel';
import { copy } from '../../src/copy/es';
import { useUi } from '../../src/state/ui';
import '../../src/styles/app.css';

// The chat in a real browser (the owner's chat asks, 2026-11-14): the side sheet with its tabs and their unread counts,
// days apart, an author's messages joined, a mention of me highlighted, and the mention box over the field; then the
// whole screen. Nothing grows sideways, the log scrolls inside, and the field stays in sight. Screenshots with
// VITE_CHAT_SHOTS=1.

const ME = 'sonda_rayo';
const me: MeResponse = { id: 'a1', username: ME, roles: [], mfa: false, level: 9 };
const at = (daysAgo: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const who = (username: string, level: number, clan: string | null = 'GX', avatar: string | null = null) => ({ username, level, clan, avatar, frame: null });
const messages: ChatMessage[] = [
  { id: '1', channel: 'global', author: who('vega', 14), body: 'Alguien sabe cómo se desbloquea el sector de hielo', at: at(1, 21, 4) },
  { id: '2', channel: 'global', author: who('lyra', 9, null), body: 'Purga dos Núcleos en la capa 3 y te sale', at: at(1, 21, 6) },
  { id: '3', channel: 'global', author: who('vega', 14), body: 'Gracias', at: at(1, 21, 7) },
  { id: '4', channel: 'global', author: who('orion_7', 22, 'NOVA'), body: 'Buenas a todos. Hoy hay doble de polvo hasta las 23:00', at: at(0, 9, 30) },
  { id: '5', channel: 'global', author: who('orion_7', 22, 'NOVA'), body: 'Aprovechad para fusionar', at: at(0, 9, 31) },
  { id: '6', channel: 'global', author: who('deneb', 5, null), body: `@${ME} ¿te vienes a una incursión en grupo?`, at: at(0, 9, 40) },
  { id: '7', channel: 'global', author: who(ME, 9, null), body: 'Voy, dame un minuto', at: at(0, 9, 41) },
  { id: '8', channel: 'global', author: who('lyra', 9, null), body: 'Yo también me apunto, ¿cuántos sois?', at: at(0, 9, 43) },
];
const history: ChatHistory = { channel: 'global', messages, canWrite: true, reason: null, minLevel: 2, maxLength: 280, moderator: false };
const DATA: Record<string, unknown> = {
  '/galaxy/api/auth/me': me,
  '/galaxy/api/chat/global': history,
  '/galaxy/api/clans/mine': { tag: 'GX', name: 'Galácticos', me: { role: 'member' } },
  '/galaxy/api/rooms': { mine: null, open: [], allowed: true, reason: null, minLevel: 1, waitUntil: null },
  '/galaxy/api/chat/unread': { global: 0, clan: 7, room: null, mentions: { global: 0, clan: 1, room: 0 } },
  '/galaxy/api/chat/mentions?q=ly': { players: [{ username: 'lyra', avatar: null, frame: null }, { username: 'lyrael', avatar: null, frame: null }] },
};

let root: Root | null = null;
afterEach(() => {
  useUi.getState().closeChat();
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

for (const [w, h] of [
  [1280, 720],
  [1920, 1080],
] as const) {
  test(`el chat a ${w}×${h}: hoja, días, autores juntos, mención y pantalla completa`, async () => {
    await page.viewport(w, h);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.method === 'POST' ? { id: '8' } : (DATA[url] ?? {});
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    document.body.style.cssText = 'margin:0;background:#0b0e2a';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(MemoryRouter, null, createElement(Fragment, null, createElement(ChatHost)))));
    // Opened once the session is known (without one the sheet closes itself).
    await expect
      .poll(() => {
        if (!document.querySelector('.chat-sheet')) useUi.getState().openChat('global');
        return document.querySelector('.chat-sheet') !== null;
      })
      .toBe(true);
    await expect.poll(() => document.querySelectorAll('.chat-msg').length, { timeout: 5000 }).toBe(8);
    await new Promise((r) => setTimeout(r, 400));
    const sheet = document.querySelector<HTMLElement>('.chat-sheet')!;
    const box = sheet.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(w);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    // The days and the joined messages.
    expect([...document.querySelectorAll('.chat-day')].map((d) => d.textContent)).toEqual([copy.chat.yesterday, copy.chat.today]);
    expect(document.querySelectorAll('.chat-msg.cont')).toHaveLength(1);
    expect(document.querySelector('.chat-msg.mentions-me')).not.toBeNull();
    // The clan tab says what waits in it.
    expect(document.querySelector('[data-channel="clan"] .chat-unread')?.textContent).toBe('@');
    // The field stays in sight under the log.
    const field = document.querySelector<HTMLElement>('.chat-compose textarea')!.getBoundingClientRect();
    expect(field.bottom).toBeLessThanOrEqual(box.bottom);
    // The mention box over the field.
    await userEvent.type(document.querySelector<HTMLTextAreaElement>('.chat-compose textarea')!, 'hola @ly');
    await expect.poll(() => document.querySelector('.chat-mentions')).not.toBeNull();
    const list = document.querySelector<HTMLElement>('.chat-mentions')!.getBoundingClientRect();
    expect(list.bottom).toBeLessThanOrEqual(field.top + 1);
    expect(list.top).toBeGreaterThanOrEqual(box.top);
    if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: `__shots__/chat-${w}.png` });
    // The whole screen: centred and inside the window.
    await userEvent.click(document.querySelector<HTMLButtonElement>('.chat-full')!);
    await new Promise((r) => setTimeout(r, 200));
    const full = document.querySelector<HTMLElement>('.chat-sheet.full')!.getBoundingClientRect();
    expect(full.left).toBeGreaterThanOrEqual(0);
    expect(full.right).toBeLessThanOrEqual(w);
    expect(Math.abs(full.left + full.width / 2 - w / 2)).toBeLessThan(2);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(w);
    if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: `__shots__/chat-full-${w}.png` });
  });
}
