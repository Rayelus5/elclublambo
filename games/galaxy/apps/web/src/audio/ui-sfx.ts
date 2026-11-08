import { getSettings, sfxOut } from './mixer';

// The interface's sounds (M8 polish): short, soft and a little musical, so pressing things feels good without tiring.
// Synthesised on the effects bus (its volume and the mute for all apply), each kind rate-limited, and each repeat
// nudged to a neighbouring pitch from a small set, so a run of clicks never sounds mechanical.

export type UiSound = 'tap' | 'tab' | 'toggle' | 'confirm' | 'back' | 'hover';

const GAP: Record<UiSound, number> = { tap: 0.035, tab: 0.05, toggle: 0.05, confirm: 0.06, back: 0.05, hover: 0.07 };
const VARY = [1, 1.0293, 0.9715, 1.0595, 1.0149];
const last: Partial<Record<UiSound, number>> = {};
let turn = 0;

/** One soft voice: a quick attack, a pitch that settles a little, through a low-pass so it never bites. */
function voice(ctx: AudioContext, out: AudioNode, t: number, hz: number, dur: number, vol: number, type: OscillatorType = 'triangle'): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz * 1.04, t);
  o.frequency.exponentialRampToValueAtTime(hz, t + Math.min(0.03, dur / 2));
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Plays one interface sound (nothing when muted, at zero, switched off in Ajustes or too soon after the last). */
export function playUi(kind: UiSound): void {
  if (!getSettings().ui) return;
  const bus = sfxOut();
  if (!bus) return;
  const { ctx, out } = bus;
  const t = ctx.currentTime;
  if (t - (last[kind] ?? -1) < GAP[kind]) return;
  last[kind] = t;
  const v = VARY[turn++ % VARY.length]!;
  switch (kind) {
    case 'tap':
      voice(ctx, out, t, 880 * v, 0.07, 0.055);
      voice(ctx, out, t, 1760 * v, 0.03, 0.012, 'sine');
      break;
    case 'hover':
      voice(ctx, out, t, 1320 * v, 0.045, 0.014, 'sine');
      break;
    case 'tab':
      voice(ctx, out, t, 1046.5 * v, 0.06, 0.045);
      break;
    case 'toggle':
      voice(ctx, out, t, 659.3 * v, 0.06, 0.045);
      voice(ctx, out, t + 0.05, 987.8 * v, 0.08, 0.04);
      break;
    case 'confirm':
      voice(ctx, out, t, 523.3 * v, 0.08, 0.06);
      voice(ctx, out, t + 0.06, 784 * v, 0.12, 0.055);
      voice(ctx, out, t + 0.06, 1568 * v, 0.06, 0.01, 'sine');
      break;
    case 'back':
      voice(ctx, out, t, 698.5 * v, 0.06, 0.045);
      voice(ctx, out, t + 0.045, 523.3 * v, 0.08, 0.04);
      break;
  }
}

/** What a pressed element sounds like: tabs, switches, the main actions, the way back, and a soft tap for the rest. */
export function soundOf(el: Element): UiSound {
  const explicit = el.getAttribute('data-sfx');
  if (explicit === 'confirm' || explicit === 'back' || explicit === 'toggle' || explicit === 'tab') return explicit;
  const role = el.getAttribute('role');
  if (role === 'tab' || el.hasAttribute('aria-selected')) return 'tab';
  if (role === 'switch' || role === 'checkbox' || (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))) return 'toggle';
  if (el.matches('.pill-solar, .primary, .play, .launch, .lip.event')) return 'confirm';
  if (el.matches('.back-link, .home-link')) return 'back';
  return 'tap';
}

/** What counts as interactive for these sounds. */
export const INTERACTIVE = 'button, a[href], [role="tab"], [role="switch"], [role="option"], [role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="range"], select, summary';
