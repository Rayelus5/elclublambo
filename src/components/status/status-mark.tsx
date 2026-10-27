const CELLS = Array.from({ length: 9 }, (_, i) => i);

/**
 * The logo square (Cerulean) drifting slowly over a 3×3 grid of empty squares: the one moving thing on the status pages.
 * Each cell is 1.5rem with a 0.5rem gap, so a step is 2rem (the `status-drift` keyframes in globals.css). With reduced
 * motion it rests in the top-left cell, where the wordmark keeps it.
 */
export function StatusMark() {
  return (
    <div aria-hidden className="relative grid size-22 shrink-0 grid-cols-3 gap-2">
      {CELLS.map((i) => (
        <span key={i} className="size-6 rounded-[3px] border border-border-strong" />
      ))}
      <span className="absolute top-0 left-0 size-6 rounded-[3px] bg-accent animate-[status-drift_6s_ease-in-out_infinite] motion-reduce:animate-none" />
    </div>
  );
}
