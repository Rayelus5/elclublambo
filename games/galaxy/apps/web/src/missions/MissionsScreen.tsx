import type { AchievementView, EventView, Frame, MissionPeriodView, MissionView, Wallet } from '@galaxy/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGacha } from '../api/economy';
import { useClaim, useCosmetics, useMissions } from '../api/missions';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { BackLink } from '../ui/BackLink';
import { Celebration } from '../ui/Celebration';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { useClaimFx } from './ClaimFx';
import { addRewards, type ClaimTarget, firstReadyTab, readyByTab, readyIn, type Reward } from './ready';
import { playClaim } from './sfx';

// Missions and achievements (GDD §12.3; M7a, DESIGN_SYSTEM §8 quinvicies): the day's, the week's and the season's
// missions and the achievements, each with its progress, what it gives and «Recoger» once reached; and the title and
// frame shown on the profile, among the earned ones.

const t = copy.missions;
type Tab = 'daily' | 'weekly' | 'season' | 'events' | 'achievements';
const TABS: Tab[] = ['daily', 'weekly', 'season', 'events', 'achievements'];
const SLUGS: Record<string, Tab> = { diarias: 'daily', semanales: 'weekly', temporada: 'season', evento: 'events', logros: 'achievements' };

/** «a, b y c». */
const listOf = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)!}`);

function rewardParts(r: { coins?: number; dust?: number; signal?: number; xp?: number; points?: number; title?: string | null; frame?: Frame | string | null; eventSignals?: number }): string[] {
  const parts: string[] = [];
  if (r.eventSignals) parts.push(t.reward.eventSignals(r.eventSignals));
  if (r.coins) parts.push(t.reward.coins(r.coins));
  if (r.dust) parts.push(t.reward.dust(r.dust));
  if (r.signal) parts.push(t.reward.signal(r.signal));
  if (r.xp) parts.push(t.reward.xp(r.xp));
  if (r.points) parts.push(t.reward.points(r.points));
  if (r.title) parts.push(t.reward.title(r.title));
  if (r.frame) parts.push(t.reward.frame(t.frames[r.frame] ?? r.frame));
  return parts;
}

function rewardText(r: Parameters<typeof rewardParts>[0]): string {
  return rewardParts(r).join(', ');
}

function Progress({ label, progress, target }: { label: string; progress: number; target: number }) {
  return (
    <div className="mission-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={progress} aria-valuetext={t.of(progress, target)}>
      <i style={{ width: `${Math.min(100, (progress / target) * 100)}%` }} />
      <span aria-hidden="true">{t.of(progress, target)}</span>
    </div>
  );
}

/**
 * The events running now (M7e-1): each with its personal goals and its clan goals, and, for one that pays its own
 * signals, how many are held and the way to the event scanner that spends them. The admin's wizard previews with it.
 */
export function EventsList({ events, pending, onClaim, wallet }: { events: EventView[]; pending: boolean; onClaim: (period: string, id: string) => void; wallet?: Wallet }) {
  if (events.length === 0) return <p className="panel-note">{t.noEvent}</p>;
  return (
    <>
      {events.map((e) => (
        <section key={e.id} className="event-block" aria-labelledby={`event-${e.id}`}>
          <header className="lip panel event-head">
            <Icon name="comet" />
            <div>
              <h2 id={`event-${e.id}`}>{e.name}</h2>
              <p>{e.description}</p>
            </div>
            <span className="event-ends">{t.eventEnds(new Date(e.endsAt))}</span>
          </header>
          {wallet && e.goals.some((g) => (g.reward.eventSignals ?? 0) > 0) ? (
            <div className="event-wallet">
              <span className="res event-signal">
                <Icon name="ticket" />
                <b>{t.eventWallet(wallet[`signal:${e.id}`] ?? 0)}</b>
              </span>
              <Link to="/escaner?tipo=evento" className="lip pill small pill-event">
                <Icon name="radar" />
                <span>{t.useEventScanner}</span>
              </Link>
            </div>
          ) : null}
          <ul className="mission-list">
            {e.goals.map((g) => {
              const done = g.progress >= g.target && (g.scope === 'personal' || e.inClan);
              return (
                <li key={g.id} className={`lip panel mission-card${g.claimed ? ' claimed' : done ? ' ready' : ''}${g.scope === 'clan' ? ' clan-goal' : ''}`}>
                  <div className="mission-text">
                    <b>
                      {g.scope === 'clan' ? <span className="clan-tag">{t.clanGoal}</span> : null}
                      {g.name}
                    </b>
                    <span>{g.scope === 'clan' && !e.inClan ? t.clanNeeded : rewardText(g.reward)}</span>
                  </div>
                  <Progress label={g.name} progress={g.progress} target={g.target} />
                  {g.claimed ? (
                    <span className="mission-done">
                      <Icon name="check" />
                      {t.claimed}
                    </span>
                  ) : (
                    <button type="button" className="lip pill" data-claim={g.id} disabled={!done || pending} aria-label={t.claimOf(g.name)} onClick={() => onClaim(e.period, g.id)}>
                      {t.claim}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

export function MissionsScreen() {
  const ids = useId();
  const missions = useMissions();
  const gacha = useGacha();
  const claim = useClaim();
  const reduced = useReducedMotion();
  const fx = useClaimFx(reduced);
  const [params] = useSearchParams();
  const asked = SLUGS[params.get('pestana') ?? ''];
  const [tab, setTab] = useState<Tab>(asked ?? 'daily');
  /** Chosen by the address or by a click: then it stays; otherwise the screen opens where rewards wait. */
  const chosen = useRef(asked !== undefined);
  const [gained, setGained] = useState<Reward | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [big, setBig] = useState<{ key: number; title: string; name: string } | null>(null);
  const bigKey = useRef(0);
  /** Claimed in this visit: their stamp lands (the ones claimed before just show it). */
  const [just, setJust] = useState<ReadonlySet<string>>(new Set());
  const v = missions.data;
  useEffect(() => {
    if (!v || chosen.current) return;
    chosen.current = true;
    const first = firstReadyTab(v);
    // The first view with something to collect (a state change on the first data, never in render).
    if (first) queueMicrotask(() => setTab(first));
  }, [v]);
  useEffect(() => {
    if (!big) return;
    const id = setTimeout(() => setBig(null), 2600);
    return () => clearTimeout(id);
  }, [big]);
  const ready = v ? readyByTab(v) : null;

  /** One reward: claimed, then heard, seen flying to the wallet, added to what was collected, and celebrated if big. */
  async function collect(target: ClaimTarget): Promise<void> {
    const from = document.querySelector(`[data-claim="${target.id}"]`);
    await claim.mutateAsync(target.kind === 'mission' ? { kind: 'mission', period: target.period, id: target.id } : { kind: 'achievement', id: target.id });
    playClaim(target.reward, target.big);
    setJust((j) => new Set(j).add(target.id));
    fx.burst(from, target.reward);
    setGained((g) => (g ? addRewards(g, target.reward) : addRewards({}, target.reward)));
    if (target.big) setBig({ key: ++bigKey.current, title: target.kind === 'achievement' ? t.bigAchievement : t.bigSeason, name: target.name });
  }
  async function collectMany(targets: ClaimTarget[]): Promise<void> {
    if (collecting || targets.length === 0) return;
    setCollecting(true);
    setGained(null);
    try {
      for (const [i, target] of targets.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, reduced ? 0 : 220));
        await collect(target);
      }
    } catch {
      // The mutation shows its own error.
    } finally {
      setCollecting(false);
    }
  }
  const claimOne = (target: ClaimTarget | undefined) => {
    if (target) void collectMany([target]);
  };
  const here = v ? readyIn(v, tab) : [];
  const period: MissionPeriodView | null = v ? (tab === 'daily' ? v.daily : tab === 'weekly' ? v.weekly : tab === 'season' ? v.season : null) : null;
  return (
    <div className="screen-root missions-root">
      <div className="missions">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
          <div className="lip panel hud missions-wallet">
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>
        <div className="tabs missions-tabs" role="tablist" aria-label={t.title}>
          {TABS.filter((k) => k !== 'events' || (v?.events.length ?? 0) > 0).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              aria-describedby={ready && ready[k] > 0 ? `${ids}-ready-${k}` : undefined}
              onClick={() => {
                chosen.current = true;
                setTab(k);
              }}
            >
              {t.tabs[k]}
              {ready && ready[k] > 0 ? (
                <span className="tab-badge" aria-hidden="true">
                  {ready[k] > 9 ? '9+' : fmt(ready[k])}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div hidden>
          {TABS.map((k) => (ready && ready[k] > 0 ? <span key={k} id={`${ids}-ready-${k}`}>{t.readyCount(ready[k])}</span> : null))}
        </div>
        <div className="missions-collect">
          {here.length > 1 ? (
            <button type="button" className="lip pill pill-solar" disabled={collecting} onClick={() => void collectMany(here)}>
              <Icon name="trophy" />
              <span>{t.claimAll(here.length)}</span>
            </button>
          ) : null}
          {gained ? (
            <p className="missions-gained" role="status" aria-atomic="true">
              {t.gained(listOf(rewardParts(gained)))}
            </p>
          ) : null}
        </div>
        {fx.view}
        {big ? (
          <div className="claim-celebration">
            <Celebration key={big.key} title={big.title} subtitle={big.name} reduced={reduced} />
          </div>
        ) : null}
        {missions.error ? (
          <p className="field-error" role="alert">
            {errorText(missions.error, copy.errors)}
          </p>
        ) : null}
        {claim.error ? (
          <p className="field-error" role="alert">
            {errorText(claim.error, copy.errors)}
          </p>
        ) : null}
        <div role="tabpanel" aria-label={t.tabs[tab]}>
          {v && tab === 'events' ? <EventsList events={v.events} pending={collecting} wallet={gacha.data?.wallet} onClaim={(period, id) => claimOne(here.find((x) => x.kind === 'mission' && x.period === period && x.id === id))} /> : null}
          {v && tab !== 'achievements' && tab !== 'events' ? (
            period ? (
              <>
                <p className="panel-note">{tab === 'daily' ? t.dailyEnds : tab === 'weekly' ? t.weeklyEnds : t.seasonEnds}</p>
                <ul className="mission-list">
                  {period.missions.map((m: MissionView) => {
                    const done = m.progress >= m.target;
                    return (
                      <li key={m.id} className={`lip panel mission-card${m.claimed ? ' claimed' : done ? ' ready' : ''}${just.has(m.id) ? ' just' : ''}`}>
                        <div className="mission-text">
                          <b>{m.name}</b>
                          <span>{rewardText(m.reward)}</span>
                        </div>
                        <Progress label={m.name} progress={m.progress} target={m.target} />
                        {m.claimed ? (
                          <span className="mission-done">
                            <Icon name="check" />
                            {t.claimed}
                          </span>
                        ) : (
                          <button type="button" className="lip pill" data-claim={m.id} disabled={!done || collecting} aria-label={t.claimOf(m.name)} onClick={() => claimOne(here.find((x) => x.id === m.id))}>
                            {t.claim}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="panel-note">{t.noSeason}</p>
            )
          ) : null}
          {v && tab === 'achievements' ? (
            <>
              <Cosmetics key={`${v.cosmetics.title ?? ''}|${v.cosmetics.frame ?? ''}`} titles={v.cosmetics.titles} frames={v.cosmetics.frames} title={v.cosmetics.title} frame={v.cosmetics.frame} />
              <ul className="mission-list">
                {v.achievements.map((a: AchievementView) => (
                  <li key={a.id} className={`lip panel mission-card achievement ${a.tier}${a.claimed ? ' claimed' : a.unlocked ? ' ready' : ''}${just.has(a.id) ? ' just' : ''}`}>
                    <div className="mission-text">
                      <b>
                        <span className={`achievement-tier ${a.tier}`}>{t.tiers[a.tier]}</span>
                        {a.name}
                      </b>
                      <span>{a.description}</span>
                      <span className="mission-reward">{rewardText(a.reward)}</span>
                    </div>
                    <Progress label={a.name} progress={a.progress} target={a.target} />
                    {a.claimed ? (
                      <span className="mission-done">
                        <Icon name="check" />
                        {t.claimed}
                      </span>
                    ) : (
                      <button type="button" className="lip pill" data-claim={a.id} disabled={!a.unlocked || collecting} aria-label={t.claimOf(a.name)} onClick={() => claimOne(here.find((x) => x.id === a.id))}>
                        {t.claim}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The title and the frame shown on the profile, among the earned ones. */
function Cosmetics({ titles, frames, title, frame }: { titles: string[]; frames: Frame[]; title: string | null; frame: Frame | null }) {
  const ids = useId();
  const save = useCosmetics();
  const [chosen, setChosen] = useState({ title: title ?? '', frame: frame ?? '' });
  return (
    <section className="lip panel cosmetics" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>{t.customize}</h2>
      {titles.length === 0 && frames.length === 0 ? <p className="panel-note">{t.noCosmetics}</p> : null}
      <div className="cosmetics-fields">
        <div className="field">
          <label htmlFor={`${ids}-t`}>{t.titleLabel}</label>
          <div className="control">
            <select id={`${ids}-t`} value={chosen.title} onChange={(e) => setChosen((c) => ({ ...c, title: e.target.value }))}>
              <option value="">{t.none}</option>
              {titles.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-f`}>{t.frameLabel}</label>
          <div className="control">
            <select id={`${ids}-f`} value={chosen.frame} onChange={(e) => setChosen((c) => ({ ...c, frame: e.target.value }))}>
              <option value="">{t.none}</option>
              {frames.map((x) => (
                <option key={x} value={x}>
                  {t.frames[x] ?? x}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className="lip pill" disabled={save.isPending} onClick={() => save.mutate({ title: chosen.title || null, frame: (chosen.frame || null) as Frame | null })}>
          {t.save}
        </button>
      </div>
      {save.isSuccess ? (
        <p className="admin-done" role="status">
          {t.saved}
        </p>
      ) : null}
    </section>
  );
}

/** The top bar's button to the missions, with how many are ready to collect. */
export function MissionsButton({ style }: { style?: React.CSSProperties }) {
  const v = useMissions().data;
  const ready = v?.ready ?? 0;
  const label = v && ready > 0 ? t.readyLabel(readyByTab(v)) : t.title;
  return (
    <Link to="/misiones" className="lip iconbtn enter mail-button" style={style} aria-label={label} title={label}>
      <Icon name="trophy" />
      {ready > 0 ? (
        <span className="mail-badge" aria-hidden="true">
          {ready > 9 ? '9+' : fmt(ready)}
        </span>
      ) : null}
    </Link>
  );
}
