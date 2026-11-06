// The access backdrop's sequence (DESIGN_SYSTEM §8), as a pure state machine. Galaxy ids count up from 1: `shown` is
// the one on screen, `incoming` the one being prepared and then faded in — never more than two alive. `now` is the
// backdrop's own clock, which only advances while the tab is visible, so a hidden tab freezes the sequence.
//
//   waiting ──first ready──▶ scanning (SCAN_MS) ─▶ showing (SHOW_MS, next requested) ─next ready─▶ fading (FADE_MS)
//                                                      ▲                                                │
//                                                      └──────────────── incoming becomes shown ────────┘
// With reduced motion: one galaxy, shown still, forever.
export const SCAN_MS = 3200;
export const SHOW_MS = 14000;
export const FADE_MS = 5000;
/** Rigid rotation and zoom over a galaxy's whole life: slow enough that it never looks like it changes shape. */
const LIFE_MS = SCAN_MS + SHOW_MS + FADE_MS;
const ROTATE_DEG = -7;
const ZOOM = 0.045;
const BREATH_MS = 7000;
const BREATH = 0.06;

export type Phase = 'waiting' | 'scanning' | 'showing' | 'fading';

export interface BackdropState {
  phase: Phase;
  /** Clock time when the phase started. */
  since: number;
  shown: number;
  incoming: number;
  incomingReady: boolean;
  /** Clock time when each alive galaxy started to appear (its scan). */
  bornShown: number;
  bornIncoming: number;
  reduced: boolean;
}

export function initialState(reduced: boolean): BackdropState {
  return { phase: 'waiting', since: 0, shown: 0, incoming: 1, incomingReady: false, bornShown: 0, bornIncoming: 0, reduced };
}

/** The render for galaxy `id` is composed and can appear. */
export function galaxyReady(state: BackdropState, id: number): BackdropState {
  return id === state.incoming && !state.incomingReady ? { ...state, incomingReady: true } : state;
}

export function nextPhase(state: BackdropState, now: number): BackdropState {
  const s = state;
  switch (s.phase) {
    case 'waiting':
      if (!s.incomingReady) return s;
      return {
        ...s,
        phase: s.reduced ? 'showing' : 'scanning',
        since: now,
        shown: s.incoming,
        bornShown: now,
        incoming: 0,
        incomingReady: false,
      };
    case 'scanning':
      if (now - s.since < SCAN_MS) return s;
      return { ...s, phase: 'showing', since: s.since + SCAN_MS, incoming: s.shown + 1, incomingReady: false };
    case 'showing':
      if (s.reduced) return s;
      if (s.incoming === 0) return { ...s, incoming: s.shown + 1, incomingReady: false };
      if (now - s.since < SHOW_MS || !s.incomingReady) return s;
      return { ...s, phase: 'fading', since: now, bornIncoming: now };
    case 'fading':
      if (now - s.since < FADE_MS) return s;
      return {
        ...s,
        phase: 'showing',
        since: s.since + FADE_MS,
        shown: s.incoming,
        bornShown: s.bornIncoming,
        incoming: s.incoming + 1,
        incomingReady: false,
      };
  }
}

export interface LayerStyle {
  id: number;
  opacity: number;
  /** Fraction of the galaxy already resolved by the scan line, from the top. */
  reveal: number;
  rotate: number;
  scale: number;
  /** Brightness multiplier (the glow breathes). */
  glow: number;
}

const ease = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

function drift(id: number, born: number, now: number, reduced: boolean): Omit<LayerStyle, 'opacity' | 'reveal'> {
  if (reduced) return { id, rotate: 0, scale: 1, glow: 1 };
  const age = Math.max(now - born, 0);
  return {
    id,
    rotate: ROTATE_DEG * (age / LIFE_MS),
    scale: 1 + ZOOM * Math.min(age / LIFE_MS, 1),
    glow: 1 + BREATH * Math.sin((2 * Math.PI * age) / BREATH_MS),
  };
}

/** What each mounted galaxy layer looks like at `now` (at most two). */
export function layerStyles(s: BackdropState, now: number): LayerStyle[] {
  if (s.phase === 'waiting' || s.shown === 0) return [];
  const t = now - s.since;
  const shown = drift(s.shown, s.bornShown, now, s.reduced);
  if (s.phase === 'scanning') return [{ ...shown, opacity: 1, reveal: Math.min(t / SCAN_MS, 1) }];
  if (s.phase === 'showing') return [{ ...shown, opacity: 1, reveal: 1 }];
  const f = t / FADE_MS;
  return [
    { ...shown, opacity: 1 - ease(f), reveal: 1 },
    { ...drift(s.incoming, s.bornIncoming, now, s.reduced), opacity: ease(f * 1.4), reveal: Math.min(t / SCAN_MS, 1) },
  ];
}
