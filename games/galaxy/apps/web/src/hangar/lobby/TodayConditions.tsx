import type { HangarView } from '@galaxy/shared';
import { useId, useState } from 'react';
import { useBoosts } from '../../api/boosts';
import { useLeaderboard } from '../../api/social';
import { copy } from '../../copy/es';
import { BoostCards, groupBoosts } from '../../hub/News';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';

// Condiciones de hoy (open beta): what changes today's runs, over Lanzar. The button carries small signs only (the
// hours left at full yield or the yield it pays now, the best multiplier, an alert when the season's anomaly runs) and
// the window says it all: the day's yield and its rule, the anomaly and what it does, the multipliers and their end.

const t = copy.today;
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

export function TodayButton({ daily }: { daily: HangarView['daily'] }) {
  const [open, setOpen] = useState(false);
  const data = useBoosts().data;
  const boosts = data?.boosts ?? [];
  const anomaly = data?.anomaly ?? null;
  const full = daily.fullSecondsLeft > 0;
  const pct = Math.round(daily.multiplier * 100);
  const best = boosts.reduce((m, b) => Math.max(m, b.factor), 0);
  const said = [
    full ? copy.hangar.dailyFull(copy.hangar.duration(daily.fullSecondsLeft)) : copy.hangar.dailyTier(pct),
    best > 0 ? t.srBoosts(best) : null,
    anomaly ? t.srAnomaly(anomaly.name) : null,
  ].filter(Boolean);
  return (
    <>
      <button type="button" className="lip pill small today-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="info" />
        <span className="today-name">{t.button}</span>
        <span className="sr-only">{said.join(', ')}</span>
        <span className="today-signs" aria-hidden="true">
          <span className={`today-sign today-daily${full ? '' : ' cut'}`}>
            <Icon name="comet" />
            {full ? t.dailyChip(daily.fullSecondsLeft) : t.cutChip(pct)}
          </span>
          {best > 0 ? <span className="today-sign today-boost">{t.boostChip(best)}</span> : null}
          {anomaly ? (
            <span className="today-sign today-anomaly">
              <Icon name="alert" />
            </span>
          ) : null}
        </span>
      </button>
      {open ? <TodayDialog daily={daily} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TodayDialog({ daily, onClose }: { daily: HangarView['daily']; onClose: () => void }) {
  const data = useBoosts().data;
  const groups = groupBoosts(data?.boosts ?? []);
  const anomaly = data?.anomaly ?? null;
  const endsAt = useLeaderboard('general').data?.season?.endsAt;
  const ids = useId();
  const full = daily.fullSecondsLeft > 0;
  return (
    <Dialog title={t.title} onClose={onClose} className="news today">
      <button type="button" className="lip iconbtn modal-close" aria-label={t.close} title={t.close} onClick={onClose}>
        <Icon name="close" />
      </button>
      <section className="news-section" aria-labelledby={`${ids}-daily`}>
        <h3 id={`${ids}-daily`}>{t.daily}</h3>
        <div className={`today-card today-daily-card${full ? '' : ' cut'}`}>
          <Icon name="comet" />
          <div>
            <p className="news-text">{full ? copy.hangar.dailyFull(copy.hangar.duration(daily.fullSecondsLeft)) : copy.hangar.dailyTier(Math.round(daily.multiplier * 100))}</p>
            <p className="today-note">{copy.hangar.dailyHint(daily.fullHours)}</p>
          </div>
        </div>
      </section>
      {anomaly ? (
        <section className="news-section" aria-labelledby={`${ids}-anomaly`}>
          <h3 id={`${ids}-anomaly`}>{t.anomaly}</h3>
          <div className="today-card today-anomaly-card">
            <Icon name="alert" />
            <div>
              <p className="news-text">{anomaly.name}</p>
              <p className="today-desc">{anomaly.description}</p>
              <p className="today-note">{copy.anomaly.note}</p>
              {endsAt ? <p className="news-until">{copy.anomaly.until(day.format(new Date(endsAt)))}</p> : null}
            </div>
          </div>
        </section>
      ) : null}
      {groups.length > 0 ? (
        <section className="news-section" aria-labelledby={`${ids}-boosts`}>
          <h3 id={`${ids}-boosts`}>{t.boosts}</h3>
          <BoostCards groups={groups} />
        </section>
      ) : null}
    </Dialog>
  );
}
