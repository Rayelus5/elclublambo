import type { RedshiftView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

// The prestige «Corrimiento al rojo» (GDD §12.5; M7e-2, DESIGN_SYSTEM §8 duotricies), under the Laboratorio's tree:
// the rank, what it gives, what the next one asks for, and taking it after a confirmation that says what restarts and
// that the collection is never touched. Shown from the level it opens at.

const t = copy.redshift;
const KEY = ['redshift'] as const;
const pct = (x: number) => `${fmt(Math.round(x * 1000) / 10)} %`;

/** Whether the prestige shows at all (from its level, or with a rank): the whiteboard's toolbar button follows it. */
export function useRedshiftShown(): boolean {
  const v = useQuery({ queryKey: KEY, queryFn: () => api<RedshiftView>('/redshift') }).data;
  return !!v && !((v.rank === 0 && v.level < v.minLevel) || v.maxRank === 0);
}

export function Redshift() {
  const qc = useQueryClient();
  const view = useQuery({ queryKey: KEY, queryFn: () => api<RedshiftView>('/redshift') });
  const [asking, setAsking] = useState(false);
  const take = useMutation({
    mutationFn: () => api<RedshiftView>('/redshift', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v);
      setAsking(false);
      void qc.invalidateQueries({ queryKey: ['lab'] });
      void qc.invalidateQueries({ queryKey: ['station'] });
      void qc.invalidateQueries({ queryKey: ['missions'] });
    },
  });
  const v = view.data;
  if (!v || (v.rank === 0 && v.level < v.minLevel) || v.maxRank === 0) return null;
  return (
    <section className="lip panel redshift" aria-labelledby="redshift-title">
      <div className="redshift-head">
        <span className="redshift-orb" aria-hidden="true" />
        <div>
          <h2 id="redshift-title">{t.title}</h2>
          <p>{t.rank(v.rank, v.maxRank)}</p>
        </div>
      </div>
      <p className="redshift-bonus">{v.rank > 0 ? t.bonus(pct(v.bonus.xp), pct(v.bonus.luck)) : t.intro}</p>
      {v.next && v.needed !== null ? (
        <>
          <ul className="redshift-needs">
            <li className={v.level >= v.minLevel ? 'met' : ''}>
              <Icon name={v.level >= v.minLevel ? 'check' : 'lock'} />
              {t.needLevel(v.minLevel, v.level)}
            </li>
            <li className={v.labLevels >= v.needed ? 'met' : ''}>
              <Icon name={v.labLevels >= v.needed ? 'check' : 'lock'} />
              {t.needLab(v.needed, v.labLevels)}
            </li>
          </ul>
          <p className="redshift-next">{t.next(pct(v.next.xp), pct(v.next.luck), v.next.title)}</p>
          <button type="button" className="lip pill redshift-take" disabled={!v.eligible} onClick={() => setAsking(true)}>
            {t.take}
          </button>
        </>
      ) : (
        <p className="redshift-next">{t.top}</p>
      )}
      {asking && v.next ? (
        <Dialog title={t.confirmTitle} role="alertdialog" className="redshift-confirm" onClose={() => setAsking(false)}>
          <p>{t.confirmResets}</p>
          <p>{t.confirmKeeps}</p>
          <p>{t.next(pct(v.next.xp), pct(v.next.luck), v.next.title)}</p>
          {take.error ? (
            <p className="field-error" role="alert">
              {errorText(take.error, copy.errors)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={() => setAsking(false)} data-autofocus>
              {t.cancel}
            </button>
            <button type="button" className="lip pill redshift-take" disabled={take.isPending} onClick={() => take.mutate()}>
              {t.confirm}
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
