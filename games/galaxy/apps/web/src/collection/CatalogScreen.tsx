import { CATALOG_KINDS, type CatalogKind, type CatalogView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { CATALOG_SUMMARY_KEY } from '../api/catalog';
import { GACHA_KEY } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';
import { refreshPieces } from '../api/cosmetics';

// The ECN Catalogue (GDD §12.3; M7b, DESIGN_SYSTEM §8 sexvicies): the album of types, palettes, phenomena and finishes,
// what has been found (the rest shows as «?»), and the reward of each share, collected once.

const t = copy.catalog;
const KEY = ['catalog', 'album'] as const;

const nameOf = (kind: CatalogKind, value: string) =>
  kind === 'finish' ? (copy.finishes as Record<string, string>)[value] ?? value : ((copy.traitValues as unknown as Record<string, Record<string, string>>)[kind]?.[value] ?? value);

export function CatalogScreen() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: KEY, queryFn: () => api<CatalogView>('/catalog') });
  const claim = useMutation({
    mutationFn: (percent: number) => api<CatalogView>(`/catalog/${percent}/claim`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
    onSuccess: (view) => {
      qc.setQueryData(KEY, view);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: CATALOG_SUMMARY_KEY });
      // A milestone can give a title, a frame, an avatar or a probe skin (plan «skins»): shown at once.
      refreshPieces(qc);
    },
  });
  const v = catalog.data;
  return (
    <div className="screen-root missions-root">
      <div className="missions catalog">
        <header className="collection-bar">
          <BackLink fallback="/coleccion" />
          <h1>{t.title}</h1>
        </header>
        {catalog.error ? (
          <p className="field-error" role="alert">
            {errorText(catalog.error, copy.errors)}
          </p>
        ) : null}
        {claim.error ? (
          <p className="field-error" role="alert">
            {errorText(claim.error, copy.errors)}
          </p>
        ) : null}
        {v ? (
          <>
            <section className="lip panel catalog-progress" aria-label={t.progressTitle}>
              <div className="mission-bar" role="progressbar" aria-label={t.progressTitle} aria-valuemin={0} aria-valuemax={v.total} aria-valuenow={v.found} aria-valuetext={t.progress(v.found, v.total, v.percent)}>
                <i style={{ width: `${v.percent}%` }} />
                <span aria-hidden="true">{t.progress(v.found, v.total, v.percent)}</span>
              </div>
              <ul className="catalog-rewards">
                {v.rewards.map((r) => (
                  <li key={r.percent} className={r.claimed ? 'claimed' : r.reached ? 'ready' : ''}>
                    <b>{t.at(r.percent)}</b>
                    <span>{t.reward(r.reward)}</span>
                    {r.claimed ? (
                      <span className="mission-done">
                        <Icon name="check" />
                        {copy.missions.claimed}
                      </span>
                    ) : (
                      <button type="button" className="lip pill small" disabled={!r.reached || claim.isPending} aria-label={t.claimOf(r.percent)} onClick={() => claim.mutate(r.percent)}>
                        {copy.missions.claim}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            {CATALOG_KINDS.map((kind) => {
              const entries = v.entries.filter((e) => e.kind === kind);
              return (
                <section key={kind} className="catalog-kind" aria-labelledby={`catalog-${kind}`}>
                  <h2 id={`catalog-${kind}`}>
                    {t.kinds[kind]} <small>{t.count(entries.filter((e) => e.found).length, entries.length)}</small>
                  </h2>
                  <ul className="catalog-grid">
                    {entries.map((e) => (
                      <li key={e.value} className={e.found ? 'found' : 'missing'}>
                        {e.found ? (
                          <>
                            <Icon name="check" />
                            <span>{nameOf(kind, e.value)}</span>
                          </>
                        ) : (
                          <span aria-label={t.missing}>?</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        ) : null}
      </div>
    </div>
  );
}
