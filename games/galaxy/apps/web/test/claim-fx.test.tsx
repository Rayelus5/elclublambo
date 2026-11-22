import { pieceName } from '@galaxy/shared';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../src/copy/es';
import { useClaimFx } from '../src/missions/ClaimFx';
import { MissionsScreen } from '../src/missions/MissionsScreen';
import type { Reward } from '../src/missions/ready';
import { jsonResponse, mockApi, renderAt } from './render';

// The reward flying to the wallet: event signals fly as their own purple ticket (to the event ticket of the wallet),
// never as normal signals, whose counter they do not raise.

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById('fx-host')?.remove();
});

function Burst({ reward }: { reward: Reward }) {
  const { burst, view } = useClaimFx(false);
  useEffect(() => burst(document.body, reward), [burst, reward]);
  return view;
}

test('las señales de evento vuelan como su propio ticket y las normales como el suyo', () => {
  act(() => {
    render(<Burst reward={{ eventSignals: 3 }} />);
  });
  expect(document.querySelectorAll('.claim-chip.event-signal').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.claim-chip.signal')).toHaveLength(0);
});

test('una meta que da de las dos hace volar los dos tickets', () => {
  act(() => {
    render(<Burst reward={{ signal: 1, eventSignals: 2 }} />);
  });
  expect(document.querySelectorAll('.claim-chip.event-signal').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.claim-chip.signal').length).toBeGreaterThan(0);
});

// Generalised for the season screen (season shop plan, PR 4): the chips fly to any wallet marked `data-wallet`, the
// season currency flies as its shard, and a piece (title, frame, avatar, skin) pops from where it was collected as a
// little card with its name, with no flight. Reduced motion: nothing.

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function BurstFrom({ reward, reduced = false }: { reward: Reward; reduced?: boolean }) {
  const { burst, view } = useClaimFx(reduced);
  useEffect(() => burst(document.getElementById('from'), reward), [burst, reward]);
  return view;
}

function withWallet(kind: string) {
  const host = document.createElement('div');
  host.id = 'fx-host';
  host.innerHTML = `<div data-wallet><span class="res ${kind}"></span></div><button id="from"></button>`;
  document.body.appendChild(host);
  document.querySelector<HTMLElement>(`[data-wallet] .res.${kind}`)!.getBoundingClientRect = () => rect(500, 20, 100, 38);
  document.getElementById('from')!.getBoundingClientRect = () => rect(90, 390, 20, 20);
}

test('los chips vuelan al chip de su moneda en el monedero marcado con data-wallet', () => {
  withWallet('coins');
  act(() => {
    render(<BurstFrom reward={{ coins: 300 }} />);
  });
  const chips = [...document.querySelectorAll<HTMLElement>('.claim-chip.coins')];
  expect(chips).toHaveLength(4);
  // From the middle of the button (100, 400) to the chip's icon (514, 39): the first chip starts 15 px to the left.
  expect(chips[0]!.style.getPropertyValue('--dx')).toBe(`${514 - 100 + 15}px`);
  expect(chips[0]!.style.getPropertyValue('--dy')).toBe(`${39 - 400}px`);
});

test('las Esquirlas vuelan como su esquirla a su chip', () => {
  withWallet('shards');
  act(() => {
    render(<BurstFrom reward={{ shards: 30 }} />);
  });
  const chips = [...document.querySelectorAll<HTMLElement>('.claim-chip.shards')];
  expect(chips.length).toBeGreaterThan(0);
  expect(chips[0]!.style.getPropertyValue('--dy')).toBe(`${39 - 400}px`);
});

test('una pieza sale como tarjeta con su nombre donde se recoge, sin volar', () => {
  withWallet('coins');
  act(() => {
    render(<BurstFrom reward={{ coins: 100, title: 'Pionero', skin: 'skin-lumen-aurora' }} />);
  });
  const cards = [...document.querySelectorAll<HTMLElement>('.claim-piece')];
  expect(cards.map((c) => c.textContent)).toEqual([`${copy.missions.piece.title}Pionero`, `${copy.missions.piece.skin}${pieceName('skin', 'skin-lumen-aurora')}`]);
  expect(cards[0]!.style.left).toBe('100px');
  expect(cards[0]!.style.getPropertyValue('--dx')).toBe('');
  expect(document.querySelectorAll('.claim-chip.coins').length).toBeGreaterThan(0);
});

test('con movimiento reducido no vuela ni sale nada', () => {
  withWallet('coins');
  act(() => {
    render(<BurstFrom reward={{ coins: 100, shards: 5, title: 'Pionero' }} reduced />);
  });
  expect(document.querySelector('.claim-chip, .claim-piece')).toBeNull();
});

test('en Misiones el monedero está marcado con data-wallet, así que los chips siguen llegando a él', async () => {
  mockApi({
    'GET /galaxy/api/missions': () => jsonResponse(200, { daily: null, weekly: null, season: null, events: [], achievements: [], ready: 0, cosmetics: { titles: [], frames: [], title: null, frame: null } }),
    'GET /galaxy/api/gacha': () => jsonResponse(200, { banners: [], costs: { coins: 100, coinsFive: 475, coinsTen: 900, signals: 1 }, freePullAvailable: false, wallet: { coins: 10, dust: 2, signal: 1 } }),
  });
  renderAt('/misiones', { '/misiones': <MissionsScreen /> });
  await vi.waitFor(() => expect(document.querySelector('.missions-wallet[data-wallet] .res.coins')).not.toBeNull());
});

test('una galaxia, una sonda o un recurso de la temporada salen como tarjeta; la galaxia con el color de su rareza', () => {
  withWallet('coins');
  act(() => {
    render(
      <BurstFrom
        reward={{
          cards: [
            { kind: 'galaxy', name: 'Galaxia épica', tier: 'epic' },
            { kind: 'probe', name: 'Bastión' },
            { kind: 'resource', name: '500 de material en bruto' },
          ],
        }}
      />,
    );
  });
  const cards = [...document.querySelectorAll<HTMLElement>('.claim-piece')];
  expect(cards.map((c) => c.textContent)).toEqual([`${copy.missions.piece.galaxy}Galaxia épica`, `${copy.missions.piece.probe}Bastión`, `${copy.missions.piece.resource}500 de material en bruto`]);
  expect(cards[0]!.dataset.tier).toBe('epic');
  expect(document.querySelector('.claim-chip')).toBeNull();
});
