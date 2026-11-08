// The game's audio (GDD §17.4; M8a): one AudioContext for everything, with two buses (music and effects) under a master
// gain, and the player's choices (each volume and a mute for all) remembered in this browser. Everything is synthesised
// with WebAudio: no files, so the CSP stays as it is. The context only starts after a gesture (the browsers' rule).

const KEY = 'galaxy.audio';
const OLD_MUTE_KEY = 'galaxy.sfx.muted';

export interface AudioSettings {
  /** 0–1. */
  music: number;
  /** 0–1. */
  sfx: number;
  muted: boolean;
  /** The interface's own sounds (presses, tabs, the menu's hover), on the effects bus (M8 polish). */
  ui: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { music: 0.5, sfx: 0.8, muted: false, ui: true };

function clamp(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def;
}

export function readSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AudioSettings>;
      return { music: clamp(p.music, DEFAULT_AUDIO.music), sfx: clamp(p.sfx, DEFAULT_AUDIO.sfx), muted: p.muted === true, ui: p.ui !== false };
    }
    // The scanner's mute from before M8a still counts.
    return { ...DEFAULT_AUDIO, muted: localStorage.getItem(OLD_MUTE_KEY) === '1' };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

let settings = readSettings();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
const listeners = new Set<(s: AudioSettings) => void>();

/** A volume change, eased over a few milliseconds where the browser can (straight where it cannot). */
function setGain(node: GainNode, value: number): void {
  if (typeof node.gain.setTargetAtTime === 'function' && ctx) node.gain.setTargetAtTime(value, ctx.currentTime, 0.05);
  else node.gain.value = value;
}

function apply(): void {
  if (!master || !musicBus || !sfxBus) return;
  setGain(master, settings.muted ? 0 : 1);
  setGain(musicBus, settings.music * 0.6);
  setGain(sfxBus, settings.sfx);
}

/** The shared context and its buses, created on first use (null where WebAudio is missing). */
export function audioBus(): { ctx: AudioContext; music: GainNode; sfx: GainNode } | null {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain();
      musicBus = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus.connect(master);
      sfxBus.connect(master);
      master.connect(ctx.destination);
      apply();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, music: musicBus!, sfx: sfxBus! };
  } catch {
    return null;
  }
}

/** The effects bus, or null while everything is muted or the effects are at zero (nothing is even built then). */
export function sfxOut(): { ctx: AudioContext; out: GainNode } | null {
  if (settings.muted || settings.sfx <= 0) return null;
  const b = audioBus();
  return b ? { ctx: b.ctx, out: b.sfx } : null;
}

export function getSettings(): AudioSettings {
  return settings;
}

export function setSettings(next: Partial<AudioSettings>): void {
  settings = { ...settings, ...next, music: clamp(next.music ?? settings.music, settings.music), sfx: clamp(next.sfx ?? settings.sfx, settings.sfx) };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    localStorage.setItem(OLD_MUTE_KEY, settings.muted ? '1' : '0');
  } catch {
    // Private windows: the choice lasts for this page only.
  }
  apply();
  for (const l of listeners) l(settings);
}

export function onSettings(l: (s: AudioSettings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
