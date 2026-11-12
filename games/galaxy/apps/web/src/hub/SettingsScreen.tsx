import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { manualAim, setManualAim } from '../arena/settings';
import { copy } from '../copy/es';
import { isSettingsTab, SettingsPanel } from '../settings/SettingsPanel';
import { BackLink } from '../ui/BackLink';

// Ajustes (GDD §17.4; M8a, DESIGN_SYSTEM §8 tertricies; redesigned in the «escáner pro» plan, part A): sound,
// display, accessibility, the run and help, as tabs. The tab lives in the address (`?seccion=`), replaced rather than
// pushed, so «Volver» still goes back to where the player came from. Everything lives in this browser except the
// notices mode, which is the account's. The run's pause shows the same panel (settings/SettingsPanel.tsx).

const t = copy.settings;

export function SettingsScreen() {
  const [aim, setAim] = useState(manualAim);
  const [params, setParams] = useSearchParams();
  const asked = params.get('seccion');
  const tab = isSettingsTab(asked) ? asked : 'sonido';
  return (
    <div className="screen-root missions-root">
      <div className="missions settings">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{t.title}</h1>
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
          onAim={(on) => {
            setManualAim(on);
            setAim(on);
          }}
        />
      </div>
    </div>
  );
}
