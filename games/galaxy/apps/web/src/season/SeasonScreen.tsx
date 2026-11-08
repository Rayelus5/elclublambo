import type { SeasonView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { GACHA_KEY } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { daysLeft, TierEmblem } from '../social/parts';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// The season (GDD §13.1; M7d-1, DESIGN_SYSTEM §8 novovicies): the score with its tier, the route climbed with it (a
// track of steps, each collected once) and the shop that sells with the season currency.

const t = copy.season;
export const SEASON_KEY = ['season'] as const;

function useSeasonAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: 'step'; at: number } | { kind: 'item'; id: string }) =>
      api<SeasonView>(v.kind === 'step' ? `/season/route/${v.at}/claim` : `/season/shop/${v.id}/buy`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
    onSuccess: (view) => {
      qc.setQueryData(SEASON_KEY, view);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function SeasonScreen() {
  const season = useQuery({ queryKey: SEASON_KEY, queryFn: () => api<SeasonView>('/season') });
  const act = useSeasonAction();
  const v = season.data;
  const track = useRef<HTMLOListElement>(null);
  // The track opens at the next step to reach.
  const firstOpen = v ? v.steps.findIndex((s) => !s.claimed) : -1;
  useEffect(() => {
    if (firstOpen < 0) return;
    const li = track.current?.children[firstOpen] as HTMLElement | undefined;
    if (li && track.current) track.current.scrollLeft = Math.max(0, li.offsetLeft - 120);
  }, [firstOpen]);
  const next = v?.steps.find((s) => !s.reached);
  return (
    <div className="screen-root missions-root">
      <div className="missions season-screen">
        <header className="collection-bar">
          <BackLink fallback="/">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{v?.season?.name ?? t.title}</h1>
          {v?.season ? <span className="season-left">{copy.social.endsIn(daysLeft(v.season.endsAt))}</span> : null}
        </header>
        {season.error || act.error ? (
          <p className="field-error" role="alert">
            {errorText((season.error ?? act.error)!, copy.errors)}
          </p>
        ) : null}
        {!v ? (
          season.error ? null : (
            <p className="empty" role="status">
              {copy.loading}
            </p>
          )
        ) : !v.season ? (
          <p className="lip panel empty">{copy.errors.season_closed}</p>
        ) : (
          <>
            <section className="season-hero" aria-label={t.scoreTitle}>
              <div className="lip panel season-score">
                {v.tier ? <TierEmblem tier={v.tier} scale={2} /> : <span className="season-notier" aria-hidden="true" />}
                <div>
                  <b>{t.score(v.score)}</b>
                  <span>{v.tier ? copy.social.tier[v.tier] : copy.social.noTier}</span>
                  {next ? <span className="season-next">{t.toNext(next.at - v.score)}</span> : <span className="season-next">{t.allReached}</span>}
                </div>
              </div>
              <div className="lip panel season-wallet" aria-label={t.balanceOf(v.currency.name)}>
                <Icon name="shard" />
                <div>
                  <b>{fmt(v.currency.balance)}</b>
                  <span>{v.currency.name}</span>
                </div>
                <p>{t.currencyHint}</p>
              </div>
            </section>

            <section className="season-route" aria-labelledby="season-route-title">
              <h2 id="season-route-title">{t.routeTitle}</h2>
              <div className="season-track">
                <ol ref={track} aria-label={t.routeTitle}>
                  {v.steps.map((s, i) => (
                    <li key={s.at} className={s.claimed ? 'claimed' : s.reached ? 'ready' : 'locked'} style={{ '--i': i } as CSSProperties}>
                      <span className="season-node" aria-hidden="true">
                        {s.claimed ? <Icon name="check" /> : s.reached ? <Icon name="trophy" /> : <Icon name="lock" />}
                      </span>
                      <b>{t.at(s.at)}</b>
                      <span className="season-reward">{t.reward(s.reward, v.currency.name)}</span>
                      {s.claimed ? (
                        <span className="mission-done">{copy.missions.claimed}</span>
                      ) : (
                        <button type="button" className="lip pill small" disabled={!s.reached || act.isPending} aria-label={t.claimOf(s.at)} onClick={() => act.mutate({ kind: 'step', at: s.at })}>
                          {copy.missions.claim}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <section className="season-shop" aria-labelledby="season-shop-title">
              <h2 id="season-shop-title">{t.shopTitle}</h2>
              <ul>
                {v.shop.map((i) => {
                  const out = i.bought >= i.limit;
                  return (
                    <li key={i.id} className={`lip panel${out ? ' sold' : ''}`}>
                      <b>{i.name}</b>
                      <span>{t.reward(i.reward, v.currency.name)}</span>
                      <span className="season-stock">{t.stock(i.bought, i.limit)}</span>
                      <button
                        type="button"
                        className="lip pill small pill-solar"
                        disabled={out || v.currency.balance < i.price || act.isPending}
                        aria-label={t.buyOf(i.name, i.price, v.currency.name)}
                        onClick={() => act.mutate({ kind: 'item', id: i.id })}
                      >
                        <Icon name="shard" />
                        <span>{out ? t.soldOut : fmt(i.price)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="panel-note">{t.convertNote(v.currency.name)}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
