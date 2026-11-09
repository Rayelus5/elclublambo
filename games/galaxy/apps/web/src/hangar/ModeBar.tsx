import { Link } from 'react-router';
import { useRooms } from '../api/rooms';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// How to play (multiplayer plan, phase 5): three big choices over the hangar. Partida rápida launches now with the
// setup below; Solitario is this page (sector, probe and relics); En grupo leads to the rooms (or back to mine).

const t = copy.coop.modes;

export function ModeBar({ onQuick, launching, disabled }: { onQuick: () => void; launching: boolean; disabled: boolean }) {
  const mine = useRooms().data?.mine ?? null;
  return (
    <nav className="mode-bar" aria-label={t.label}>
      <button type="button" className="lip mode-card quick" onClick={onQuick} disabled={disabled || launching} aria-busy={launching || undefined} data-sfx="hover">
        <span className="mode-icon" aria-hidden="true">
          <Icon name="play" />
        </span>
        <span className="mode-text">
          <b>{t.quick}</b>
          <small>{t.quickHint}</small>
        </span>
      </button>
      <div className="lip mode-card solo current" aria-current="page">
        <span className="mode-icon" aria-hidden="true">
          <Icon name="probe" />
        </span>
        <span className="mode-text">
          <b>{t.solo}</b>
          <small>{t.soloHint}</small>
        </span>
      </div>
      <Link to={mine ? '/incursion/sala' : '/incursion/grupo'} className="lip mode-card group" data-sfx="hover">
        <span className="mode-icon" aria-hidden="true">
          <Icon name="clan" />
        </span>
        <span className="mode-text">
          <b>{t.group}</b>
          <small>{mine ? t.inRoom(mine.members.length, mine.max) : t.groupHint}</small>
        </span>
      </Link>
    </nav>
  );
}
