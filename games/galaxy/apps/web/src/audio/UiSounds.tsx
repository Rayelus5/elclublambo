import { useEffect } from 'react';
import { INTERACTIVE, playUi, soundOf } from './ui-sfx';

// One listener for every interactive thing in the game (M8 polish): a press (pointer, or Enter and Space on the focused
// element) plays its sound, and the big menu buttons marked data-sfx="hover" get a soft brush when the pointer enters
// them. Disabled elements stay silent. Nothing per component, so new buttons sound without asking.

const usable = (el: Element | null): el is Element => !!el && !el.matches(':disabled, [aria-disabled="true"]');

export function UiSounds() {
  useEffect(() => {
    let hovered: Element | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as Element | null)?.closest?.(INTERACTIVE) ?? null;
      if (usable(el)) playUi(soundOf(el));
    };
    const key = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
      const el = document.activeElement;
      if (!usable(el) || !el.matches(INTERACTIVE)) return;
      // Typing a space in a field is not a press.
      if (e.key === ' ' && el.matches('input[type="range"], select')) return;
      playUi(soundOf(el));
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-sfx="hover"]') ?? null;
      if (el === hovered) return;
      hovered = el;
      if (usable(el)) playUi('hover');
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerover', over, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerover', over, true);
    };
  }, []);
  return null;
}
