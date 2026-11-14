import { useEffect, useRef } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';
import { useKeybinds, useKeyLabels, keyLabel } from '../../settings/keybinds';

// The tutorial's briefing (polish phase 3): before the first run moves, four things to know, shown rather than told
// (keys that light up in turn, the probe firing on its own, the data crystals, the dash's key and its jump), and
// «Despegar». The run waits behind it.

const t = copy.tour.run;

export function Briefing({ onLaunch, onSkip }: { onLaunch: () => void; onSkip: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  // The player's own keys (Ajustes › Controles), as the hints say them.
  const k = useKeyLabels();
  const binds = useKeybinds();
  const cap = (code: string | null) => keyLabel(code) || '·';
  useEffect(() => go.current?.focus(), []);
  return (
    <div className="briefing" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div className="briefing-card">
        <h2 id="briefing-title">{t.briefingTitle}</h2>
        <ul className="briefing-tips">
          <li>
            <span className="briefing-keys" aria-hidden="true">
              <i className="k-w">{cap(binds.up[0])}</i>
              <span>
                <i className="k-a">{cap(binds.left[0])}</i>
                <i className="k-s">{cap(binds.down[0])}</i>
                <i className="k-d">{cap(binds.right[0])}</i>
              </span>
            </span>
            <b>{t.move}</b>
            <small>{t.moveHint(k)}</small>
          </li>
          <li>
            <span className="briefing-probe" aria-hidden="true">
              <i className="core" />
              <i className="shot s1" />
              <i className="shot s2" />
              <i className="shot s3" />
            </span>
            <b>{t.auto}</b>
            <small>{t.autoHint}</small>
          </li>
          <li>
            <span className="briefing-gems" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <b>{t.gems}</b>
            <small>{t.gemsHint}</small>
          </li>
          <li>
            <span className="briefing-dash" aria-hidden="true">
              <i className="k-shift">{k.dash}</i>
              <span className="dash-probe">
                <i className="ghost g1" />
                <i className="ghost g2" />
                <i className="core" />
              </span>
            </span>
            <b>{t.dash}</b>
            <small>{t.dashHint(k)}</small>
          </li>
        </ul>
        <div className="briefing-actions">
          <button type="button" className="lip pill small" onClick={onSkip}>
            {copy.tour.skip}
          </button>
          <button type="button" ref={go} className="lip pill pill-solar briefing-go" onClick={onLaunch}>
            <Icon name="play" />
            <span>{t.launch}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
