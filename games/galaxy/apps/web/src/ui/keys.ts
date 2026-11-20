import { isAction } from '../settings/keybinds';

/**
 * The card a key picks (1–3), by the player's controls (1, 2, 3 and the numeric pad by default), read by the key's
 * place: with SHIFT held for a dash the key itself reads «!». 0 for any other key.
 */
export function cardKey(code: string): number {
  if (isAction('pick1', code)) return 1;
  if (isAction('pick2', code)) return 2;
  if (isAction('pick3', code)) return 3;
  return 0;
}

/**
 * How long the upgrade cards ignore every key and click after they show (ms): a dash or a shot pressed just as they
 * open never takes a card by mistake.
 */
export const CARD_GUARD_MS = 350;

/** A key typed into a field (a text box, a list, editable text, the game's own dropdown): the game's shortcuts leave it alone. */
export function typing(e: KeyboardEvent): boolean {
  const el = e.target;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox')
  );
}
