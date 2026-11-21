import type { SeasonResult, SeasonReward, SeasonView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { refreshPieces } from '../api/cosmetics';
import { GACHA_KEY, useGacha } from '../api/economy';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { piecesOf, useClaimFx } from '../missions/ClaimFx';
import { addRewards, type Reward } from '../missions/ready';
import { playClaim } from '../missions/sfx';
import { nextTier, TierEmblem } from '../social/parts';
import { BackLink } from '../ui/BackLink';
import { Celebration } from '../ui/Celebration';
import { Countdown } from '../ui/Countdown';
import { Dialog } from '../ui/Dialog';
import { useWheelSideways } from '../ui/HScroll';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';

// The season (GDD §13.1; M7d-1, DESIGN_SYSTEM §8 novovicies): the score with its tier, the route climbed with it (a
// track of steps, each collected once) and the shop that sells with the season currency. Since the season shop plan
// (PR 4) it wears the wallet of Missions with the season currency at its end, and what is collected or bought is
// heard and flies up to it (a piece pops where it was collected; the big ones and the closing prizes are celebrated),
// with «Recoger todo» on the route, a confirmation before an expensive purchase and the time left ticking.

const t = copy.season;
export const SEASON_KEY = ['season'] as const;
/** A purchase over this share of the balance asks first. */
const EXPENSIVE_SHARE = 0.5;

type SeasonAction = { kind: 'step'; at: number } | { kind: 'item'; id: string } | { kind: 'result'; season: string };
type Item = SeasonView['shop'][number];
type Step = SeasonView['steps'][number];

function useSeasonAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SeasonAction) =>
      api<SeasonView>(v.kind === 'step' ? `/season/route/${v.at}/claim` : v.kind === 'item' ? `/season/shop/${v.id}/buy` : `/season/results/${v.season}/claim`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
    onSuccess: (view) => {
      // A step, an item or the closing reward can give a piece or a probe skin (plan «skins»): shown at once.
      refreshPieces(qc);
      qc.setQueryData(SEASON_KEY, view);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** What a reward is mostly about, for its icon and its colour: the season currency first, then the rest. */
function rewardKind(r: SeasonReward): { icon: IconName; kind: string } {
  if (r.title || r.frame || r.avatar || r.skin) return { icon: 'trophy', kind: 'cosmetic' };
  if (r.shards) return { icon: 'shard', kind: 'shards' };
  if (r.signal) return { icon: 'ticket', kind: 'signal' };
  if (r.dust) return { icon: 'dust', kind: 'dust' };
  return { icon: 'coin', kind: 'coins' };
}

/** A summed reward in the season's words (its currency included). */
function rewardWords(r: Reward, currency: string): string {
  return t.reward({ coins: r.coins ?? 0, dust: r.dust ?? 0, signal: r.signal ?? 0, shards: r.shards ?? 0, title: r.title ?? null, frame: r.frame ?? null, avatar: r.avatar ?? null, skin: r.skin ?? null }, currency);
}

/** The celebration a reward deserves: a piece is (the most special one it gives), plain currency is not. */
function bigOf(reward: Reward): { title: string; name: string } | null {
  const piece = piecesOf(reward).at(-1);
  return piece ? { title: copy.missions.piece[piece.kind], name: piece.name } : null;
}

/** The box a control has now, read before the answer replaces it (a collected step loses its button). */
const boxOf = (selector: string): DOMRect | null => document.querySelector(selector)?.getBoundingClientRect() ?? null;

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
      <button type="button" className="lip pill pill-solar" data-claim="closing" disabled={pending} onClick={onClaim}>
        {t.closingClaim}
      </button>
    </section>
  );
}

