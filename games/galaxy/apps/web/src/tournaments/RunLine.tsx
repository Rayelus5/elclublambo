import { type TournamentList, tournamentPath } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { fetchTournaments, TOURNAMENT_LIST_KEY } from '../api/tournaments';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { inPlay, isBest, type RunGain, runGains } from './words';

// After a run (plan «temporadas como fichas», part 5): one line per running tournament I am in, with what the run added
// and my place now, an arrow when I climbed, leading to its page. A run's results say nothing of tournaments, so the
// list kept from before the run (the lobby reads it; it is kept for hours) is compared with the list read now. No
// list from before, or not in any tournament: nothing is asked and nothing is said. A test run counts nowhere.

const t = copy.tournaments;

function words(g: RunGain): string {
  return isBest(g.metric) ? t.runBest(t.value[g.metric](g.score), g.title, g.rank) : t.runGain(t.value[g.metric](g.gain), g.title, g.rank);
}

export function RunLine({ skip = false }: { skip?: boolean }) {
  const qc = useQueryClient();
  // The list as it was before this run, read once when the results open.
  const [before] = useState(() => (skip ? undefined : qc.getQueryData<TournamentList>(TOURNAMENT_LIST_KEY)));
  const [gains, setGains] = useState<RunGain[]>([]);
  useEffect(() => {
    if (!before || !inPlay(before)) return;
    let live = true;
    qc.fetchQuery({ queryKey: TOURNAMENT_LIST_KEY, queryFn: fetchTournaments, staleTime: 0 })
      .then((after) => {
        if (live) setGains(runGains(before, after));
      })
      .catch(() => {
        // Nothing to say without the list.
      });
    return () => {
      live = false;
    };
  }, [before, qc]);
  if (gains.length === 0) return null;
  return (
    <ul className="results-tournaments">
      {gains.map((g) => (
        <li key={g.slug}>
          <Link to={tournamentPath(g.slug)} className="lip panel results-tournament">
            <Icon name="trophy" />
            <span>{words(g)}</span>
            {g.climbed > 0 ? (
              <span className="tn-climb">
                <Icon name="up" />
                <b aria-hidden="true">{g.climbed}</b>
                <span className="sr-only">{`, ${t.climbed(g.climbed)}`}</span>
              </span>
            ) : null}
            <Icon name="next" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
