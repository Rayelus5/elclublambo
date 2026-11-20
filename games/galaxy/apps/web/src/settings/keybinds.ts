import { KEYBIND_ACTIONS, type KeybindAction, KEYBIND_CODE } from '@galaxy/shared';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

// The run's controls, rebindable (the owner, 2026-11-14): every action has two slots, each a key (KeyboardEvent.code)
// or a mouse button (`Mouse0` left, `Mouse1` middle, `Mouse2` right). Aiming (the mouse) and the zoom (the wheel) are
// fixed, and Escape always pauses (it is never bound: it is how a capture is cancelled). A key taken by another action
// leaves it. Kept in this browser under a versioned key, checked on the way in, and on the account (settings/sync.ts).

export type Action = KeybindAction;
export type Binding = string | null;
export type Keybinds = Record<Action, [Binding, Binding]>;
export const ACTIONS = KEYBIND_ACTIONS;

export const DEFAULT_KEYBINDS: Readonly<Keybinds> = Object.freeze({
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  dash: ['ShiftLeft', 'Mouse0'],
  pick1: ['Digit1', 'Numpad1'],
  pick2: ['Digit2', 'Numpad2'],
  pick3: ['Digit3', 'Numpad3'],
  confirm: ['Enter', 'NumpadEnter'],
  pause: ['KeyP', null],
  mark: ['KeyQ', null],
}) as Keybinds;

const KEY = 'galaxy.keybinds';
const VERSION = 1;
/** Never bound: it pauses and cancels a capture. */
const RESERVED = new Set(['Escape']);

/** The two sides of a modifier are one key (either SHIFT dashes). */
function same(code: string): string {
  return code.replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, '$1');
}

const valid = (v: unknown): v is string => typeof v === 'string' && KEYBIND_CODE.test(v) && !RESERVED.has(v);

/** What was kept, checked: unknown actions and odd codes go, a slot given wrong is empty, one missing is the default. */
export function sanitizeKeybinds(raw: unknown): Keybinds {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const used = new Set<string>();
  const out = {} as Keybinds;
  for (const a of ACTIONS) {
    const given = r[a];
    const pair: [Binding, Binding] = Array.isArray(given) && given.length === 2 ? [given[0] ?? null, given[1] ?? null] : [...DEFAULT_KEYBINDS[a]];
    out[a] = pair.map((b) => {
      if (!valid(b) || used.has(same(b))) return null;
      used.add(same(b));
      return b;
    }) as [Binding, Binding];
  }
  return out;
}

export function readStoredKeybinds(): Keybinds {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return structuredClone(DEFAULT_KEYBINDS) as Keybinds;
    const saved = JSON.parse(text) as { state?: unknown } | null;
    return sanitizeKeybinds(saved?.state);
  } catch {
    return structuredClone(DEFAULT_KEYBINDS) as Keybinds;
  }
}

const store = createStore<Keybinds>(() => readStoredKeybinds());

function save(next: Keybinds): void {
  store.setState(next, true);
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, state: next }));
  } catch {
    // Private windows: this page only.
  }
}

export const getKeybinds = (): Keybinds => store.getState();
export const onKeybinds = (fn: (k: Keybinds) => void): (() => void) => store.subscribe(fn);
export function useKeybinds(): Keybinds;
export function useKeybinds<T>(selector: (k: Keybinds) => T): T;
export function useKeybinds<T>(selector?: (k: Keybinds) => T) {
  return useStore(store, selector ?? ((k) => k as unknown as T));
}

/**
 * Puts `code` in `action`'s `slot` (null empties it). A key another action had leaves it: that action is returned (null
 * when none). Escape and odd codes are refused (nothing changes, null).
 */
export function setBinding(action: Action, slot: 0 | 1, code: Binding): Action | null {
  if (code !== null && !valid(code)) return null;
  const now = getKeybinds();
  const next = structuredClone(now) as Keybinds;
  let moved: Action | null = null;
  if (code !== null) {
    for (const a of ACTIONS) {
      next[a] = next[a].map((b, s) => {
        if (b === null || same(b) !== same(code) || (a === action && s === slot)) return b;
        if (a !== action) moved = a;
        return null;
      }) as [Binding, Binding];
    }
  }
  next[action][slot] = code;
  save(next);
  return moved;
}

/** Everything back as it comes (Ajustes › Incursión › «Restaurar por defecto»). */
export function resetKeybinds(): void {
  save(structuredClone(DEFAULT_KEYBINDS) as Keybinds);
}

/** Puts the account's controls in place (checked like what this browser keeps). */
export function applyKeybinds(raw: unknown): void {
  const next = sanitizeKeybinds(raw);
  if (JSON.stringify(next) !== JSON.stringify(getKeybinds())) save(next);
}

