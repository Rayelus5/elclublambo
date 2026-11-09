import { useState } from 'react';
import { copy } from '../../copy/es';
import { sfx } from '../../scanner/sfx';
import { Dialog } from '../../ui/Dialog';

// Pause (GDD §5.2): continue, manual aim, sound, and abandoning the run — a retreat that pays half, so it asks first.

export function PauseMenu({
  manualAim,
  onManualAim,
  onResume,
  onAbandon,
  onSkipTutorial,
}: {
  manualAim: boolean;
  onManualAim: (on: boolean) => void;
  onResume: () => void;
  onAbandon: () => void;
  /** In the tutorial's run: leave the tutorial and keep playing (polish phase 3). */
  onSkipTutorial?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [muted, setMuted] = useState(sfx.muted());
  if (confirming) {
    return (
      <Dialog title={copy.arena.abandon} role="alertdialog" onClose={() => setConfirming(false)} className="pause confirm">
        <p>{copy.arena.abandonBody}</p>
        <div className="modal-actions">
          <button type="button" className="lip pill" onClick={() => setConfirming(false)} data-autofocus>
            {copy.arena.keepPlaying}
          </button>
          <button type="button" className="lip pill danger" onClick={onAbandon}>
            {copy.arena.abandonConfirm}
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={copy.arena.pause} onClose={onResume} className="pause">
      <div className="pause-actions">
        <button type="button" className="lip pill pill-solar pause-resume" onClick={onResume} data-autofocus>
          {copy.arena.resume}
        </button>
        <label className="pause-toggle">
          <input type="checkbox" checked={manualAim} onChange={(e) => onManualAim(e.target.checked)} />
          <span>{copy.arena.manualAim}</span>
        </label>
        <label className="pause-toggle">
          <input
            type="checkbox"
            checked={!muted}
            onChange={(e) => {
              sfx.setMuted(!e.target.checked);
              setMuted(!e.target.checked);
            }}
          />
          <span>{copy.arena.sound}</span>
        </label>
        {onSkipTutorial ? (
          <button type="button" className="lip pill" onClick={onSkipTutorial}>
            {copy.tour.skip}
          </button>
        ) : null}
        <button type="button" className="lip pill danger" onClick={() => setConfirming(true)}>
          {copy.arena.abandon}
        </button>
      </div>
    </Dialog>
  );
}
