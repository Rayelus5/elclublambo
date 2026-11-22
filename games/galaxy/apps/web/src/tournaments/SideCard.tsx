import { tournamentPath } from '@galaxy/shared';
import { useId } from 'react';
import { Link } from 'react-router';
import { useTournaments } from '../api/tournaments';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { TimeChip } from './parts';

// The leaderboard's «Torneos en curso» (plan «temporadas como fichas», part 5): beside the season card, each running
// tournament as one link to its page, with the time left and my place (or that I am not in it); nothing at all while
// none runs. The whole list is on /torneos.

const t = copy.tournaments;
const SHOWN = 4;

export function TournamentsSideCard() {
  const running = useTournaments().data?.running;
  const id = useId();
  if (!Array.isArray(running) || running.length === 0) return null;
  // The ones I am in first.
  const shown = [...running].sort((a, b) => Number(b.me?.status === 'joined') - Number(a.me?.status === 'joined')).slice(0, SHOWN);
  return (
    <section className="lip panel tn-side-card" aria-labelledby={id}>
      <h2 id={id}>
        <Icon name="trophy" />
        {t.sideTitle}
      </h2>
      <ul>
        {shown.map((c) => {
          const me = c.me?.status === 'joined' ? c.me : null;
          return (
            <li key={c.id}>
              <Link to={tournamentPath(c.slug)} className={`tn-side-item${me ? ' in' : ''}`} data-sfx="hover">
                <span className="tn-side-name">
                  <b>{c.title}</b>
                  <TimeChip card={c} className="tn-side-time" />
                </span>
                <span className="tn-side-me">{me ? me.rank !== null ? <b>{t.rankNow(me.rank)}</b> : t.noScore : t.sideNotIn}</span>
                <Icon name="next" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Link to="/torneos" className="lip pill small tn-side-all">
        <span>{t.sideAll}</span>
        <Icon name="next" />
      </Link>
    </section>
  );
}
