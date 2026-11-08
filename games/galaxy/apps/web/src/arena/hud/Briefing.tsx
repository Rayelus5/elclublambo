import { useEffect, useRef } from 'react';
import { copy } from '../../copy/es';
import { Icon } from '../../ui/Icon';

// The tutorial's briefing (polish phase 3): before the first run moves, three things to know, shown rather than told
// (keys that light up in turn, the probe firing on its own, the data crystals), and «Despegar». The run waits behind it.

const t = copy.tour.run;

export function Briefing({ onLaunch, onSkip }: { onLaunch: () => void; onSkip: () => void }) {
  const go = useRef<HTMLButtonElement>(null);
  useEffect(() => go.current?.focus(), []);
  return (
    <div className="briefing" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div className="briefing-card">
        <h2 id="briefing-title">{t.briefingTitle}</h2>
        <ul className="briefing-tips">
          <li>
            <span className="briefing-keys" aria-hidden="true">
              <i className="k-w">W</i>
              <span>
                <i className="k-a">A</i>
                <i className="k-s">S</i>
                <i className="k-d">D</i>
              </span>
            </span>
            <b>{t.move}</b>
            <small>{t.moveHint}</small>
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
