// Whether this device is a phone or a tablet (GDD §2: the game is played on a computer, with a keyboard and a mouse or
// trackpad). The device decides, never the size of its screen (the owner, 2026-11-27): a laptop's browser reports its
// screen divided by the system's scaling, so a 1920×1080 at 150 % is 1280×720 and a 1366×768 at 125 % is 1093×614, and
// those players got the phone notice. A small window on a computer plays too: the game's layout scrolls.
// The game (DesktopGate) and the landing's «Jugar gratis» both ask this, so they always agree.

/** What the check reads from the browser (window, or a stand-in in the tests). */
export interface DeviceEnv {
  navigator: { userAgent: string; maxTouchPoints?: number; userAgentData?: { mobile?: boolean } };
  matchMedia(query: string): { matches: boolean };
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i;

export function isMobileDevice(env: DeviceEnv): boolean {
  const nav = env.navigator;
  // The browser says so itself (Chromium's client hints).
  if (nav.userAgentData?.mobile === true) return true;
  if (MOBILE_UA.test(nav.userAgent)) return true;
  // iPadOS asks for desktop sites as a Mac: a Mac with a touch screen is an iPad.
  if (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1) return true;
  // Whatever it says it is («ver como ordenador» on a phone), a device with only a finger to point with, and no mouse
  // or trackpad at all, is not a computer. A touch-screen laptop still has its trackpad.
  if (env.matchMedia('(hover: none) and (pointer: coarse)').matches && !env.matchMedia('(any-pointer: fine)').matches) return true;
  return false;
}
