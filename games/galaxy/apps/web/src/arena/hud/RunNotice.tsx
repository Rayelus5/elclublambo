import type { RunNotice as Notice } from '../notices';

// The run's centre-screen notice (2026-11-16): one at a time, in the middle of the field, under the HUD's top row and
// over the cards' place. Hidden from screen readers: the HUD's live region reads the same moments.

export function RunNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className={`run-notice ${notice.tone}`} aria-hidden="true" key={notice.text}>
      {notice.text}
    </div>
  );
}
