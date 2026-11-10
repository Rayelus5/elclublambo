import type { BoostsView, TitleNotice } from '@galaxy/shared';
import { type CSSProperties, useId, useState } from 'react';
import { useBoosts } from '../api/boosts';
import { useNotices } from '../api/mail';
import { useLeaderboard } from '../api/social';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';

// Noticias (open beta): the title notices, the season's anomaly and the multipliers running now no longer sit on the
// home screen. They wait behind a button of the top bar, next to Comunidad and Amigos, which says how many are new to
// this browser and opens them in a window: the notices (an important one marked), the anomaly and what it does, then
// the multipliers, one card per launch with each currency's factor and when it ends. Opening the window counts
// everything in it as seen.

const t = copy.news;
const KEY = 'gs.news.seen';
// When a multiplier ends, in full: «martes 17 de noviembre» and «00:00».
const endDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const endTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const ends = (iso: string) => t.until(endDay.format(new Date(iso)).replace(',', ''), endTime.format(new Date(iso)));
const CURRENCY_ICON: Record<string, IconName> = { coins: 'coin', dust: 'dust', signal: 'radar', material: 'station' };
const seasonDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

type Boost = BoostsView['boosts'][number];
export type Anomaly = NonNullable<BoostsView['anomaly']>;
/** The multipliers of one launch (same name, same end), shown and counted as one piece of news. */
export interface BoostGroup {
  key: string;
  name: string;
  endsAt: string;
  items: Boost[];
}

export function groupBoosts(boosts: Boost[]): BoostGroup[] {
  const groups = new Map<string, BoostGroup>();
  for (const b of boosts) {
    const key = `${b.name}|${b.endsAt}`;
    const g = groups.get(key) ?? { key, name: b.name, endsAt: b.endsAt, items: [] };
    g.items.push(b);
    groups.set(key, g);
  }
  return [...groups.values()];
}

const noticeId = (n: TitleNotice) => `n:${n.id}`;
const boostIds = (g: BoostGroup) => g.items.map((b) => `b:${b.id}`);
const anomalyId = (a: Anomaly) => `a:${a.id}`;

function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // Private windows: seen for this visit only.
  }
}

/** What there is now and what of it this browser has not seen. */
function useNews(seen: string[]) {
  const notices = useNotices().data ?? [];
  const boosts = useBoosts().data;
  const groups = groupBoosts(boosts?.boosts ?? []);
  const anomaly = boosts?.anomaly ?? null;
  const isNewNotice = (n: TitleNotice) => !seen.includes(noticeId(n));
  const isNewGroup = (g: BoostGroup) => boostIds(g).some((id) => !seen.includes(id));
  const anomalyNew = !!anomaly && !seen.includes(anomalyId(anomaly));
  const fresh = notices.filter(isNewNotice).length + groups.filter(isNewGroup).length + (anomalyNew ? 1 : 0);
  const ids = [...notices.map(noticeId), ...(anomaly ? [anomalyId(anomaly)] : []), ...groups.flatMap(boostIds)];
  return { notices, groups, anomaly, anomalyNew, fresh, ids, isNewNotice, isNewGroup };
}

export function NewsButton({ style }: { style?: CSSProperties }) {
  const [seen, setSeen] = useState<string[]>(readSeen);
  // What was seen before this opening, so the window can still mark what is new in it.
  const [shownWith, setShownWith] = useState<string[] | null>(null);
  const news = useNews(seen);
  const label = t.buttonLabel(news.fresh);
  return (
    <>
      <button
        type="button"
        className="lip pill fold enter news-button"
        style={style}
        aria-haspopup="dialog"
        aria-expanded={shownWith !== null}
        aria-label={label}
        title={label}
        onClick={() => {
          setShownWith(seen);
          const next = [...new Set([...seen, ...news.ids])];
          setSeen(next);
          saveSeen(next);
        }}
      >
        <Icon name="megaphone" />
        <span className="label">{t.button}</span>
        {news.fresh > 0 ? (
          <span className="news-badge" aria-hidden="true">
            {news.fresh > 9 ? '9+' : news.fresh}
          </span>
        ) : null}
      </button>
      {shownWith ? <NewsDialog seen={shownWith} onClose={() => setShownWith(null)} /> : null}
    </>
  );
}

