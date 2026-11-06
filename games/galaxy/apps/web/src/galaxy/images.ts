import type { BrailleRender, Lod } from '@galaxy/engine';
import { GalaxyCache, galaxyKey } from './cache';
import { requestGalaxy } from './client';

// Galaxy renders for cards (GDD §18.3): from the cache when possible, otherwise from the engine Worker, with at most
// MAX_IN_FLIGHT requests handed to it at once so a big collection never floods it. Requests wait in order; one whose
// card leaves the screen (its signal aborts) is dropped before it is ever sent.
export const MAX_IN_FLIGHT = 12;

let cache: GalaxyCache | null = null;
const renders = () => (cache ??= new GalaxyCache());

type Ticket = { seed: bigint; columns: Lod; signal: AbortSignal; resolve: (r: BrailleRender) => void; reject: (e: unknown) => void };
const waiting: Ticket[] = [];
let inFlight = 0;

const abortError = () => new DOMException('The galaxy image was not needed any more', 'AbortError');

function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const t = waiting.shift()!;
    if (t.signal.aborted) {
      t.reject(abortError());
      continue;
    }
    inFlight++;
    requestGalaxy(t.seed, t.columns, undefined, t.signal)
      .then((render) => {
        void renders().put(galaxyKey(t.seed, t.columns), render);
        t.resolve(render);
      }, t.reject)
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}

/** The render of `seed` at `columns` (cache first). Aborting `signal` drops it from the queue or discards its result. */
export async function loadRender(seed: bigint, columns: Lod, signal: AbortSignal): Promise<BrailleRender> {
  const hit = await renders().get(galaxyKey(seed, columns));
  if (signal.aborted) throw abortError();
  if (hit) return hit;
  return new Promise<BrailleRender>((resolve, reject) => {
    const ticket: Ticket = { seed, columns, signal, resolve, reject };
    signal.addEventListener(
      'abort',
      () => {
        const i = waiting.indexOf(ticket);
        if (i >= 0) {
          waiting.splice(i, 1);
          reject(abortError());
        }
      },
      { once: true },
    );
    waiting.push(ticket);
    pump();
  });
}

// One IntersectionObserver for every card (hundreds of them), with a margin so the next row starts loading early.
// Without IntersectionObserver everything counts as visible: the in-flight cap still applies.
type Watcher = (visible: boolean) => void;
const watchers = new Map<Element, Watcher>();
let observer: IntersectionObserver | null = null;

export function watchVisibility(el: Element, onChange: Watcher): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) watchers.get(e.target)?.(e.isIntersecting);
    },
    { rootMargin: '240px' },
  );
  watchers.set(el, onChange);
  observer.observe(el);
  return () => {
    watchers.delete(el);
    observer?.unobserve(el);
  };
}
