import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useCatalogSummary } from '../../api/catalog';
import { signUpOpen, useTournaments } from '../../api/tournaments';
import { copy } from '../../copy/es';
import { Icon, type IconName } from '../../ui/Icon';

// The lobby's rail: the game's other places, one tap away, like the title screen's tiles (the owner: «desde el
// propio lobby también damos la posibilidad de que el jugador vaya a otras zonas»). Narrow screens keep the icons.

const z = copy.lobby.zone;
// Each place's colour (the owner, 2026-11-14): Taller yellow, Colección light blue, Estación green, Temporada purple,
// Clasificación red, Clan dark blue; and Torneos ember (plan «temporadas como fichas», part 5), with a small dot while
// one takes sign-ups.
const ZONES: { to: string; icon: IconName; name: string; tone: string }[] = [
  { to: '/taller', icon: 'wrench', name: z.workshop, tone: 'solar' },
  { to: '/coleccion', icon: 'cards', name: z.collection, tone: 'ice' },
  { to: '/estacion', icon: 'station', name: z.station, tone: 'terminal' },
  { to: '/temporada', icon: 'comet', name: z.season, tone: 'uv' },
  { to: '/clasificacion', icon: 'podium', name: z.ranking, tone: 'nova' },
  { to: '/torneos', icon: 'trophy', name: z.tournaments, tone: 'ember' },
  { to: '/clanes', icon: 'clan', name: z.clan, tone: 'sky' },
];

export function Rail() {
  const ready = useCatalogSummary().data?.ready ?? 0;
  const signUp = signUpOpen(useTournaments().data);
  return (
    <nav className="lobby-rail" aria-label={copy.lobby.zones}>
      <ul>
        {ZONES.map((zone, i) => (
          <li key={zone.to}>
            <Link
              to={zone.to}
              className={`lip lobby-zone ${zone.tone}`}
              data-sfx="hover"
              title={zone.name}
              aria-label={zone.to === '/torneos' && signUp ? copy.lobby.tournamentsOpen : undefined}
              style={{ '--i': i } as CSSProperties}
            >
              <span className="lobby-zone-icon">
                <Icon name={zone.icon} outline />
              </span>
              <b className="lobby-zone-name">{zone.name}</b>
              {zone.to === '/coleccion' && ready > 0 ? (
                <span className="lobby-zone-badge" aria-hidden="true">
                  {copy.hub.reward}
                </span>
              ) : null}
              {zone.to === '/torneos' && signUp ? <i className="tn-dot" aria-hidden="true" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
