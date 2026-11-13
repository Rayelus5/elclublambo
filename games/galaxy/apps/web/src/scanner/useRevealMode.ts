import { usePrefs } from '../settings/prefs';
import { hasWebGL2 } from '../ui/webgl';

// Which reveal plays (plan «escáner pro», part B; fusions too since plan «fusión pro»): the pro cinematic when
// «Presentación pro» is on (it is by default) and the browser has WebGL2; the classic one otherwise. The tutorial's
// first scan shows it too (the owner): its card is docked in a corner and points at nothing on the stage.
export function useRevealMode(): 'pro' | 'classic' {
  const pro = usePrefs((p) => p.scannerPro);
  return pro && hasWebGL2() ? 'pro' : 'classic';
}
