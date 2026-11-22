import { type KeyboardEvent, useRef } from 'react';

// The keys of a radio group after the WAI-ARIA pattern (DESIGN_SYSTEM §7; the segmented control, and the popups'
// scales, stars and options of «Encuestas y avisos», plan 2026-11-22): only the chosen item takes the Tab key (the
// first usable one while none is chosen); the arrows move to the next item and choose it, skipping disabled ones and
// wrapping round; Home and End go to the ends.

/** What an item of the group spreads on its element: where Tab stops, its keys and its ref (to move the focus). */
export interface RadioItemProps {
  ref: (el: HTMLElement | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/**
 * A group of `count` items, `selected` the chosen one (-1: none); `onPick` chooses another. `disabled` items are
 * skipped. `item(i)` gives the props of each item; `go(i)` focuses an item and chooses it (a click).
 */
export function useRadioKeys(count: number, selected: number, onPick: (index: number) => void, disabled: (index: number) => boolean = () => false) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const usable = Array.from({ length: count }, (_, i) => i).filter((i) => !disabled(i));
  const stop = selected >= 0 && usable.includes(selected) ? selected : (usable[0] ?? -1);

  const go = (index: number) => {
    if (index < 0 || index >= count) return;
    refs.current[index]?.focus();
    if (index !== selected) onPick(index);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, index: number) => {
    if (usable.length === 0) return;
    const at = usable.indexOf(index);
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = usable[(at + 1) % usable.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = usable[(at - 1 + usable.length) % usable.length];
    else if (e.key === 'Home') next = usable[0];
    else if (e.key === 'End') next = usable[usable.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    go(next);
  };

  const item = (index: number): RadioItemProps => ({
    ref: (el) => {
      refs.current[index] = el;
    },
    tabIndex: index === stop ? 0 : -1,
    onKeyDown: (e) => onKeyDown(e, index),
  });

  return { item, go };
}
