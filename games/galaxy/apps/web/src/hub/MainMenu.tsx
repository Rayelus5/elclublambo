import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useMyClan } from '../api/clans';
import { readyIn } from '../missions/ready';
import { useMissions } from '../api/missions';
import { TodayMissions } from './TodayMissions';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { Soon } from './Soon';
import { useCatalogSummary } from '../api/catalog';
import { useGacha } from '../api/economy';

// The left column of the title screen (GDD §4, DESIGN_SYSTEM §7): Jugar, the two modes, the event and today's
// missions, the six section tiles and the footer. Everything a later milestone builds is shown but locked: the
// player sees where the game is going, and nothing pretends to work.
const style = (vars: Record<string, string>) => vars as CSSProperties;

function Mode({ kind, icon, title, hint, d, to, tour }: { kind: string; icon: IconName; title: string; hint: string; d: string; to?: string; tour?: string }) {
  if (to) {
    return (
      <Link to={to} className={`lip mode ${kind} enter`} data-sfx="hover" data-tour={tour} style={style({ '--d': d })}>
        <span className="chip">
          <Icon name={icon} />
        </span>
        <span className="text">
          <b>{title}</b>
          <span>{hint}</span>
        </span>
      </Link>
    );
  }
  return (
    <button type="button" className={`lip mode ${kind} locked enter`} style={style({ '--d': d })} disabled title={copy.hub.soon}>
      <span className="chip">
        <Icon name={icon} />
      </span>
      <span className="text">
        <b>{title}</b>
        <span>{hint}</span>
      </span>
      <Soon />
    </button>
  );
}

/** The event running now (M7e-1): it leads to its goals; without one, the place stays, quiet. */
function EventButton() {
  const missions = useMissions().data;
  const event = missions?.events[0];
  const waiting = missions ? readyIn(missions, 'events').length : 0;
  if (!event) {
    return (
      <button type="button" className="lip event locked enter" style={style({ '--d': '1s' })} disabled>
        <span className="chip">
          <Icon name="comet" />
        </span>
        <span className="text">
          <b>{copy.hub.event}</b>
          <span>{copy.hub.noEvent}</span>
        </span>
      </button>
    );
  }
  return (
    <Link to="/misiones?pestana=evento" className="lip event enter" data-sfx="hover" style={style({ '--d': '1s' })}>
      <span className="chip">
        <Icon name="comet" />
      </span>
      <span className="text">
        <b>{event.name}</b>
        <span>{event.description}</span>
      </span>
      {waiting > 0 ? <span className="event-ready">{copy.hub.eventReady}</span> : null}
    </Link>
  );
}

/** A section tile: the same three lines in all six (icon, title and a one-line note), whatever the note says. */
function Tile({ to, icon, title, sub, color, d, badge, label }: { to: string; icon: IconName; title: string; sub: string; color: string; d: string; badge?: string; label?: string }) {
  return (
    <Link to={to} className={badge ? 'lip panel tile enter has-badge' : 'lip panel tile enter'} data-sfx="hover" style={style({ '--d': d, '--c': color })} aria-label={label}>
      {badge ? (
        <span className="tile-badge" aria-hidden="true">
          {badge}
        </span>
      ) : null}
      <Icon name={icon} />
      <b>{title}</b>
      <span className="sub">{sub}</span>
    </Link>
  );
}

export function MainMenu({ galaxies }: { galaxies: number | undefined }) {
  const clan = useMyClan().data;
  const catalogReady = useCatalogSummary().data?.ready ?? 0;
  // The resource shop (shop and lab plan, F5): only while it is open for this account, with a sign while an offer runs.
  const shop = useGacha().data?.shop;
  return (
    <nav className="menu" aria-label={copy.hub.menu}>
      <div className="row1">
        <Link to="/incursion" className="lip play enter" data-sfx="hover" data-tour="play" style={style({ '--d': '.8s' })}>
          <span className="play-ring">
            <Icon name="play" />
          </span>
          <span>
            <span className="title">{copy.hub.play}</span>
            <span className="hint">{copy.hub.playHint}</span>
          </span>
        </Link>
        <div className="modes">
          <Mode kind="m-nova" icon="target" title={copy.hub.survival} hint={copy.hub.survivalHint} d=".88s" to="/incursion" />
          <Mode kind="m-terminal" icon="station" title={copy.hub.home} hint={copy.hub.homeHint} d=".94s" to="/estacion" tour="home" />
        </div>
      </div>

      <div className="row2">
        <EventButton />
        <TodayMissions />
      </div>

      <div className="tiles">
        <Tile
          to="/coleccion"
          icon="cards"
          title={copy.hub.collection}
          sub={galaxies === undefined ? '⠋⠙⠹' : copy.hub.galaxies(galaxies)}
          color="var(--color-ice)"
          d="1.1s"
          badge={catalogReady > 0 ? copy.hub.reward : undefined}
          label={catalogReady > 0 ? copy.hub.collectionReward(galaxies ?? 0, catalogReady) : undefined}
        />
        <Tile to="/taller" icon="probe" title={copy.hub.probes} sub={copy.hub.probesHint} color="var(--color-terminal)" d="1.14s" />
        <Tile to="/misiones?pestana=logros" icon="trophy" title={copy.hub.achievements} sub={copy.hub.achievementsHint} color="var(--color-solar)" d="1.18s" />
        <Tile to="/clanes" icon="clan" title={copy.hub.clan} sub={clan ? `[${clan.tag}]` : copy.hub.clanHint} color="var(--color-uv-soft)" d="1.22s" />
        <Tile to="/clasificacion" icon="podium" title={copy.hub.ranking} sub={copy.social.rankingTile} color="var(--color-nova)" d="1.26s" />
        <Tile to="/codice" icon="book" title={copy.hub.codex} sub={copy.hub.codexHint} color="var(--color-solar-2)" d="1.3s" />
      </div>

      <div className="hub-foot">
        <Link to="/ajustes" className="lip pill enter" style={style({ '--d': '1.34s' })}>
          <Icon name="gear" />
          <span>{copy.hub.settings}</span>
        </Link>
        <Link to="/guia" className="lip pill enter" style={style({ '--d': '1.38s' })}>
          <Icon name="compass" />
          <span>{copy.hub.guide}</span>
        </Link>
        {shop?.open ? (
          <Link to="/tienda" className="lip pill pill-solar enter hub-shop" data-sfx="hover" style={style({ '--d': '1.42s' })} aria-label={shop.offer ? copy.hub.shopOffer : undefined}>
            <Icon name="store" />
            <span>{copy.hub.shop}</span>
            {shop.offer ? (
              <span className="tile-badge hub-shop-badge" aria-hidden="true">
                {copy.hub.offer}
              </span>
            ) : null}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
