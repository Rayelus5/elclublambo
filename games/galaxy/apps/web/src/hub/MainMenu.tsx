import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
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

function Tile({ icon, title, color, d, children }: { icon: IconName; title: string; color: string; d: string; children?: ReactNode }) {
  return (
    <button type="button" className="lip panel tile locked enter" style={style({ '--d': d, '--c': color })} disabled>
      <Icon name={icon} />
      <b>{title}</b>
      {children ?? <Soon variant="text" />}
    </button>
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
          <Mode kind="m-terminal" icon="station" title={copy.hub.home} hint={copy.hub.homeHint} d=".94s" />
        </div>
      </div>

      <div className="row2">
        <button type="button" className="lip event locked enter" style={style({ '--d': '1s' })} disabled title={copy.hub.soon}>
          <span className="chip">
            <Icon name="comet" />
          </span>
          <span className="text">
            <b>{copy.hub.event}</b>
            <span>{copy.hub.eventHint}</span>
          </span>
          <Soon />
        </button>
        <button type="button" className="lip panel missions locked enter" style={style({ '--d': '1.05s' })} disabled title={copy.hub.soon}>
          <span className="head">
            <Icon name="list" />
            <b>{copy.hub.missions}</b>
          </span>
          <span className="pips" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <Soon />
        </button>
      </div>

      <div className="tiles">
        <Link to="/coleccion" className="lip panel tile enter" style={style({ '--d': '1.1s', '--c': 'var(--color-ice)' })}>
          <Icon name="cards" />
          <b>{copy.hub.collection}</b>
          <span className="sub">{galaxies === undefined ? '⠋⠙⠹' : copy.hub.galaxies(galaxies)}</span>
        </Link>
        <Tile icon="probe" title={copy.hub.probes} color="var(--color-terminal)" d="1.14s" />
        <Tile icon="trophy" title={copy.hub.achievements} color="var(--color-solar)" d="1.18s" />
        <Tile icon="clan" title={copy.hub.clan} color="var(--color-uv-soft)" d="1.22s" />
        <Tile icon="podium" title={copy.hub.ranking} color="var(--color-nova)" d="1.26s" />
        <Tile icon="book" title={copy.hub.codex} color="var(--color-solar-2)" d="1.3s" />
      </div>

      <div className="hub-foot">
        <button type="button" className="lip pill locked enter" style={style({ '--d': '1.34s' })} disabled title={copy.hub.soon}>
          <Icon name="gear" />
          <span>{copy.hub.settings}</span>
          <Soon />
        </button>
        <button type="button" className="lip pill locked enter" style={style({ '--d': '1.38s' })} disabled title={copy.hub.soon}>
          <Icon name="compass" />
          <span>{copy.hub.guide}</span>
          <Soon />
        </button>
      </div>
    </nav>
  );
}