export function SeasonScreen() {
  const season = useQuery({ queryKey: SEASON_KEY, queryFn: () => api<SeasonView>('/season') });
  const gacha = useGacha();
  const act = useSeasonAction();
  const reduced = useReducedMotion();
  const fx = useClaimFx(reduced);
  const v = season.data;
  const track = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  /** A claim or a purchase running (with «Recoger todo», the whole run): every action waits. */
  const [working, setWorking] = useState(false);
  const busy = working || act.isPending;
  /** What the route gave in this visit, said once; and the last thing bought. */
  const [gained, setGained] = useState<Reward | null>(null);
  const [bought, setBought] = useState<string | null>(null);
  const [asking, setAsking] = useState<Item | null>(null);
  const [big, setBig] = useState<{ key: number; title: string; name: string } | null>(null);
  const bigKey = useRef(0);
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
  useEffect(() => {
    if (!big) return;
    const id = setTimeout(() => setBig(null), 2600);
    return () => clearTimeout(id);
  }, [big]);
  useWheelSideways(track);
  const slide = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: 'smooth' });

  /** One action: done, then heard, seen flying from where it was pressed to the wallet, and celebrated if big. */
  async function perform(action: SeasonAction, from: DOMRect | null, reward: Reward, celebrate: { title: string; name: string } | null): Promise<void> {
    await act.mutateAsync(action);
    playClaim(reward, celebrate !== null);
    fx.burst(from, reward);
    if (celebrate) setBig({ key: ++bigKey.current, ...celebrate });
  }

  /** Where a step's flight starts: its button while the track shows it, else «Recoger todo». */
  function stepBox(at: number): DOMRect | null {
    const own = boxOf(`[data-claim="step-${at}"]`);
    const box = track.current?.getBoundingClientRect();
    if (own && (!box || box.width === 0 || (own.right > box.left && own.left < box.right))) return own;
    return boxOf('[data-claim="steps"]') ?? own;
  }

  async function claimSteps(steps: Step[]): Promise<void> {
    if (busy || steps.length === 0) return;
    setWorking(true);
    setGained(null);
    try {
      for (const [i, s] of steps.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, reduced ? 0 : 220));
        await perform({ kind: 'step', at: s.at }, stepBox(s.at), s.reward, bigOf(s.reward));
        setGained((g) => addRewards(g ?? {}, s.reward));
      }
    } catch {
      // The mutation shows its own error.
    } finally {
      setWorking(false);
    }
  }

  async function buy(item: Item): Promise<void> {
    if (busy) return;
    setWorking(true);
    try {
      await perform({ kind: 'item', id: item.id }, boxOf(`[data-claim="item-${item.id}"]`), item.reward, bigOf(item.reward));
      setBought(item.name);
    } catch {
      // The mutation shows its own error.
    } finally {
      setWorking(false);
    }
  }

  async function claimClosing(r: SeasonResult): Promise<void> {
    if (busy) return;
    setWorking(true);
    try {
      const total = r.rewards.reduce<Reward>((sum, x) => addRewards(sum, x), {});
      await perform({ kind: 'result', season: r.season }, boxOf('[data-claim="closing"]'), total, { title: t.bigClosing, name: r.name });
    } catch {
      // The mutation shows its own error.
    } finally {
      setWorking(false);
    }
  }

  const next = v?.steps.find((s) => !s.reached);
  const nextT = v?.season ? nextTier(v.score, v.season.tiers) : null;
  const ready = v ? v.steps.filter((s) => s.reached && !s.claimed) : [];
  const closing = v?.closing ? <Closing r={v.closing} pending={busy} onClaim={() => void claimClosing(v.closing!)} /> : null;
  return (
    <div className="screen-root missions-root">
      <div className="missions season-screen">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{v?.season?.name ?? t.title}</h1>
          {v?.season ? <Countdown endsAt={v.season.endsAt} className="season-left" /> : null}
          <div className="lip panel hud missions-wallet" data-wallet>
            <WalletBar wallet={gacha.data?.wallet} season={v?.season ? v.currency : undefined} />
          </div>
        </header>
        {fx.view}
        {big ? (
          <div className="claim-celebration">
            <Celebration key={big.key} title={big.title} subtitle={big.name} reduced={reduced} />
          </div>
        ) : null}
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
            {closing}
            <p className="lip panel empty">{copy.errors.season_closed}</p>
          </>
        ) : (
          <>
            {closing}
            <section className="lip panel season-score" aria-label={t.scoreTitle}>
              {v.tier ? (
                <TierEmblem tier={v.tier} scale={2} />
              ) : nextT ? (
                <span className="season-tier-next" aria-hidden="true">
                  <TierEmblem tier={nextT.tier} scale={2} />
                </span>
              ) : null}
              <div className="season-score-now">
                <b>{t.score(v.score)}</b>
                <span>{v.tier ? copy.social.tier[v.tier] : copy.social.noTier}</span>
              </div>
              <div className="season-score-next">
                {nextT ? (
                  <span className="season-tier-bar" role="progressbar" aria-label={t.nextTier(copy.social.tier[nextT.tier], v.score + nextT.points)} aria-valuemin={0} aria-valuemax={v.score + nextT.points} aria-valuenow={v.score}>
                    <i style={{ width: `${Math.min(100, (v.score / (v.score + nextT.points)) * 100)}%` }} />
                  </span>
                ) : null}
                <span className="season-next">{nextT ? t.nextTier(copy.social.tier[nextT.tier], v.score + nextT.points) : t.allTiers}</span>
                {next ? <span className="season-next-step">{t.toNext(next.at - v.score)}</span> : <span className="season-next-step">{t.allReached}</span>}
              </div>
            </section>

            <section className="season-route" aria-labelledby="season-route-title">
              <div className="season-route-head">
                <h2 id="season-route-title">{t.routeTitle}</h2>
                <span>{t.routeProgress(v.steps.filter((s) => s.claimed).length, v.steps.length)}</span>
                {gained ? (
                  <p className="missions-gained season-gained" role="status" aria-atomic="true">
                    {copy.missions.gained(rewardWords(gained, v.currency.name))}
                  </p>
                ) : null}
                {ready.length > 1 ? (
                  <button type="button" className="lip pill small pill-solar season-claim-all" data-claim="steps" disabled={busy} onClick={() => void claimSteps(ready)}>
                    <Icon name="trophy" />
                    <span>{copy.missions.claimAll(ready.length)}</span>
                  </button>
                ) : null}
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
                          <button type="button" className="lip pill small pill-solar" data-claim={`step-${s.at}`} disabled={busy} aria-label={t.claimOf(s.at)} onClick={() => void claimSteps([s])}>
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
              <div className="season-shop-head">
                <h2 id="season-shop-title">{t.shopTitle}</h2>
                <p>{t.currencyHint}</p>
                {bought ? (
                  <p className="missions-gained season-gained" role="status" aria-atomic="true">
                    {t.bought(bought)}
                  </p>
                ) : null}
              </div>
              <ul>
                {v.shop.map((i) => {
                  const out = i.bought >= i.limit;
                  const short = !out && v.currency.balance < i.price;
                  const k = rewardKind(i.reward);
                  return (
                    <li key={i.id} className={`lip panel${out ? ' sold' : short ? ' short' : ' affordable'}`}>
                      <span className={`season-reward-icon k-${k.kind}`} aria-hidden="true">
                        <Icon name={k.icon} />
                      </span>
                      <b>{i.name}</b>
                      <span>{t.reward(i.reward, v.currency.name)}</span>
                      <span className="season-stock">{t.stock(i.bought, i.limit)}</span>
                      {short ? (
                        <span className="season-short">
                          <Icon name="lock" />
                          {t.short(i.price - v.currency.balance, v.currency.name)}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="lip pill small pill-solar"
                        data-claim={`item-${i.id}`}
                        disabled={out || short || busy}
                        aria-label={t.buyOf(i.name, i.price, v.currency.name)}
                        onClick={() => (i.price > v.currency.balance * EXPENSIVE_SHARE ? setAsking(i) : void buy(i))}
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
            {asking ? (
              <Dialog title={t.confirmTitle(asking.name)} role="alertdialog" className="season-confirm" onClose={() => setAsking(null)}>
                <p>{t.confirmBody(asking.price, v.currency.balance - asking.price, v.currency.name)}</p>
                <div className="modal-actions">
                  <button type="button" className="lip pill" data-autofocus onClick={() => setAsking(null)}>
                    {t.confirmNo}
                  </button>
                  <button
                    type="button"
                    className="lip pill pill-solar"
                    onClick={() => {
                      const item = asking;
                      setAsking(null);
                      void buy(item);
                    }}
                  >
                    {t.confirmYes(asking.price, v.currency.name)}
                  </button>
                </div>
              </Dialog>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
