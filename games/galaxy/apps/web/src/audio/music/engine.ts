import { createScore, type Score } from '../score';
import { type Biome, type Composition, COMPOSITIONS } from './compositions';
import type { MusicChoice, MusicLibrary } from './files';
import { createPlanner, type NoteEvent, type Planner } from './generate';
import { seeded, seedOf } from './rng';
import { type Layer, type MusicStyleId, type Role, STYLES, type Style } from './styles';
import { degreeMidi } from './theory';
import { VOICES } from './voices';

// The soundtrack's engine (plan «banda sonora», part A): it plays a scene — the menu's playlist, a sector with its
// intensity, a Núcleo, the results — in the chosen style. Notes are scheduled sixteenth by sixteenth a little ahead on
// the audio clock (never on the frame rate). Each piece has four layers whose gains fade with linear ramps when the
// intensity moves, so nothing clicks; a change of piece waits for the bar line and crossfades over two seconds; the
// menu moves to another piece when one has played through; choosing a level-up dims it (a low-pass), a pause ducks
// it. It never holds more than its voices (the least essential notes give way), and everything goes through a soft
// reverb, an echo and a gentle compressor so the pieces sit at one level. A voice counts while its note is held (its
// release tail is free), and notes that fell behind (a hidden tab, a busy page) are skipped, never played at once. Where the owner put a file for a piece
// (files.ts), the piece plays from it instead, its layers following the intensity; a file that fails to load leaves
// the generated piece in its place.

export type MusicScene =
  | { kind: 'menu' }
  | { kind: 'results' }
  | {
      kind: 'run';
      biome: Biome;
      /** A Núcleo on the field: the deep one has its own piece; the others alternate (form 1 or 2). */
      boss: null | { deep: boolean; form: 1 | 2 };
      intensity: Layer;
      choosing: boolean;
      paused: boolean;
    };

export type StingerKind = 'extract' | 'death' | 'layer';

export interface EngineState {
  playing: boolean;
  piece: string | null;
  style: MusicStyleId;
  choice: MusicChoice;
  /** Whether the piece comes from its files or is generated. */
  source: 'file' | 'generated';
  /** When the current piece began (audio clock). */
  startedAt: number;
  bar: number;
  loop: number;
  section: string;
  intensity: Layer;
  voices: number;
  /** Notes played and dropped for lack of voices, by instrument (the Ensayo, the tests). */
  played: Partial<Record<Role, number>>;
  dropped: Partial<Record<Role, number>>;
  filtered: boolean;
  ducked: boolean;
  /** Its seed, and each instrument's level (the Ensayo can change them). */
  seed: number;
  mix: Record<Role, number>;
}

export interface EngineOptions {
  seed?: number;
  /** A style, or «Mi música» (the owner's files over the default style). */
  choice?: MusicChoice;
  library?: MusicLibrary;
  /** Fetches and decodes a file (the default uses fetch and the context). */
  load?: (url: string) => Promise<AudioBuffer>;
  /** How far ahead notes are scheduled (s). */
  lookahead?: number;
  voiceCap?: number;
}

interface Player {
  comp: Composition;
  style: Style;
  planner: Planner;
  gain: GainNode;
  layers: GainNode[];
  roles: Map<Role, GainNode>;
  bar: number;
  step: number;
  stepAt: number;
  stepDur: number;
  byStep: NoteEvent[][];
  startedAt: number;
  /** Stops scheduling at this time (it is fading out). */
  until: number | null;
  /** Playing from the owner's files: loading (score null), playing, or failed (back to generated). */
  file: { score: Score | null; layers: number; failed: boolean } | null;
}

const ORDER: Role[] = ['pad', 'bass', 'kick', 'lead', 'snare', 'choir', 'brass', 'timpani', 'bells', 'arp', 'keys', 'hat', 'tom', 'shaker', 'texture'];
const PRIORITY = new Map(ORDER.map((r, i) => [r, i]));
const SECTOR_PIECE = (biome: Biome) => COMPOSITIONS.find((c) => c.group === 'sector' && c.biome === biome)?.id ?? 'sector-nebulosa';
const FADE_IN = 1.5;
const CROSSFADE = 2;
const LAYER_FADE = 1.2;

