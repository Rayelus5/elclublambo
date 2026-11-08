import { useState } from 'react';
import { useBoosts } from '../api/boosts';
import { useLeaderboard } from '../api/social';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';

// The season's anomaly (GDD §13.1; M7d-3), as a tag: its name always in sight, and what it does behind «Más información»
// in a popup (the title screen's season column and the hangar). Nothing when no anomaly runs.

const t = copy.anomaly;
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

export function AnomalyTag({ className = '' }: { className?: string }) {
  const anomaly = useBoosts().data?.anomaly ?? null;
  const endsAt = useLeaderboard('general').data?.season?.endsAt;
  const [open, setOpen] = useState(false);
  if (!anomaly) return null;
  return (
    <div className={`anomaly-tag ${className}`}>
      <span className="anomaly-pill">
        <Icon name="alert" />
        <span>{t.tag(anomaly.name)}</span>
      </span>
      <button type="button" className="anomaly-info" aria-label={t.more(anomaly.name)} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="info" />
      </button>
      {open ? (
        <Dialog title={anomaly.name} className="anomaly-dialog" onClose={() => setOpen(false)}>
          <div className="anomaly-body">
            <span className="anomaly-badge" aria-hidden="true">
              <Icon name="alert" />
            </span>
            <div>
              <p className="anomaly-kind">{t.kind}</p>
              <p className="anomaly-desc">{anomaly.description}</p>
              <p className="anomaly-note">{t.note}</p>
              {endsAt ? <p className="anomaly-until">{t.until(day.format(new Date(endsAt)))}</p> : null}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={() => setOpen(false)} data-autofocus>
              {t.close}
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
