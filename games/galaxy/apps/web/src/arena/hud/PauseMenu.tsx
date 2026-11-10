import { useState } from 'react';
import { copy } from '../../copy/es';
import { ArenaSection, CursorSection, HelpSectionInRun, SoundSection } from '../../settings/SettingsSections';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';

// Pause (GDD §5.2): continue, the same settings as the home menu (open beta: sound, aiming, the cursor; help waits for
// the menu), and abandoning the run — a retreat that pays half, so it asks first.

export function PauseMenu({
  manualAim,
  onManualAim,
  onResume,
  onAbandon,
  onSkipTutorial,
  title = copy.arena.pause,
  abandonBody = copy.arena.abandonBody,
}: {
  manualAim: boolean;
  onManualAim: (on: boolean) => void;
  onResume: () => void;
  onAbandon: () => void;
  /** In the tutorial's run: leave the tutorial and keep playing (polish phase 3). */
  onSkipTutorial?: () => void;
  /** Co-op (multiplayer plan): the world does not stop, so it is a menu, and abandoning says what it means there. */
  title?: string;
  abandonBody?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [settings, setSettingsOpen] = useState(false);
  if (confirming) {
    return (
      <Dialog title={copy.arena.abandon} role="alertdialog" onClose={() => setConfirming(false)} className="pause confirm">
        <p>{abandonBody}</p>
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
  if (settings) {
    return (
      <Dialog title={copy.settings.title} onClose={onResume} className="pause pause-settings">
        {/* Two columns, so everything fits without scrolling on a 1280×720 screen. */}
        <div className="pause-settings-body">
          <div className="pause-settings-col">
            <SoundSection />
            <ArenaSection aim={manualAim} onAim={onManualAim} />
          </div>
          <div className="pause-settings-col">
            <CursorSection />
            <HelpSectionInRun />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="lip pill" onClick={() => setSettingsOpen(false)} data-autofocus>
            {copy.settings.back}
          </button>
          <button type="button" className="lip pill pill-solar" onClick={onResume}>
            {copy.arena.resume}
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={title} onClose={onResume} className="pause">
      <div className="pause-actions">
        <button type="button" className="lip pill pill-solar pause-resume" onClick={onResume} data-autofocus>
          {copy.arena.resume}
        </button>
        <button type="button" className="lip pill" onClick={() => setSettingsOpen(true)}>
          <Icon name="gear" />
          <span>{copy.settings.title}</span>
        </button>
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
