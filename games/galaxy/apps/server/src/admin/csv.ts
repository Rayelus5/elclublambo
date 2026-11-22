// CSV exports of the panel (GDD §16.1): the audit log, and the answers of «Encuestas y avisos» (plan 2026-11-22, part A).
// Spreadsheets open them, so a cell must never run as a formula, and the file starts with a BOM so they read accents.

/**
 * One CSV cell: null and undefined are empty, objects are JSON. A cell that starts like a formula is written as text
 * (formula injection, M6a review), and one with a quote, a comma or a line break goes in quotes.
 */
export function cell(v: unknown): string {
  const raw = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole CSV file from its rows (the first one, the header): UTF-8 with a BOM, one line each. */
export function csvFile(rows: readonly (readonly unknown[])[]): string {
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}
