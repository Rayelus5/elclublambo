import { renderFromSeed, TRAITS, type Lod } from '@galaxy/engine';
import type { GalaxySummary } from '@galaxy/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CardBack } from '../src/cards/CardBack';
import { GalaxyCard } from '../src/cards/GalaxyCard';
import { copy } from '../src/copy/es';
import { requestGalaxy } from '../src/galaxy/client';

// Galaxy cards (GDD §8.1): what a card says to everyone, how it tilts, and how a big collection loads only what is on
// screen without flooding the engine Worker.
vi.mock('../src/galaxy/client', () => ({ requestGalaxy: vi.fn() }));
vi.mock('../src/galaxy/compose', () => ({ composeInto: vi.fn(() => 'webgl') }));
const request = vi.mocked(requestGalaxy);

/** A stand-in IntersectionObserver the test drives by hand. */
class FakeObserver {
  static last: FakeObserver | null = null;
  readonly targets = new Set<Element>();
  constructor(private readonly cb: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  show(els: Element[], visible = true) {
    act(() => this.cb(els.map((target) => ({ target, isIntersecting: visible }) as IntersectionObserverEntry), this as never));
  }
}

const galaxy = (over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id: 'g1',
  seed: '12345',
  tier: 'legendary',
  finish: 'holo',
  traits: { galaxy_type: 'spiral', palette: 'andromeda_blue', phenomenon: 'pulsar' },
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 3,
  createdAt: '2026-11-06T20:00:00Z',
  ...over,
});

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  request.mockReset();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

test('la carta dice su nombre, nivel, rareza y acabado en texto accesible', () => {
  request.mockReturnValue(new Promise(() => {}));
  render(<GalaxyCard galaxy={galaxy()} />);
  const card = screen.getByRole('article', { name: 'Kathra' });
  expect(card).toHaveTextContent(copy.card.level(3));
  expect(card).toHaveTextContent(copy.tiers.legendary);
  expect(card).toHaveTextContent(copy.finishes.holo);
  expect(card).toHaveTextContent('GX-ABCDEF');
});

test('una carta normal no anuncia acabado', () => {
  request.mockReturnValue(new Promise(() => {}));
  render(<GalaxyCard galaxy={galaxy({ finish: 'normal' })} />);
  expect(screen.getByRole('article', { name: 'Kathra' })).not.toHaveTextContent(copy.finishes.normal);
});

function pointAt(el: HTMLElement, x: number, y: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 280, right: 200, bottom: 280, x: 0, y: 0, toJSON() {} });
  fireEvent.pointerMove(el, { clientX: x, clientY: y });
}

test('la carta interactiva se inclina hacia el ratón y mueve el brillo', () => {
  reducedMotion(false);
  request.mockReturnValue(new Promise(() => {}));
  const { container } = render(<GalaxyCard galaxy={galaxy()} interactive />);
  const tilt = container.querySelector<HTMLElement>('.gcard-tilt')!;
  pointAt(tilt, 150, 70);
  expect(Number.parseFloat(tilt.style.getPropertyValue('--ry'))).toBeGreaterThan(0);
  expect(Number.parseFloat(tilt.style.getPropertyValue('--rx'))).toBeGreaterThan(0);
  expect(tilt.style.getPropertyValue('--mx')).toBe('75%');
  fireEvent.pointerLeave(tilt);
  expect(tilt.style.getPropertyValue('--ry')).toBe('0deg');
});

test('con movimiento reducido la carta no se inclina', () => {
  reducedMotion(true);
  request.mockReturnValue(new Promise(() => {}));
  const { container } = render(<GalaxyCard galaxy={galaxy()} interactive />);
  const tilt = container.querySelector<HTMLElement>('.gcard-tilt')!;
  pointAt(tilt, 150, 70);
  expect(tilt.style.getPropertyValue('--ry')).toBe('');
  expect(tilt.style.getPropertyValue('--rx')).toBe('');
});

test('con 200 cartas solo se piden las visibles y nunca más de 12 a la vez', async () => {
  let inFlight = 0;
  let peak = 0;
  const pending: { seed: bigint; resolve: () => void }[] = [];
  request.mockImplementation((seed: bigint, _columns: Lod, _fixed?: unknown, signal?: AbortSignal) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise((resolve, reject) => {
      const done = () => inFlight--;
      signal?.addEventListener('abort', () => {
        done();
        reject(new DOMException('aborted', 'AbortError'));
      });
      pending.push({ seed, resolve: () => (done(), resolve({ text: '' } as never)) });
    });
  });
  const cards = Array.from({ length: 200 }, (_, i) => galaxy({ id: `g${i}`, seed: String(1000 + i), name: `G${i}` }));
  const { container } = render(
    <div>
      {cards.map((g) => (
        <GalaxyCard key={g.id} galaxy={g} />
      ))}
    </div>,
  );
  const els = [...container.querySelectorAll('article')];
  expect(request).not.toHaveBeenCalled();

  // 30 cards scroll into view: 12 go to the Worker, the rest wait.
  FakeObserver.last!.show(els.slice(0, 30));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(12));
  const visible = new Set(cards.slice(0, 30).map((g) => BigInt(g.seed)));
  expect(request.mock.calls.every(([seed]) => visible.has(seed))).toBe(true);

  // Cards 20–29 scroll away before their turn: they are never requested.
  FakeObserver.last!.show(els.slice(20, 30), false);
  while (pending.length > 0) {
    await act(async () => pending.shift()!.resolve());
  }
  await waitFor(() => expect(request).toHaveBeenCalledTimes(20));
  expect(new Set(request.mock.calls.map(([seed]) => seed))).toEqual(new Set(cards.slice(0, 20).map((g) => BigInt(g.seed))));
  expect(peak).toBeLessThanOrEqual(12);
});

test('el reverso muestra exactamente el braille de 48 columnas de su semilla y sus rasgos', async () => {
  request.mockImplementation(async (seed: bigint, columns: Lod) => renderFromSeed(seed, { columns }));
  const g = galaxy({ seed: '777', traits: { galaxy_type: 'ring', palette: 'solar_gold', phenomenon: 'none' } });
  const { container } = render(<CardBack galaxy={g} />);
  const expected = renderFromSeed(777n, { columns: 48 }).text;
  await waitFor(() => expect(container.querySelector('.relief')?.textContent).toBe(expected));
  expect(request).toHaveBeenCalledWith(777n, 48, undefined, expect.any(AbortSignal));
  expect(screen.getByText(copy.traitValues.galaxy_type.ring)).toBeInTheDocument();
  expect(screen.getByText(copy.traitValues.palette.solar_gold)).toBeInTheDocument();
});

test('todos los rasgos del motor tienen nombre en español', () => {
  for (const key of TRAITS.drawOrder) {
    expect(copy.traitNames[key], key).toBeTruthy();
    for (const v of TRAITS.traits[key].values) {
      if (key === 'arms') continue; // a number, shown as is
      expect((copy.traitValues as Record<string, Record<string, string>>)[key]?.[v.value], `${key}=${v.value}`).toBeTruthy();
    }
  }
});
