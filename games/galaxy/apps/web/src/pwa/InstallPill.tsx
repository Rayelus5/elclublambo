import { type CSSProperties, useState } from 'react';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { promptInstall, useInstall } from './install';

// The install pill at the foot of the title screen (galaxysurvivor.es plan, PR 3; the owner: small and dismissible).
// It only shows while the browser offers to install the game and we are not in the installed window already; the ×
// on its corner hides it for good on this browser, and Ajustes › Pantalla keeps the same button for later. It takes
// the room left at the end of the foot: «Instalar» with its icon, or the icon alone when the shop's pill is there too,
// so the foot stays one line (a container query on its slot).

const HIDDEN_KEY = 'galaxy.install.hidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallPill({ style }: { style?: CSSProperties }) {
  const { canPrompt, standalone } = useInstall();
  const [hidden, setHidden] = useState(readHidden);
  if (!canPrompt || standalone || hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      // Hidden for this visit only.
    }
  };
  return (
    <span className="hub-install-slot enter" style={style}>
      <span className="hub-install">
        <button type="button" className="lip pill hub-install-go" data-sfx="hover" aria-label={copy.hub.install} title={copy.hub.install} onClick={() => void promptInstall()}>
          <Icon name="install" />
          <span className="hub-install-label">{copy.hub.installShort}</span>
        </button>
        <button type="button" className="hub-install-hide" aria-label={copy.hub.installHide} title={copy.hub.installHide} onClick={hide}>
          <Icon name="close" />
        </button>
      </span>
    </span>
  );
}
