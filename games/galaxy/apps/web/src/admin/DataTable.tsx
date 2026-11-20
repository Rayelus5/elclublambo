import { HScroll } from '../ui/HScroll';
import { copy } from '../copy/es';

const t = copy.admin;
const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

/** One cell as text: dates in Spanish, booleans as Sí/No, nothing as a dash. */
export function cellText(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? t.yes : t.no;
  if (typeof v === 'string' && /^(at|createdAt|expiresAt|lastSeen|firstSeen)$/.test(key) && !Number.isNaN(Date.parse(v))) return date.format(new Date(v));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A dense table with its own horizontal scroll; labels from copy, unknown keys as they are; an optional last column. */
export function DataTable({
  rows,
  columns,
  caption,
  action,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  caption?: string;
  action?: (row: Record<string, unknown>) => React.ReactNode;
}) {
  if (rows.length === 0) return <p className="panel-note">{t.empty}</p>;
  return (
    <HScroll variant="table" className="admin-table-wrap">
      <table className="admin-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {t.cols[c] ?? t.columns[c] ?? c}
              </th>
            ))}
            {action ? <th scope="col" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r['id'] ?? i)}>
              {columns.map((c) => (
                <td key={c}>{cellText(c, r[c])}</td>
              ))}
              {action ? <td>{action(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </HScroll>
  );
}

/** Previous and next page, with where one is. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="market-pages" aria-label={t.pageOf(page, pages)}>
      <button type="button" className="lip pill small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t.prev}
      </button>
      <span>{t.pageOf(page, pages)}</span>
      <button type="button" className="lip pill small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t.next}
      </button>
    </nav>
  );
}
