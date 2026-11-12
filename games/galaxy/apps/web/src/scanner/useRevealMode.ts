import { tourActive, useTutorial } from '../api/tutorial';
import { usePrefs } from '../settings/prefs';
import { hasWebGL2 } from '../ui/webgl';

// Which reveal plays (plan «escáner pro», part B): the pro cinematic when «Presentación pro del escáner» is on (it is
// by default) and the browser has WebGL2; the classic one otherwise, and while the guided tutorial is on the scanner
// (its bubbles point at the classic stage).
export function useRevealMode(): 'pro' | 'classic' {
  const pro = usePrefs((p) => p.scannerPro);
  const tutorial = useTutorial().data;
  const touring = tourActive(tutorial) && tutorial?.chapter === 'scanner';
  return pro && !touring && hasWebGL2() ? 'pro' : 'classic';
}