/** Whether `code` (a key's or `MouseN`) does `action` now. */
export function isAction(action: Action, code: string, binds: Keybinds = getKeybinds()): boolean {
  const c = same(code);
  return binds[action].some((b) => b !== null && same(b) === c);
}

/** The action `code` does (the first in order), or null. */
export function actionOf(code: string, binds: Keybinds = getKeybinds()): Action | null {
  return ACTIONS.find((a) => isAction(a, code, binds)) ?? null;
}

// Names for the keys: the layout's own (a Spanish «Ñ» where the code says Semicolon) when the browser tells, else these.
const NAMES: Record<string, string> = {
  Shift: 'SHIFT',
  Control: 'CTRL',
  Alt: 'ALT',
  Meta: 'META',
  Space: 'Espacio',
  Enter: 'Enter',
  NumpadEnter: 'Enter (num)',
  Tab: 'Tab',
  Backspace: 'Retroceso',
  CapsLock: 'Bloq Mayús',
  ArrowUp: 'Flecha arriba',
  ArrowDown: 'Flecha abajo',
  ArrowLeft: 'Flecha izquierda',
  ArrowRight: 'Flecha derecha',
  Mouse0: 'Clic izquierdo',
  Mouse1: 'Clic central',
  Mouse2: 'Clic derecho',
  Mouse3: 'Botón atrás',
  Mouse4: 'Botón adelante',
  Insert: 'Insert',
  Delete: 'Supr',
  Home: 'Inicio',
  End: 'Fin',
  PageUp: 'RePág',
  PageDown: 'AvPág',
};
let layout: Map<string, string> | null = null;

/** Reads the keyboard's layout once (Chromium), for the names of letters and signs. */
export function loadKeyboardLayout(): void {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  void kb?.getLayoutMap?.().then(
    (m) => {
      layout = m;
    },
    () => {},
  );
}

/** A key's or button's name as the player sees it («SHIFT», «Clic izquierdo», «W», «Num 1»); '' for none. */
export function keyLabel(code: Binding): string {
  if (!code) return '';
  const c = same(code);
  if (NAMES[c]) return NAMES[c]!;
  const fromLayout = layout?.get(code);
  if (fromLayout && fromLayout.trim()) return fromLayout.toUpperCase();
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1]!;
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  m = /^F(\d{1,2})$/.exec(code);
  if (m) return code;
  return code;
}

const CAPS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'Clic izq', Mouse1: 'Clic central', Mouse2: 'Clic der', NumpadEnter: 'Enter num' };

/** A key's short name for a key cap («↑», «Clic izq»); the full one is keyLabel. */
export function keyCap(code: Binding): string {
  if (!code) return '';
  return CAPS[code] ?? keyLabel(code);
}

/** The first key or button an action has, by name ('' when it has none). */
export function bindingOf(action: Action, binds: Keybinds = getKeybinds()): string {
  return keyLabel(binds[action][0] ?? binds[action][1]);
}

/** What the texts say of the controls (the briefing, PERKINS, the Guide, the hints, the dash meter). */
export interface KeyLabels {
  /** The four moves' first keys («WASD»), and whether their second ones are the arrows. */
  move: string;
  moveArrows: boolean;
  /** The dash's first key, and all of them («SHIFT o Clic izquierdo»). */
  dash: string;
  dashAll: string;
  pick: [string, string, string];
  confirm: string;
}

const NONE = 'sin tecla';

export function keyLabels(binds: Keybinds = getKeybinds()): KeyLabels {
  const first = (a: Action) => bindingOf(a, binds) || NONE;
  const moves = (['up', 'left', 'down', 'right'] as const).map((a) => bindingOf(a, binds));
  const arrows = (['up', 'left', 'down', 'right'] as const).every((a, k) => binds[a][1] === ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][k]);
  return {
    move: moves.every((m) => m.length === 1) ? moves.join('') : moves.filter(Boolean).join(', ') || NONE,
    moveArrows: arrows,
    dash: first('dash'),
    dashAll: bindingsOf('dash', binds) || NONE,
    pick: [first('pick1'), first('pick2'), first('pick3')],
    confirm: first('confirm'),
  };
}

/** The labels of the controls, following every change (Ajustes, the account). */
export function useKeyLabels(): KeyLabels {
  const binds = useKeybinds();
  return keyLabels(binds);
}

/** All the keys or buttons an action has, by name, joined with «o» («SHIFT o Clic izquierdo»). */
export function bindingsOf(action: Action, binds: Keybinds = getKeybinds()): string {
  return binds[action]
    .filter((b): b is string => b !== null)
    .map(keyLabel)
    .join(' o ');
}
