/**
 * The card a number key picks (1–9, the row's or the numeric pad's), read by the key's place: with SHIFT held for a
 * dash the key itself reads «!». 0 for any other key.
 */
export function cardKey(code: string): number {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) : 0;
}

/** A key typed into a field (a text box, a list, editable text, the game's own dropdown): the game's shortcuts leave it alone. */
export function typing(e: KeyboardEvent): boolean {
  const el = e.target;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox')
  );
}
