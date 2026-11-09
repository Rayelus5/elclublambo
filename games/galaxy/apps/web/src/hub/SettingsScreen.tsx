import { useState } from 'react';
import { manualAim, setManualAim } from '../arena/settings';
import { copy } from '../copy/es';
import { ArenaSection, CursorSection, HelpSection, SoundSection } from '../settings/SettingsSections';
import { BackLink } from '../ui/BackLink';

// Ajustes (GDD §17.4; M8a, DESIGN_SYSTEM §8 tertricies): sound, the arena's aiming, the game's cursor (open beta), and
// bringing back PERKINS's lines, the first steps and the tutorial. Everything lives in this browser. The run's pause
// shows the same sections (settings/SettingsSections.tsx).

const t = copy.settings;

export function SettingsScreen() {
  const [aim, setAim] = useState(manualAim);
  return (
    <div className="screen-root missions-root">
      <div className="missions settings">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
        </header>
        <SoundSection />
        <ArenaSection
          aim={aim}
          onAim={(on) => {
            setManualAim(on);
            setAim(on);
          }}
        />
        <CursorSection />
        <HelpSection />
      </div>
    </div>
  );
}
