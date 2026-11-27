import { expect, test } from 'vitest';
import { type DeviceEnv, isMobileDevice } from '../src/device';

// Phones and tablets see «se juega en ordenador»; any computer plays (the owner, 2026-11-27: laptops under 1280 px —
// a 1920×1080 screen at 150 % is 1280×720 to the browser, a 1366×768 at 125 % is 1093×614 — got the phone notice).
// The device decides, never the size of its screen.

const UA = {
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
};

type Media = { hoverNone?: boolean; coarse?: boolean; anyFine?: boolean };
const env = (userAgent: string, o: { touch?: number; mobileHint?: boolean } & Media = {}): DeviceEnv => ({
  navigator: { userAgent, maxTouchPoints: o.touch ?? 0, ...(o.mobileHint === undefined ? {} : { userAgentData: { mobile: o.mobileHint } }) },
  matchMedia: (q: string) => ({
    matches: q === '(hover: none) and (pointer: coarse)' ? !!(o.hoverNone && o.coarse) : q === '(any-pointer: fine)' ? (o.anyFine ?? true) : false,
  }),
});

test.each([
  ['un portátil Windows (con cualquier escalado de pantalla)', env(UA.windowsChrome, { mobileHint: false })],
  ['un portátil Windows con pantalla táctil y trackpad', env(UA.windowsChrome, { touch: 10, anyFine: true })],
  ['un Mac', env(UA.macSafari)],
  ['un Linux', env(UA.linuxFirefox)],
  ['un Chromebook', env(UA.chromebook, { mobileHint: false })],
])('%s juega', (_, e) => {
  expect(isMobileDevice(e)).toBe(false);
});

test.each([
  ['un iPhone', env(UA.iphone, { touch: 5, hoverNone: true, coarse: true, anyFine: false })],
  ['un Android', env(UA.androidPhone, { touch: 5, mobileHint: true, hoverNone: true, coarse: true, anyFine: false })],
  ['una tablet Android', env(UA.androidTablet, { touch: 10, mobileHint: false, hoverNone: true, coarse: true, anyFine: false })],
  ['un iPad antiguo', env(UA.ipadOld, { touch: 5 })],
  // iPadOS asks for desktop sites as a Mac: a Mac with a touch screen is an iPad.
  ['un iPad que se presenta como Mac', env(UA.macSafari, { touch: 5 })],
  ['Firefox en Android', env(UA.firefoxAndroid, { touch: 5 })],
  // «Ver como ordenador» in a phone's browser: it says it is a computer, but it has no mouse or trackpad at all.
  ['un móvil en modo ordenador', env(UA.linuxFirefox, { touch: 5, hoverNone: true, coarse: true, anyFine: false })],
  ['un navegador que dice ser móvil', env(UA.linuxFirefox, { mobileHint: true })],
])('%s ve el aviso', (_, e) => {
  expect(isMobileDevice(e)).toBe(true);
});
