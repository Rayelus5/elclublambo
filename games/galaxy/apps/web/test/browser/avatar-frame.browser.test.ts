import type { ChatMessage, LeaderRow } from '@galaxy/shared';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { ChatMessageItem } from '../../src/chat/ChatMessageItem';
import { Avatar } from '../../src/hub/Avatar';
import { Podium } from '../../src/social/parts';
import '../../src/styles/app.css';

// A frame is drawn a quarter of the avatar's side round it (Nov plan C2); where avatars sit in a list, the layout keeps
// that room, so the frame covers neither the name nor the message (owner, 2026-11-12). With VITE_CHAT_SHOTS=1 it saves a
// screenshot.

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = '';
});

const message = (username: string, frame: string | null): ChatMessage => ({ id: username, channel: 'global', author: { username, level: 12, clan: 'NEB', avatar: 'crew-cat', frame }, body: 'Alguien para la Fisura esta noche', at: '2026-11-12T08:00:00.000Z' });

test('en el chat, el marco del avatar no tapa ni el nombre ni el mensaje', async () => {
  await page.viewport(1280, 720);
  const host = document.createElement('ul');
  host.className = 'chat-list';
  host.style.cssText = 'inline-size:420px;padding:16px;list-style:none;margin:0';
  document.body.append(host);
  root = createRoot(host);
  const props = { own: false, showClan: true, moderator: false, canReport: true, reported: false, busy: false, onReport: () => {}, onHide: () => {}, onMute: () => {} };
  flushSync(() => root!.render(createElement(MemoryRouter, null, createElement(ChatMessageItem, { m: message('vega', 'prism'), ...props }), createElement(ChatMessageItem, { m: message('lyra', null), ...props }))));
  const [framed, plain] = [...host.querySelectorAll<HTMLElement>('.chat-msg')];
  const ring = framed!.querySelector('.avatar-frame')!.getBoundingClientRect();
  for (const row of [framed!, plain!]) {
    const main = row.querySelector('.chat-msg-main')!.getBoundingClientRect();
    const name = row.querySelector('.chat-author')!.getBoundingClientRect();
    expect(ring.right).toBeLessThanOrEqual(main.left);
    // Both rows start their text at the same place, framed or not.
    expect(name.left).toBe(framed!.querySelector('.chat-author')!.getBoundingClientRect().left);
  }
  expect(ring.top).toBeGreaterThanOrEqual(framed!.getBoundingClientRect().top);
  if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: '__shots__/chat-frames.png', element: host });
});

test('el podio de la clasificación: avatares grandes con su marco dentro de su caja, sin tapar el nombre', async () => {
  await page.viewport(1600, 900);
  const host = document.createElement('div');
  host.className = 'leaderboard';
  host.style.cssText = 'inline-size:1100px';
  document.body.append(host);
  // As on the leaderboard: its main column carries the podium's own sizes (.lb-main > .podium).
  const main = document.createElement('div');
  main.className = 'lb-main';
  host.append(main);
  root = createRoot(main);
  const rows: LeaderRow[] = [
    { rank: 1, username: 'vega', level: 31, value: 18400, avatar: 'crew-cat', frame: 'prism' },
    { rank: 2, username: 'lyra', level: 24, value: 12950, avatar: 'shop-star-fox', frame: null },
    { rank: 3, username: 'deneb', level: 19, value: 9800, avatar: 'crew-pilot', frame: 'solar' },
  ];
  flushSync(() => root!.render(createElement(MemoryRouter, null, createElement(Podium, { rows, tab: 'general', me: undefined, large: true }))));
  for (const li of host.querySelectorAll<HTMLElement>('.podium li')) {
    const box = li.querySelector('.podium-avatar')!.getBoundingClientRect();
    const ring = (li.querySelector('.avatar-frame') ?? li.querySelector('.avatar-box'))!.getBoundingClientRect();
    expect(ring.top).toBeGreaterThanOrEqual(box.top);
    expect(ring.bottom).toBeLessThanOrEqual(box.bottom);
    expect(ring.left).toBeGreaterThanOrEqual(box.left);
    expect(ring.right).toBeLessThanOrEqual(box.right);
    expect(li.querySelector('.podium-who b')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom);
  }
  if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: '__shots__/podium-large.png', element: host });
});