/** A soft room: seeded noise that dies away, a little different on each side. */
function impulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const b = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const rand = seeded(seed + ch);
    for (let i = 0; i < length; i++) d[i] = (rand() * 2 - 1) * (1 - i / length) ** 2.4;
  }
  return b;
}

/** From wherever the value is now (a fade turned round halfway carries on from there: no jump), to `to`. */
function ramp(param: AudioParam, to: number, at: number, over: number) {
  const hold = (param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void }).cancelAndHoldAtTime;
  if (typeof hold === 'function') hold.call(param, at);
  else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
  }
  param.linearRampToValueAtTime(to, at + over);
}

/** A fresh node's fade, from a known value. */
function fade(param: AudioParam, from: number, to: number, at: number, over: number) {
  param.setValueAtTime(from, at);
  param.linearRampToValueAtTime(to, at + over);
}

export function createEngine(ctx: BaseAudioContext, out: AudioNode, opts: EngineOptions = {}) {
  let lookahead = opts.lookahead ?? 0.15;
  const cap = opts.voiceCap ?? 32;
  const session = opts.seed ?? 1;
  const styleOf = (c: MusicChoice): Style => (c === 'own' ? STYLES.ambient : (STYLES[c] ?? STYLES.ambient));
  let choice: MusicChoice = opts.choice ?? 'ambient';
  let style = styleOf(choice);
  const load =
    opts.load ??
    (async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`music ${res.status}`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    });

  // The chain: everything → tone (a low-pass) → compressor → level → the music bus; a reverb and an echo on the side.
  const input = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = style.fx.tone;
  tone.Q.value = 0.5;
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -20;
  squeeze.knee.value = 18;
  squeeze.ratio.value = 2.5;
  squeeze.attack.value = 0.02;
  squeeze.release.value = 0.3;
  const level = ctx.createGain();
  level.gain.value = 0;
  input.connect(tone);
  tone.connect(squeeze);
  squeeze.connect(level);
  level.connect(out);
  const verbSend = ctx.createGain();
  const verb = ctx.createConvolver();
  const delaySend = ctx.createGain();
  delaySend.gain.value = 0.14;
  const delay = ctx.createDelay(2);
  const feedback = ctx.createGain();
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2400;
  input.connect(verbSend);
  verbSend.connect(verb);
  verb.connect(tone);
  input.connect(delaySend);
  delaySend.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(tone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  const stingers = ctx.createGain();
  stingers.gain.value = 0.9;
  stingers.connect(input);

  function dress(s: Style) {
    verbSend.gain.value = s.fx.wet;
    verb.buffer = impulse(ctx, s.fx.reverb, seedOf(session, s.id, 'room'));
    feedback.gain.value = s.fx.feedback;
  }
  dress(style);

  let playing = false;
  let scene: MusicScene = { kind: 'menu' };
  let current: Player | null = null;
  let fading: Player[] = [];
  let pending: { piece: string; restyle: boolean } | null = null;
  let intensity: Layer = 2;
  const layerOffUntil = [0, 0, 0, 0];
  let voices: number[] = [];
  const played: Partial<Record<Role, number>> = {};
  const dropped: Partial<Record<Role, number>> = {};
  let filtered = false;
  let ducked = false;
  let pieces = 0;
  /** The Ensayo's direction: a piece and an intensity held whatever the scene says. */
  let forced: { piece: string | null; intensity: Layer | null } = { piece: null, intensity: null };
  /** The Ensayo's levels, over the style's. */
  const mixOver = new Map<Role, number>();
  const mixOf = (role: Role) => mixOver.get(role) ?? style.mix[role];

  // The menu's playlist: its pieces in an order of their own, never the same one twice in a row.
  const menu = COMPOSITIONS.filter((c) => c.group === 'menu').map((c) => c.id);
  const shuffle = seeded(seedOf(session, 'menu'));
  const order = [...menu].sort(() => shuffle() - 0.5);
  let menuAt = 0;
  const nextMenu = (after: string | null) => {
    let id = order[menuAt % order.length]!;
    menuAt++;
    if (id === after) {
      id = order[menuAt % order.length]!;
      menuAt++;
    }
    return id;
  };

  function pieceFor(s: MusicScene): string {
    if (forced.piece) return forced.piece;
    if (s.kind === 'results') return 'resultados';
    if (s.kind === 'menu') return current && current.comp.group === 'menu' ? current.comp.id : (pending?.piece && menu.includes(pending.piece) ? pending.piece : nextMenu(null));
    if (s.boss) return s.boss.deep ? 'nucleo-profundo' : s.boss.form === 2 ? 'nucleo-2' : 'nucleo-1';
    return SECTOR_PIECE(s.biome);
  }

  function intensityFor(s: MusicScene, group: Composition['group'] | undefined): Layer {
    if (forced.intensity !== null) return forced.intensity;
    if (s.kind === 'menu') return 2;
    if (s.kind === 'results') return 1;
    return group === 'boss' ? (Math.max(2, s.intensity) as Layer) : s.intensity;
  }

  function newPlayer(comp: Composition, at: number, fadeIn: boolean): Player {
    const stepDur = 60 / (comp.bpm * style.tempo) / 4;
    const gain = ctx.createGain();
    if (fadeIn) fade(gain.gain, 0, 1, at, FADE_IN);
    else gain.gain.value = 1;
    gain.connect(input);
    const want = intensityFor(scene, comp.group);
    const layers = [0, 1, 2, 3].map((l) => {
      const g = ctx.createGain();
      g.gain.value = l <= want ? 1 : 0;
      g.connect(gain);
      return g;
    });
    const roles = new Map<Role, GainNode>();
    for (const [role, layer] of Object.entries(style.arrangement[comp.group]) as [Role, Layer][]) {
      const g = ctx.createGain();
      g.gain.value = mixOf(role);
      g.connect(layers[layer]!);
      roles.set(role, g);
    }
    // Glided, so the echo's tail never clicks.
    delay.delayTime.setTargetAtTime(Math.min(1.9, style.fx.delayBeats * stepDur * 4), at, 0.2);
    pieces++;
    const p: Player = { comp, style, planner: createPlanner(comp, style, seedOf(session, comp.id, pieces)), gain, layers, roles, bar: 0, step: 0, stepAt: at, stepDur, byStep: [], startedAt: at, until: null, file: null };
    const files = opts.library?.piece(choice, comp.id);
    if (files) {
      const file = { score: null as Score | null, layers: files.layers.length, failed: false };
      p.file = file;
      Promise.all(files.layers.map((u) => load(u))).then(
        (buffers) => {
          if (p.until !== null || p !== current || !playing) return;
          file.score = createScore(ctx, gain, buffers);
          const when = Math.max(ctx.currentTime + 0.05, at);
          file.score.start(when);
          file.score.level(Math.min(intensity, file.layers - 1) as Layer, when, 0.01);
        },
        () => {
          file.failed = true;
        },
      );
    }
    return p;
  }

  /** Whether a player's notes are generated (no file, or its file failed). */
  const generated = (p: Player) => !p.file || p.file.failed;

  function setLayers(target: Layer, at: number) {
    if (target === intensity) return;
    for (let l = 0; l < 4; l++) {
      const was = l <= intensity;
      const now = l <= target;
      if (was === now) continue;
      if (!now) layerOffUntil[l] = at + LAYER_FADE + 0.1;
      for (const p of [current, ...fading]) if (p) ramp(p.layers[l]!.gain, now ? 1 : 0, at, LAYER_FADE);
    }
    intensity = target;
    current?.file?.score?.level(Math.min(target, current.file.layers - 1) as Layer, at, LAYER_FADE);
  }

  function play(p: Player, e: NoteEvent, time: number) {
    const layer = p.style.arrangement[p.comp.group][e.role];
    if (layer === undefined) return;
    if (layer > intensity && !(time < layerOffUntil[layer]!)) return;
    const out = p.roles.get(e.role);
    if (!out) return;
    if (voices.length >= cap) {
      dropped[e.role] = (dropped[e.role] ?? 0) + 1;
      return;
    }
    const dur = e.len * p.stepDur;
    VOICES[p.style.voices[e.role]](ctx, out, { midi: e.midi, at: time, dur, vel: e.vel }, { bright: p.comp.color.bright, texture: p.style.texture ?? p.comp.color.texture, seed: seedOf(session, p.comp.id, p.bar, e.at, e.role) });
    // A voice is busy while its note is held; its release fades on its own.
    voices.push(time + Math.max(dur, 0.25));
    played[e.role] = (played[e.role] ?? 0) + 1;
  }

  /** One sixteenth of a player; at a bar line, the change of piece (or the menu's next) happens here. */
  function step(p: Player) {
    if (p.step === 0) {
      if (p === current) {
        const where = p.planner.where(p.bar);
        if (!pending && p.comp.group === 'menu' && where.loop >= 1) pending = { piece: nextMenu(p.comp.id), restyle: false };
        if (pending && (pending.piece !== p.comp.id || pending.restyle)) {
          const comp = COMPOSITIONS.find((c) => c.id === pending!.piece)!;
          pending = null;
          p.until = p.stepAt + CROSSFADE;
          ramp(p.gain.gain, 0, p.stepAt, CROSSFADE);
          p.file?.score?.stop(p.stepAt + CROSSFADE, 0.05);
          fading.push(p);
          current = newPlayer(comp, p.stepAt, true);
          setLayers(intensityFor(scene, comp.group), p.stepAt);
        }
        pending = null;
      }
      const plan = p.planner.bar(p.bar);
      p.byStep = Array.from({ length: 16 }, () => []);
      for (const e of plan.events) p.byStep[Math.floor(e.at)]?.push(e);
      for (const list of p.byStep) list.sort((a, b) => (PRIORITY.get(a.role) ?? 99) - (PRIORITY.get(b.role) ?? 99));
    }
    const time = p.stepAt + (p.step % 2 === 1 ? p.style.swing * p.stepDur : 0);
    // A step already past (the page was busy, the tab hidden) is skipped: its notes would all sound at once.
    const late = time < ctx.currentTime - 0.02;
    if (!late && (p.until === null || time < p.until) && generated(p)) for (const e of p.byStep[p.step] ?? []) play(p, e, time);
    p.step++;
    p.stepAt += p.stepDur;
    if (p.step === 16) {
      p.step = 0;
      p.bar++;
    }
  }

  function tick() {
    if (!playing) return;
    const now = ctx.currentTime;
    voices = voices.filter((end) => end > now);
    // The new piece starts inside `step` of the old one, so walk the current one first.
    for (let guard = 0; current && current.stepAt < now + lookahead && guard < 64; guard++) step(current);
    for (const p of fading) for (let guard = 0; p.stepAt < now + lookahead && p.until !== null && p.stepAt < p.until && guard < 64; guard++) step(p);
    fading = fading.filter((p) => {
      if (p.until !== null && now > p.until + 3) {
        p.gain.disconnect();
        return false;
      }
      return true;
    });
  }

  return {
    setScene(next: MusicScene) {
      const at = ctx.currentTime;
      scene = next;
      const piece = pieceFor(next);
      if (!current) pending = { piece, restyle: false };
      else if (piece !== current.comp.id) pending = { piece, restyle: false };
      else if (pending && pending.piece !== piece) pending = null;
      const group = COMPOSITIONS.find((c) => c.id === piece)!.group;
      if (current && piece === current.comp.id) setLayers(intensityFor(next, group), at);
      const dim = next.kind === 'run' && next.choosing;
      if (dim !== filtered) {
        filtered = dim;
        ramp(tone.frequency, dim ? 900 : style.fx.tone, at, 0.4);
      }
      const duck = next.kind === 'run' && next.paused;
      if (duck !== ducked) {
        ducked = duck;
        if (playing) ramp(level.gain, duck ? 0.35 : 1, at, 0.5);
      }
    },
    /** The music Ensayo: an instrument's level (0–1), now and for the pieces to come. */
    setMix(role: Role, value: number) {
      const v = Math.max(0, Math.min(1, value));
      mixOver.set(role, v);
      for (const p of [current, ...fading]) {
        const g = p?.roles.get(role);
        if (g) ramp(g.gain, v, ctx.currentTime, 0.1);
      }
    },
    /** How far ahead to schedule: more while the tab is hidden (its timers run once a second). */
    setLookahead(seconds: number) {
      lookahead = Math.max(0.05, seconds);
    },
    /** The music Ensayo: hold a piece and an intensity (null lets the scene decide again). */
    direct(next: { piece?: string | null; intensity?: Layer | null }) {
      forced = { piece: next.piece === undefined ? forced.piece : next.piece, intensity: next.intensity === undefined ? forced.intensity : next.intensity };
      this.setScene(scene);
    },
    /** A style, or «Mi música»: the current piece plays again in it from the next bar. */
    setChoice(next: MusicChoice) {
      if (next === choice) return;
      choice = next;
      style = styleOf(next);
      dress(style);
      if (current) pending = { piece: current.comp.id, restyle: true };
    },
    start() {
      if (playing) return;
      playing = true;
      const at = ctx.currentTime + 0.05;
      ramp(level.gain, ducked ? 0.35 : 1, at, 1.2);
      if (!current) {
        const piece = pending?.piece ?? pieceFor(scene);
        pending = null;
        const comp = COMPOSITIONS.find((c) => c.id === piece)!;
        intensity = intensityFor(scene, comp.group);
        current = newPlayer(comp, at, false);
      }
    },
    stop() {
      if (!playing) return;
      playing = false;
      const at = ctx.currentTime;
      ramp(level.gain, 0, at, 0.6);
      // Their notes already scheduled fade with the level; the players go once it is silent.
      const gone = [current, ...fading];
      for (const p of gone) p?.file?.score?.stop(at, 0.6);
      setTimeout(() => {
        for (const p of gone) p?.gain.disconnect();
      }, 1000);
      current = null;
      fading = [];
      voices = [];
    },
    tick,
    /** A short phrase in the piece's key: extraction (rising), death (falling), a new layer (bright). */
    stinger(kind: StingerKind) {
      if (!playing || !current) return;
      const p = current;
      const at = p.stepAt;
      const degrees = kind === 'extract' ? [0, 2, 4, 7, 9] : kind === 'death' ? [4, 3, 2, 0] : [0, 4, 7];
      const gap = kind === 'death' ? 0.28 : 0.12;
      const voice = VOICES[kind === 'death' ? 'flute' : 'bells'];
      degrees.forEach((d, i) => {
        const midi = degreeMidi(p.comp.tonic, p.comp.mode, d) + (kind === 'death' ? 12 : 24);
        voices.push(voice(ctx, stingers, { midi, at: at + i * gap, dur: kind === 'death' ? 0.5 : 0.35, vel: 0.8 }, { bright: p.comp.color.bright, texture: 'space', seed: 1 }));
      });
    },
    state(): EngineState {
      const where = current ? current.planner.where(Math.max(0, current.bar - (current.step === 0 ? 1 : 0))) : null;
      return {
        playing,
        piece: current?.comp.id ?? null,
        style: style.id,
        choice,
        source: current && !generated(current) ? 'file' : 'generated',
        startedAt: current?.startedAt ?? 0,
        bar: current?.bar ?? 0,
        loop: where?.loop ?? 0,
        section: where?.section ?? '',
        intensity,
        voices: voices.filter((end) => end > ctx.currentTime).length,
        played: { ...played },
        dropped: { ...dropped },
        filtered,
        ducked,
        seed: session,
        mix: Object.fromEntries((Object.keys(style.mix) as Role[]).map((r) => [r, mixOf(r)])) as Record<Role, number>,
      };
    },
    dispose() {
      level.disconnect();
    },
  };
}

export type MusicEngine = ReturnType<typeof createEngine>;
