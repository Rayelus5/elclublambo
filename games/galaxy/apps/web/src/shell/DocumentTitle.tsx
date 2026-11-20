import { titleFor } from '@galaxy/shared';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

// The tab's title follows the screen (galaxysurvivor.es plan, PR 2): «Escáner profundo | Galaxy Survivor», the same
// title the server writes into the shell (@galaxy/shared's titleFor), so the installed app's window and the browser's
// history say where the player was.

/** Keeps document.title on the current screen's title. Renders nothing. */
export function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);
  return null;
}
