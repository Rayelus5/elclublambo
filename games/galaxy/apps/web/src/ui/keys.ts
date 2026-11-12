/** A key typed into a field (a text box, a list, editable text, the game's own dropdown): the game's shortcuts leave it alone. */
export function typing(e: KeyboardEvent): boolean {
  const el = e.target;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox')
  );
}
