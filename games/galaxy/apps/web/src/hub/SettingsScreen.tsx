import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { manualAim, onManualAim, setManualAim } from '../arena/settings';
import { copy } from '../copy/es';
import { isSettingsTab, SettingsPanel } from '../settings/SettingsPanel';
import { SettingsSyncNote } from '../settings/SettingsSync';
import { BackLink } from '../ui/BackLink';

// Ajustes (GDD §17.4; M8a, DESIGN_SYSTEM §8 tertricies; redesigned in the «escáner pro» plan, part A): sound,
// display, accessibility, the run and help, as tabs. The tab lives in the address (`?seccion=`), replaced rather than
// pushed, so «Volver» still goes back to where the player came from. Everything is kept on the account (plan «ajustes
// en la cuenta»), with a copy in this browser; a quiet line says how that stands. The run's pause shows the same panel
// (settings/SettingsPanel.tsx).

const t = copy.settings;

export function SettingsScreen() {
  // The account's settings can arrive while this screen is open: it follows them.
  const aim = useSyncExternalStore(onManualAim, manualAim);
  const [params, setParams] = useSearchParams();
  const asked = params.get('seccion');
  const tab = isSettingsTab(asked) ? asked : 'sonido';
  return (
    <div className="screen-root missions-root">
      <div className="missions settings">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
          <SettingsSyncNote />
        </header>
        <SettingsPanel
          tab={tab}
          onTab={(next) =>
            setParams(
              (p) => {
                p.set('seccion', next);
                return p;
              },
              { replace: true },
            )
          }
          aim={aim}
          onAim={setManualAim}
        />
      </div>
    </div>
  );
}
