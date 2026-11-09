import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useCatalogSummary } from '../../api/catalog';
import { copy } from '../../copy/es';
import { Icon, type IconName } from '../../ui/Icon';

// The lobby's rail: the game's other places, one tap away, like the title screen's tiles (the owner: «desde el
// propio lobby también damos la posibilidad de que el jugador vaya a otras zonas»). Narrow screens keep the icons.

const z = copy.lobby.zone;
const ZONES: { to: string; icon: IconName; name: string; tone: string }[] = [
  { to: '/taller', icon: 'wrench', name: z.workshop, tone: 'terminal' },
  { to: '/coleccion', icon: 'cards', name: z.collection, tone: 'uv' },
  { to: '/estacion', icon: 'station', name: z.station, tone: 'sky' },
  { to: '/temporada', icon: 'comet', name: z.season, tone: 'solar' },
  { to: '/clasificacion', icon: 'podium', name: z.ranking, tone: 'nova' },
  { to: '/clanes', icon: 'clan', name: z.clan, tone: 'ice' },
];

export function Rail() {
  const ready = useCatalogSummary().data?.ready ?? 0;
  return (
    <nav className="lobby-rail" aria-label={copy.lobby.zones}>
      <ul>
        {ZONES.map((zone, i) => (
          <li key={zone.to}>
            <Link to={zone.to} className={`lip lobby-zone ${zone.tone}`} data-sfx="hover" title={zone.name} style={{ '--i': i } as CSSProperties}>
              <span className="lobby-zone-icon">
                <Icon name={zone.icon} />
              </span>
              <b className="lobby-zone-name">{zone.name}</b>
              {zone.to === '/coleccion' && ready > 0 ? (
                <span className="lobby-zone-badge" aria-hidden="true">
                  {copy.hub.reward}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
