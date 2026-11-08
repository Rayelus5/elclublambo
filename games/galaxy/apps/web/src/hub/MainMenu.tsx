import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useMissions } from '../api/missions';
import { copy } from '../copy/es';
import { Icon, type IconName } from '../ui/Icon';
import { Soon } from './Soon';

// The left column of the title screen (GDD §4, DESIGN_SYSTEM §7): Jugar, the two modes, the event and today's
// missions, the six section tiles and the footer. Everything a later milestone builds is shown but locked: the
// player sees where the game is going, and nothing pretends to work.
const style = (vars: Record<string, string>) => vars as CSSProperties;

function Mode({ kind, icon, title, hint, d, to }: { kind: string; icon: IconName; title: string; hint: string; d: string; to?: string }) {
  if (to) {
    return (
      <Link to={to} className={`lip mode ${kind} enter`} style={style({ '--d': d })}>
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
  const event = useMissions().data?.events[0];
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
    <Link to="/misiones?pestana=evento" className="lip event enter" style={style({ '--d': '1s' })}>
      <span className="chip">
        <Icon name="comet" />
      </span>
      <span className="text">
        <b>{event.name}</b>
        <span>{event.description}</span>
      </span>
    </Link>
  );
}

/** Today's missions: one pip per mission, lit when done; leads to the missions. */
function TodayMissions() {
  const daily = useMissions().data?.daily.missions;
  const done = daily?.filter((m) => m.progress >= m.target).length ?? 0;
  return (
    <Link to="/misiones" className="lip panel missions enter" style={style({ '--d': '1.05s' })}>
      <span className="head">
        <Icon name="list" />
        <b>{copy.hub.missions}</b>
      </span>
      <span className="pips" aria-hidden="true">
        {(daily ?? [0, 1, 2]).map((m, i) => (
          <i key={typeof m === 'number' ? m : m.id} className={i < done ? 'on' : undefined} />
        ))}
      </span>
      <span className="sub">{daily ? copy.hub.missionsDone(done, daily.length) : '⠋⠙⠹'}</span>
    </Link>
  );
}

export function MainMenu({ galaxies }: { galaxies: number | undefined }) {
  return (
    <nav className="menu" aria-label={copy.hub.menu}>
      <div className="row1">
        <Link to="/incursion" className="lip play enter" style={style({ '--d': '.8s' })}>
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
          <Mode kind="m-terminal" icon="station" title={copy.hub.home} hint={copy.hub.homeHint} d=".94s" to="/estacion" />
        </div>
      </div>

      <div className="row2">
        <EventButton />
        <TodayMissions />
      </div>

      <div className="tiles">
        <Link to="/coleccion" className="lip panel tile enter" style={style({ '--d': '1.1s', '--c': 'var(--color-ice)' })}>
          <Icon name="cards" />
          <b>{copy.hub.collection}</b>
          <span className="sub">{galaxies === undefined ? '⠋⠙⠹' : copy.hub.galaxies(galaxies)}</span>
        </Link>
        <Link to="/incursion" className="lip panel tile enter" style={style({ '--d': '1.14s', '--c': 'var(--color-terminal)' })}>
          <Icon name="probe" />
          <b>{copy.hub.probes}</b>
          <span className="sub">{copy.hub.probesHint}</span>
        </Link>
        <Link to="/misiones?pestana=logros" className="lip panel tile enter" style={style({ '--d': '1.18s', '--c': 'var(--color-solar)' })}>
          <Icon name="trophy" />
          <b>{copy.hub.achievements}</b>
          <span className="sub">{copy.hub.achievementsHint}</span>
        </Link>
        <Link to="/clanes" className="lip panel tile enter" style={style({ '--d': '1.22s', '--c': 'var(--color-uv-soft)' })}>
          <Icon name="clan" />
          <b>{copy.hub.clan}</b>
          <span className="sub">{copy.clans.tile}</span>
        </Link>
        <Link to="/clasificacion" className="lip panel tile enter" style={style({ '--d': '1.26s', '--c': 'var(--color-nova)' })}>
          <Icon name="podium" />
          <b>{copy.hub.ranking}</b>
          <span className="sub">{copy.social.rankingTile}</span>
        </Link>
        <Link to="/codice" className="lip panel tile enter" style={style({ '--d': '1.3s', '--c': 'var(--color-solar-2)' })}>
          <Icon name="book" />
          <b>{copy.hub.codex}</b>
          <span className="sub">{copy.hub.codexHint}</span>
        </Link>
      </div>

      <div className="hub-foot">
        <button type="button" className="lip pill locked enter" style={style({ '--d': '1.34s' })} disabled title={copy.hub.soon}>
          <Icon name="gear" />
          <span>{copy.hub.settings}</span>
          <Soon />
        </button>
        <Link to="/guia" className="lip pill enter" style={style({ '--d': '1.38s' })}>
          <Icon name="compass" />
          <span>{copy.hub.guide}</span>
        </Link>
      </div>
    </nav>
  );
}
