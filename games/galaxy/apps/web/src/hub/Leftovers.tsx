import { useState } from 'react';
import { useGacha, useLeftoversSeen } from '../api/economy';
import { copy } from '../copy/es';
import { playClaim } from '../missions/sfx';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

// Event signals left over (open beta): when an event and its scanner are over, the server turns what a player still
// holds into star dust. The next time the top bar shows (home or lobby), this window tells them so, once: each event,
// its signals and the dust they became. «Recibido» plays the dust's chime and marks them as seen.

const t = copy.leftovers;

export function LeftoversNotice() {
  const leftovers = useGacha().data?.leftovers ?? [];
  const seen = useLeftoversSeen();
  const [closed, setClosed] = useState<string[]>([]);
  const shown = leftovers.filter((l) => !closed.includes(l.id));
  if (shown.length === 0) return null;
  const close = () => {
    const ids = shown.map((l) => l.id);
    setClosed((c) => [...c, ...ids]);
    seen.mutate(ids);
  };
  return (
    <Dialog title={t.title} onClose={close} className="news leftovers">
      <p className="leftovers-lead">{t.lead}</p>
      <ul className="news-list">
        {shown.map((l) => (
          <li key={l.id} className="leftover">
            <b className="leftover-name">{l.label}</b>
            <div className="leftover-swap">
              <span className="res event-signal">
                <Icon name="ticket" />
                <b>{copy.hub.resource.eventSignal(l.signals)}</b>
              </span>
              <span className="leftover-into">{t.into}</span>
              <span className="res dust">
                <Icon name="dust" />
                <b>{copy.hub.resource.dust(l.dust)}</b>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button
          type="button"
          className="lip pill pill-solar"
          data-autofocus
          onClick={() => {
            playClaim({ dust: shown.reduce((n, l) => n + l.dust, 0) }, false);
            close();
          }}
        >
          {t.ok}
        </button>
      </div>
    </Dialog>
  );
}