function NewsDialog({ seen, onClose }: { seen: string[]; onClose: () => void }) {
  const { notices, groups, anomaly, anomalyNew, isNewNotice, isNewGroup } = useNews(seen);
  const endsAt = useLeaderboard('general').data?.season?.endsAt;
  const ids = useId();
  return (
    <Dialog title={t.title} onClose={onClose} className="news">
      <button type="button" className="lip iconbtn modal-close" aria-label={t.close} title={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      {notices.length === 0 && groups.length === 0 && !anomaly ? (
        <div className="news-empty">
          <Icon name="megaphone" />
          <p>
            <b>{t.empty}</b>
            <span>{t.emptyHint}</span>
          </p>
        </div>
      ) : null}
      {notices.length > 0 ? (
        <section className="news-section" aria-labelledby={`${ids}-notices`}>
          <h3 id={`${ids}-notices`}>{t.notices}</h3>
          <ul className="news-list">
            {notices.map((n) => (
              <li key={n.id} className={`news-notice ${n.tone}`}>
                <Icon name={n.tone === 'warning' ? 'alert' : 'info'} />
                <div>
                  {n.tone === 'warning' || isNewNotice(n) ? (
                    <p className="news-tags">
                      {n.tone === 'warning' ? <span className="news-tag important">{t.important}</span> : null}
                      {isNewNotice(n) ? <span className="news-tag fresh">{t.fresh}</span> : null}
                    </p>
                  ) : null}
                  <p className="news-text">{n.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {anomaly ? (
        <section className="news-section" aria-labelledby={`${ids}-anomaly`}>
          <h3 id={`${ids}-anomaly`}>{t.anomaly}</h3>
          <AnomalyCard anomaly={anomaly} endsAt={endsAt} fresh={anomalyNew} />
        </section>
      ) : null}
      {groups.length > 0 ? (
        <section className="news-section" aria-labelledby={`${ids}-boosts`}>
          <h3 id={`${ids}-boosts`}>{t.boosts}</h3>
          <BoostCards groups={groups} isNew={isNewGroup} />
        </section>
      ) : null}
    </Dialog>
  );
}

/** The multipliers running now, one card per launch: its name, each currency's factor and when it ends. */
export function BoostCards({ groups, isNew }: { groups: BoostGroup[]; isNew?: (g: BoostGroup) => boolean }) {
  return (
    <ul className="news-list">
      {groups.map((g) => (
        <li key={g.key} className="news-boost">
          <p className="news-boost-head">
            <b>{g.name}</b>
            {isNew?.(g) ? <span className="news-tag fresh">{t.fresh}</span> : null}
          </p>
          <ul className="news-rates">
            {g.items.map((b) => (
              <li key={b.id} className={`news-rate ${b.currency}`}>
                <Icon name={CURRENCY_ICON[b.currency] ?? 'star'} />
                <span>{t.rate(b.currency, b.factor)}</span>
              </li>
            ))}
          </ul>
          <p className="news-until">{ends(g.endsAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/** The season's anomaly: its name, what it does to every run, and until when (the season's end, when known). */
export function AnomalyCard({ anomaly, endsAt, fresh = false }: { anomaly: Anomaly; endsAt?: string; fresh?: boolean }) {
  return (
    <div className="today-card today-anomaly-card">
      <Icon name="alert" />
      <div>
        <p className="news-boost-head">
          <b>{anomaly.name}</b>
          {fresh ? <span className="news-tag fresh">{t.fresh}</span> : null}
        </p>
        <p className="today-desc">{anomaly.description}</p>
        <p className="today-note">{copy.anomaly.note}</p>
        {endsAt ? <p className="news-until">{copy.anomaly.until(seasonDay.format(new Date(endsAt)))}</p> : null}
      </div>
    </div>
  );
}
