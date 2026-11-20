import { HScroll } from '../ui/HScroll';
import { useId, useState } from 'react';
import { auditSearch, useAudit } from '../api/admin';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { DateField } from '../ui/DateField';
import { useSettled } from '../ui/useSettled';
import { cellText, Pager } from './DataTable';

const t = copy.admin;

/** The audit log (GDD §16.1): filtered by who, what, whom and dates; each change opens to its before and after. */
export function AuditScreen() {
  const ids = useId();
  const [f, setF] = useState({ actor: '', action: '', target: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const settled = useSettled(f, 300);
  const filters = Object.fromEntries(Object.entries(settled).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
  const audit = useAudit({ ...filters, page });
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(1);
  };
  return (
    <section className="admin-page">
      <h1>{t.sections.audit}</h1>
      <div className="admin-filters">
        {(['actor', 'action', 'target'] as const).map((k) => (
          <label key={k} htmlFor={`${ids}-${k}`}>
            <span>{t.audit[k]}</span>
            <input id={`${ids}-${k}`} type="text" value={f[k]} maxLength={64} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        {(['from', 'to'] as const).map((k) => (
          <div key={k} className="admin-filter">
            <label htmlFor={`${ids}-${k}`}>{t.audit[k]}</label>
            <DateField id={`${ids}-${k}`} value={f[k]} onChange={(v) => set(k, v)} />
          </div>
        ))}
        <a className="lip pill small" href={`/galaxy/api/admin/audit?${auditSearch(filters, { format: 'csv' })}`} download>
          {t.audit.export}
        </a>
      </div>
      {audit.error ? (
        <p className="field-error" role="alert">
          {errorText(audit.error, copy.errors)}
        </p>
      ) : null}
      {audit.data && audit.data.rows.length === 0 ? <p className="panel-note">{t.audit.empty}</p> : null}
      {audit.data && audit.data.rows.length > 0 ? (
        <HScroll variant="table" className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {[t.cols['at'], t.audit.actor, t.audit.action, t.audit.target, t.cols['reason'], t.cols['ip'], t.audit.details].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{cellText('at', r.at)}</td>
                  <td>{r.actor}</td>
                  <td>{r.action}</td>
                  <td>{r.targetType ? `${r.targetType} ${r.targetId ?? ''}` : '—'}</td>
                  <td>{r.reason}</td>
                  <td>{r.ip ?? '—'}</td>
                  <td>
                    {r.before !== null || r.after !== null ? (
                      <details>
                        <summary>{t.audit.details}</summary>
                        <pre className="admin-pre">
                          {t.audit.before}: {JSON.stringify(r.before, null, 2)}
                          {'\n'}
                          {t.audit.after}: {JSON.stringify(r.after, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      ) : null}
      {audit.data ? <Pager page={audit.data.page} pages={audit.data.pages} onPage={setPage} /> : null}
    </section>
  );
}