// Plan «escáner pro», part E (the owner: «hacer invisible los estilos de podium-avatar y profile-avatar para que los
// usuarios con marco tengan como borde el propio marco… los usuarios sin marco tienen menos ancho… deberían ocupar todos
// lo mismo»): no box behind the avatar, and framed or not, the same outer size — a frameless avatar fills the frame's room.
const outer = (el: Element) => (el.querySelector('.avatar-frame') ?? el.querySelector('.avatar-box'))!.getBoundingClientRect();

test('en el podio, con marco o sin él, cada avatar mide lo mismo por fuera y su caja no se ve', async () => {
  await page.viewport(1600, 900);
  const main = document.createElement('div');
  main.className = 'lb-main';
  main.style.cssText = 'inline-size:1100px';
  document.body.append(main);
  root = createRoot(main);
  const rows: LeaderRow[] = [
    { rank: 1, username: 'vega', level: 31, value: 18400, avatar: 'crew-cat', frame: 'prism' },
    { rank: 2, username: 'lyra', level: 24, value: 12950, avatar: 'shop-star-fox', frame: null },
    { rank: 3, username: 'deneb', level: 19, value: 9800, avatar: 'crew-pilot', frame: 'solar' },
  ];
  flushSync(() => root!.render(createElement(MemoryRouter, null, createElement(Podium, { rows, tab: 'general', me: undefined, large: true }))));
  const [first, second, third] = [...main.querySelectorAll<HTMLElement>('.podium li')];
  // Second (no frame) and third (framed) share a size: the same outer box.
  expect(Math.abs(outer(second!).width - outer(third!).width)).toBeLessThanOrEqual(1);
  expect(Math.abs(outer(second!).height - outer(third!).height)).toBeLessThanOrEqual(1);
  expect(outer(first!).width).toBeGreaterThan(outer(second!).width);
  for (const li of [first!, second!, third!]) {
    const box = li.querySelector<HTMLElement>('.podium-avatar')!;
    const style = getComputedStyle(box);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(style.boxShadow).toBe('none');
    const r = box.getBoundingClientRect();
    const o = outer(li);
    expect(o.left).toBeGreaterThanOrEqual(r.left - 0.5);
    expect(o.right).toBeLessThanOrEqual(r.right + 0.5);
  }
  if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: '__shots__/podium-outer.png', element: main });
});

test('en el perfil, el avatar sin marco ocupa lo mismo que uno con marco, sin caja detrás', async () => {
  await page.viewport(1280, 720);
  const host = document.createElement('div');
  host.style.cssText = 'display:flex;gap:24px;padding:24px';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      createElement(
        'div',
        { style: { display: 'flex', gap: '24px' } },
        createElement('span', { className: 'profile-avatar', key: 'a' }, createElement(Avatar, { name: 'vega', avatar: 'crew-cat', frame: 'prism', size: 144, fit: 'outer' })),
        createElement('span', { className: 'profile-avatar', key: 'b' }, createElement(Avatar, { name: 'lyra', avatar: 'crew-cat', frame: null, size: 144, fit: 'outer' })),
      ),
    ),
  );
  const [framed, plain] = [...host.querySelectorAll<HTMLElement>('.profile-avatar')];
  expect(Math.round(outer(framed!).width)).toBe(144);
  expect(Math.round(outer(plain!).width)).toBe(144);
  expect(getComputedStyle(framed!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(framed!).boxShadow).toBe('none');
  if (import.meta.env['VITE_CHAT_SHOTS']) await page.screenshot({ path: '__shots__/profile-outer.png', element: host });
});
