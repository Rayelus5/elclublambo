// Whether a dialog is open over the page (polish phase 3; «Encuestas y avisos», plan 2026-11-22, part A): the guided
// tour docks its card while a panel, the reveal or a picker is open, and the title screen's popup waits for it to close
// so it never opens on top of another. The tour's own card and its «Saltar tutorial» confirmation do not count.

const OTHER_DIALOG = '[role="dialog"]:not(.tour-card), [role="alertdialog"]:not(.tour-skip)';

/** Another dialog is open in the page (`root`: where to look, the whole document by default). */
export function anyDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector(OTHER_DIALOG) !== null;
}
