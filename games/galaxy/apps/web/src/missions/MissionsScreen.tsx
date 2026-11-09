import type { AchievementView, EventView, Frame, MissionPeriodView, MissionView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useClaim, useCosmetics, useMissions } from '../api/missions';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';

// Missions and achievements (GDD §12.3; M7a, DESIGN_SYSTEM §8 quinvicies): the day's, the week's and the season's
// missions and the achievements, each with its progress, what it gives and «Recoger» once reached; and the title and
// frame shown on the profile, among the earned ones.

const t = copy.missions;
type Tab = 'daily' | 'weekly' | 'season' | 'events' | 'achievements';
const TABS: Tab[] = ['daily', 'weekly', 'season', 'events', 'achievements'];

function rewardText(r: { coins?: number; dust?: number; signal?: number; xp?: number; points?: number; title?: string | null; frame?: Frame | null; eventSignals?: number }): string {
  const parts: string[] = [];
  if (r.eventSignals) parts.push(t.reward.eventSignals(r.eventSignals));
  if (r.coins) parts.push(t.reward.coins(r.coins));
  if (r.dust) parts.push(t.reward.dust(r.dust));
  if (r.signal) parts.push(t.reward.signal(r.signal));
  if (r.xp) parts.push(t.reward.xp(r.xp));
  if (r.points) parts.push(t.reward.points(r.points));
  if (r.title) parts.push(t.reward.title(r.title));
  if (r.frame) parts.push(t.reward.frame(t.frames[r.frame] ?? r.frame));
  return parts.join(', ');
}

function Progress({ label, progress, target }: { label: string; progress: number; target: number }) {
  return (
    <div className="mission-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={progress} aria-valuetext={t.of(progress, target)}>
      <i style={{ width: `${Math.min(100, (progress / target) * 100)}%` }} />
      <span aria-hidden="true">{t.of(progress, target)}</span>
    </div>
  );
}

/** The events running now (M7e-1): each with its personal goals and its clan goals. The admin's wizard previews with it. */
export function EventsList({ events, pending, onClaim }: { events: EventView[]; pending: boolean; onClaim: (period: string, id: string) => void }) {
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
                    <button type="button" className="lip pill" disabled={!done || pending} aria-label={t.claimOf(g.name)} onClick={() => onClaim(e.period, g.id)}>
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
  const missions = useMissions();
  const claim = useClaim();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('pestana') === 'logros' ? 'achievements' : params.get('pestana') === 'evento' ? 'events' : 'daily');
  const v = missions.data;
  const period: MissionPeriodView | null = v ? (tab === 'daily' ? v.daily : tab === 'weekly' ? v.weekly : tab === 'season' ? v.season : null) : null;
  return (
    <div className="screen-root missions-root">
      <div className="missions">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
        </header>
        <div className="tabs missions-tabs" role="tablist" aria-label={t.title}>
          {TABS.filter((k) => k !== 'events' || (v?.events.length ?? 0) > 0).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {t.tabs[k]}
            </button>
          ))}
        </div>
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
          {v && tab === 'events' ? <EventsList events={v.events} pending={claim.isPending} onClaim={(period, id) => claim.mutate({ kind: 'mission', period, id })} /> : null}
          {v && tab !== 'achievements' && tab !== 'events' ? (
            period ? (
              <>
                <p className="panel-note">{tab === 'daily' ? t.dailyEnds : tab === 'weekly' ? t.weeklyEnds : t.seasonEnds}</p>
                <ul className="mission-list">
                  {period.missions.map((m: MissionView) => {
                    const done = m.progress >= m.target;
                    return (
                      <li key={m.id} className={`lip panel mission-card${m.claimed ? ' claimed' : done ? ' ready' : ''}`}>
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
                          <button type="button" className="lip pill" disabled={!done || claim.isPending} aria-label={t.claimOf(m.name)} onClick={() => claim.mutate({ kind: 'mission', period: period.period, id: m.id })}>
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
                  <li key={a.id} className={`lip panel mission-card achievement ${a.tier}${a.claimed ? ' claimed' : a.unlocked ? ' ready' : ''}`}>
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
                      <button type="button" className="lip pill" disabled={!a.unlocked || claim.isPending} aria-label={t.claimOf(a.name)} onClick={() => claim.mutate({ kind: 'achievement', id: a.id })}>
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
  const ready = useMissions().data?.ready ?? 0;
  const label = ready > 0 ? t.ready(ready) : t.title;
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
