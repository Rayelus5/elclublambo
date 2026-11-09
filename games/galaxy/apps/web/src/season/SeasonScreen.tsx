import type { SeasonResult, SeasonReward, SeasonView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { GACHA_KEY } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { daysLeft, nextTier, TierEmblem } from '../social/parts';
import { BackLink } from '../ui/BackLink';
import { Icon, type IconName } from '../ui/Icon';

// The season (GDD §13.1; M7d-1, DESIGN_SYSTEM §8 novovicies): the score with its tier, the route climbed with it (a
// track of steps, each collected once) and the shop that sells with the season currency.

const t = copy.season;
export const SEASON_KEY = ['season'] as const;

function useSeasonAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: 'step'; at: number } | { kind: 'item'; id: string } | { kind: 'result'; season: string }) =>
      api<SeasonView>(v.kind === 'step' ? `/season/route/${v.at}/claim` : v.kind === 'item' ? `/season/shop/${v.id}/buy` : `/season/results/${v.season}/claim`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
    onSuccess: (view) => {
      qc.setQueryData(SEASON_KEY, view);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** What a reward is mostly about, for its icon and its colour: the season currency first, then the rest. */
function rewardKind(r: SeasonReward): { icon: IconName; kind: string } {
  if (r.title || r.frame) return { icon: 'trophy', kind: 'cosmetic' };
  if (r.shards) return { icon: 'shard', kind: 'shards' };
  if (r.signal) return { icon: 'ticket', kind: 'signal' };
  if (r.dust) return { icon: 'dust', kind: 'dust' };
  return { icon: 'coin', kind: 'coins' };
}

/** The last closed season's place and its rewards, to collect once (M7d-2). */
function Closing({ r, onClaim, pending }: { r: SeasonResult; onClaim: () => void; pending: boolean }) {
  return (
    <section className={`lip panel season-closing${r.podium ? ' podium' : ''}`} aria-labelledby="season-closing-title">
      {r.tier ? <TierEmblem tier={r.tier} scale={2} /> : <Icon name="trophy" />}
      <div>
        <h2 id="season-closing-title">{t.closingTitle(r.name)}</h2>
        <p>{t.closingPlace(r.rank, r.score)}</p>
        <p className="season-closing-reward">{r.rewards.map((x) => t.reward(x, '')).filter(Boolean).join('; ')}</p>
        {r.podium ? <p className="season-closing-trophy">{t.closingTrophy}</p> : null}
      </div>
      <button type="button" className="lip pill pill-solar" disabled={pending} onClick={onClaim}>
        {t.closingClaim}
      </button>
    </section>
  );
}

export function SeasonScreen() {
  const season = useQuery({ queryKey: SEASON_KEY, queryFn: () => api<SeasonView>('/season') });
  const act = useSeasonAction();
  const v = season.data;
  const track = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = track.current;
    if (el) setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  // The track opens at the next step to collect or to reach.
  const firstOpen = v ? v.steps.findIndex((s) => !s.claimed) : -1;
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const li = firstOpen >= 0 ? (el.children[firstOpen] as HTMLElement | undefined) : undefined;
    el.scrollLeft = li ? Math.max(0, li.offsetLeft - 24) : 0;
    measure();
  }, [firstOpen, measure]);
  const slide = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: 'smooth' });
  const next = v?.steps.find((s) => !s.reached);
  const nextT = v?.season ? nextTier(v.score, v.season.tiers) : null;
  return (
    <div className="screen-root missions-root">
      <div className="missions season-screen">
        <header className="collection-bar">
          <BackLink fallback="/" />
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
          <>
            {v.closing ? <Closing r={v.closing} pending={act.isPending} onClaim={() => act.mutate({ kind: 'result', season: v.closing!.season })} /> : null}
            <p className="lip panel empty">{copy.errors.season_closed}</p>
          </>
        ) : (
          <>
            {v.closing ? <Closing r={v.closing} pending={act.isPending} onClaim={() => act.mutate({ kind: 'result', season: v.closing!.season })} /> : null}
            <section className="season-hero" aria-label={t.scoreTitle}>
              <div className="lip panel season-score">
                {v.tier ? (
                  <TierEmblem tier={v.tier} scale={2} />
                ) : nextT ? (
                  <span className="season-tier-next" aria-hidden="true">
                    <TierEmblem tier={nextT.tier} scale={2} />
                  </span>
                ) : null}
                <div>
                  <b>{t.score(v.score)}</b>
                  <span>{v.tier ? copy.social.tier[v.tier] : copy.social.noTier}</span>
                  {nextT ? (
                    <span className="season-tier-bar" role="progressbar" aria-label={t.nextTier(copy.social.tier[nextT.tier], v.score + nextT.points)} aria-valuemin={0} aria-valuemax={v.score + nextT.points} aria-valuenow={v.score}>
                      <i style={{ width: `${Math.min(100, (v.score / (v.score + nextT.points)) * 100)}%` }} />
                    </span>
                  ) : null}
                  <span className="season-next">{nextT ? t.nextTier(copy.social.tier[nextT.tier], v.score + nextT.points) : t.allTiers}</span>
                  {next ? <span className="season-next-step">{t.toNext(next.at - v.score)}</span> : <span className="season-next-step">{t.allReached}</span>}
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
              <div className="season-route-head">
                <h2 id="season-route-title">{t.routeTitle}</h2>
                <span>{t.routeProgress(v.steps.filter((s) => s.claimed).length, v.steps.length)}</span>
                <button type="button" className="lip iconbtn small" aria-label={t.prev} disabled={edges.start} onClick={() => slide(-1)}>
                  <Icon name="back" />
                </button>
                <button type="button" className="lip iconbtn small flip" aria-label={t.next} disabled={edges.end} onClick={() => slide(1)}>
                  <Icon name="back" />
                </button>
              </div>
              <div className={`season-track${edges.start ? '' : ' fade-start'}${edges.end ? '' : ' fade-end'}`}>
                <ol ref={track} aria-label={t.routeTitle} onScroll={measure}>
                  {v.steps.map((s, i) => {
                    const k = rewardKind(s.reward);
                    return (
                      <li key={s.at} className={s.claimed ? 'claimed' : s.reached ? 'ready' : 'locked'} style={{ '--i': i } as CSSProperties}>
                        <span className="season-node" aria-hidden="true">
                          {s.claimed ? <Icon name="check" /> : i + 1}
                        </span>
                        <span className={`season-reward-icon k-${k.kind}`} aria-hidden="true">
                          <Icon name={k.icon} />
                        </span>
                        <span className="season-reward">{t.reward(s.reward, v.currency.name)}</span>
                        <b className="season-at">{t.at(s.at)}</b>
                        {s.claimed ? (
                          <span className="season-step-state">
                            <Icon name="check" />
                            {t.claimedStep}
                          </span>
                        ) : s.reached ? (
                          <button type="button" className="lip pill small pill-solar" disabled={act.isPending} aria-label={t.claimOf(s.at)} onClick={() => act.mutate({ kind: 'step', at: s.at })}>
                            {copy.missions.claim}
                          </button>
                        ) : (
                          <span className="season-step-state locked">{t.left(s.at - v.score)}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </section>

            <section className="season-shop" aria-labelledby="season-shop-title">
              <h2 id="season-shop-title">{t.shopTitle}</h2>
              <ul>
                {v.shop.map((i) => {
                  const out = i.bought >= i.limit;
                  const k = rewardKind(i.reward);
                  return (
                    <li key={i.id} className={`lip panel${out ? ' sold' : ''}`}>
                      <span className={`season-reward-icon k-${k.kind}`} aria-hidden="true">
                        <Icon name={k.icon} />
                      </span>
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
