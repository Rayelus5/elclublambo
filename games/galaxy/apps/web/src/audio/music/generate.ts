import { type Composition, formBars } from './compositions';
import { pick, seeded, seedOf } from './rng';
import type { Role, Style } from './styles';
import { chordOf, type ChordExt, degreeMidi, voiceLead } from './theory';

// The soundtrack's generator (plan «banda sonora», part A): it turns a composition, played in a style, into bars of
// notes. Pure and seeded: the same piece and seed always give the same notes, so the music can be tested and directed.
// What keeps it from repeating: each loop takes a form by its seed (A A B A, A B A B…), chords gain colour (add9,
// sevenths) on later loops, the motif is varied each phrase (as it is, moved to the chord, mirrored, thinned out,
// ornamented), the arpeggio and the drums are humanised, and each section ends with a fill or a passing note. The
// melody always lands on a chord tone on the strong beats; every melodic note is in the key.

export interface NoteEvent {
  role: Role;
  /** Sixteenths from the start of the bar (0–15). */
  at: number;
  /** Sixteenths; may run past the bar (a pad holds its chord). */
  len: number;
  midi: number;
  /** 0–1. */
  vel: number;
}

export interface BarPlan {
  bar: number;
  loop: number;
  section: string;
  sectionBar: number;
  /** The chord as voiced (its pad), low to high. */
  chord: number[];
  /** Its root in the bass's register. */
  root: number;
  events: NoteEvent[];
}

interface Spot {
  loop: number;
  section: string;
  sectionBar: number;
  sectionBars: number;
  chordIndex: number;
  chordStart: boolean;
  chordBars: number;
  degree: number;
  ext: ChordExt;
  nextDegree: number;
}

/** Into [lo, lo + 12): a note's octave moved. */
const within = (midi: number, lo: number) => lo + ((((midi - lo) % 12) + 12) % 12);
/** The note of pitch class `pc` nearest to `target`. */
const nearestPc = (pc: number, target: number) => {
  const below = target - ((((target - pc) % 12) + 12) % 12);
  return target - below > 6 ? below + 12 : below;
};

type Variation = 'same' | 'chord' | 'mirror' | 'sparse' | 'ornament';
const VARIATIONS: readonly Variation[] = ['same', 'chord', 'mirror', 'sparse', 'ornament'];

export function createPlanner(comp: Composition, style: Style, seed: number) {
  const loops: { form: string[]; start: number; length: number }[] = [];
  const formOf = (loop: number) => (loop === 0 || comp.forms.length === 1 ? comp.forms[0]! : pick(seeded(seedOf(seed, comp.id, 'form', loop)), comp.forms));
  const loopAt = (bar: number) => {
    while (loops.length === 0 || loops[loops.length - 1]!.start + loops[loops.length - 1]!.length <= bar) {
      const last = loops[loops.length - 1];
      const form = formOf(loops.length);
      loops.push({ form, start: last ? last.start + last.length : 0, length: formBars(comp, form) });
    }
    let i = loops.length - 1;
    while (loops[i]!.start > bar) i--;
    return { index: i, ...loops[i]! };
  };

  function spotOf(bar: number): Spot {
    const lp = loopAt(bar);
    let into = bar - lp.start;
    for (let s = 0; s < lp.form.length; s++) {
      const name = lp.form[s]!;
      const chords = comp.sections[name]!;
      const len = chords.reduce((n, ch) => n + ch.bars, 0);
      if (into < len) {
        let pos = 0;
        for (let k = 0; k < chords.length; k++) {
          const ch = chords[k]!;
          if (into < pos + ch.bars) {
            const nextChord = chords[k + 1] ?? comp.sections[lp.form[s + 1] ?? lp.form[0]!]![0]!;
            // Later loops colour the plain triads (from the scale, so always in the key).
            const r = seeded(seedOf(seed, comp.id, 'ext', lp.index, s, k))();
            const ext: ChordExt = lp.index > 0 && ch.ext === 'triad' ? (r < 0.3 ? 'add9' : r < 0.45 ? '7' : 'triad') : ch.ext;
            return { loop: lp.index, section: name, sectionBar: into, sectionBars: len, chordIndex: k, chordStart: into === pos, chordBars: ch.bars, degree: ch.degree, ext, nextDegree: nextChord.degree };
          }
          pos += ch.bars;
        }
      }
      into -= len;
    }
    throw new Error(`bar ${bar} outside its loop`);
  }

  // The chords' voicing carries from one to the next, so the planner walks the bars in order (and starts again for a
  // bar behind it: the Ensayo jumping back).
  let next = 0;
  let voiced: number[] | null = null;
  const cache = new Map<number, BarPlan>();

  function plan(bar: number): BarPlan {
    const at = spotOf(bar);
    const chordNotes = chordOf(comp.tonic, comp.mode, at.degree, at.ext);
    if (at.chordStart || !voiced) voiced = voiceLead(chordNotes, voiced, style.center.pad);
    const chord = [...voiced].sort((a, b) => a - b);
    const root = within(chordNotes[0]!, 36);
    const roles = style.arrangement[comp.group];
    const rand = seeded(seedOf(seed, comp.id, 'bar', bar));
    const events: NoteEvent[] = [];
    const add = (role: Role, atStep: number, len: number, midi: number, vel: number) => {
      if (roles[role] === undefined) return;
      events.push({ role, at: atStep, len, midi, vel: Math.min(1, Math.max(0.05, vel)) });
    };
    const lastBarOfSection = at.sectionBar === at.sectionBars - 1;
    const sixteenths = 16 * at.chordBars;

    // The bed: the chord held (pad and, where it plays, the choir), and the texture.
    if (at.chordStart) {
      for (const n of chord) add('pad', 0, sixteenths, n, 0.55);
      for (const n of voiceLead(chordNotes, null, style.center.choir)) add('choir', 0, sixteenths, n, 0.5);
    }
    add('texture', 0, 16, comp.tonic, 0.5);

    // The bass: long notes when calm, a pulse with drive; a passing note into the next chord at a section's end.
    const pattern = comp.group === 'boss' || comp.color.drive >= 0.5 ? style.bass.drive : style.bass.calm;
    const hits = [...pattern].map((ch, i) => ({ ch, i })).filter((x) => x.ch !== '.');
    hits.forEach(({ ch, i }, k) => {
      const end = hits[k + 1]?.i ?? 16;
      const step = ch === '5' ? 4 : ch === '3' ? 2 : 0;
      const midi = degreeMidi(comp.tonic, comp.mode, at.degree + step) - comp.tonic + root - (degreeMidi(comp.tonic, comp.mode, at.degree) - comp.tonic) + (ch === '8' ? 12 : 0);
      add('bass', i, Math.max(1, end - i), midi, 0.8 - (k % 2) * 0.15);
    });
    if (lastBarOfSection && roles.bass !== undefined) {
      const toward = at.nextDegree > at.degree ? 1 : -1;
      const passing = within(degreeMidi(comp.tonic, comp.mode, at.nextDegree - toward), root - 2);
      add('bass', 14, 2, passing, 0.6);
    }

    // The arpeggio: chord tones, low to high, some left out (it breathes).
    const tones = voiceLead(chordNotes, null, style.center.arp).sort((a, b) => a - b);
    const up = [...tones, ...tones.map((n) => n + 12)];
    [...style.arp.pattern].forEach((ch, i) => {
      if (ch === '.' || rand() > style.arp.chance) return;
      add('arp', i, 2, up[Number(ch) % up.length]!, i % 4 === 0 ? 0.7 : 0.5);
    });

    // The keys: the chord on the pattern's hits.
    [...style.keys].forEach((ch, i) => {
      if (ch === '.') return;
      for (const n of voiceLead(chordNotes, null, style.center.keys)) add('keys', i, 3, n, ch === 'x' ? 0.6 : 0.4);
    });

    // The melody: the motif, varied by phrase; the lead and the bells take turns (in the menu, call and answer).
    const phrase = Math.floor(at.sectionBar / 2);
    const half = at.sectionBar % 2;
    const prand = seeded(seedOf(seed, comp.id, 'phrase', at.loop, at.section, phrase));
    const variation: Variation = at.loop === 0 && phrase === 0 ? 'same' : pick(prand, VARIATIONS);
    const melody = phraseNotes(comp, variation, prand, at.degree);
    const singer: Role = comp.group === 'menu' ? (phrase % 2 === 0 ? 'lead' : 'bells') : comp.group === 'results' ? 'bells' : 'lead';
    for (const n of melody) {
      const local = n.at - half * 16;
      if (local < 0 || local >= 16) continue;
      let midi = nearestPc(((n.midi % 12) + 12) % 12, singer === 'bells' ? style.center.bells : style.center.lead);
      // On the strong beats the melody lands on the chord.
      if (local % 8 === 0) midi = nearestToChord(midi, chordNotes);
      add(singer, local, n.len, midi, n.vel);
      // In a sector, the bells shadow the long notes an octave up while it is calm.
      if (comp.group === 'sector' && n.len >= 4) add('bells', local, n.len, nearestPc(midi % 12, style.center.bells), n.vel * 0.7);
    }

    // The drums, with a fill at the end of each section.
    const kit = comp.group === 'boss' ? style.drums.boss : comp.group === 'menu' ? style.drums.menu : style.drums.sector;
    const drum = (role: Role, p: string) =>
      [...p].forEach((ch, i) => {
        if (ch === '.') return;
        add(role, i, 1, 36, (ch === 'x' ? 0.9 : 0.5) * (0.88 + rand() * 0.24));
      });
    drum('kick', kit.kick);
    drum('snare', kit.snare);
    drum('hat', kit.hat);
    drum('shaker', kit.shaker);
    drum('tom', kit.tom);
    if (lastBarOfSection) for (const i of pick(rand, [[12, 13, 15], [12, 14, 15], [13, 14, 15]])) add('tom', i, 1, 36, 0.75);

    // The Núcleo's own: timpani on the root, brass stabs on the chord.
    [...style.boss.timpani].forEach((ch, i) => ch !== '.' && add('timpani', i, 4, root, 0.85));
    [...style.boss.brass].forEach((ch, i) => {
      if (ch === '.') return;
      for (const n of voiceLead(chordNotes, null, style.center.brass)) add('brass', i, 3, n, 0.7);
    });

    return { bar, loop: at.loop, section: at.section, sectionBar: at.sectionBar, chord, root, events };
  }

  return {
    /** The notes of a bar (from the start of the piece). */
    bar(n: number): BarPlan {
      const hit = cache.get(n);
      if (hit) return hit;
      if (n < next) {
        next = 0;
        voiced = null;
        cache.clear();
      }
      let result: BarPlan | null = null;
      while (next <= n) {
        result = plan(next);
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
        cache.set(next, result);
        next++;
      }
      return result!;
    },
    /** Which loop and section a bar is in. */
    where(n: number) {
      const at = spotOf(n);
      return { loop: at.loop, section: at.section, sectionBar: at.sectionBar, sectionBars: at.sectionBars };
    },
  };
}

export type Planner = ReturnType<typeof createPlanner>;

function nearestToChord(midi: number, chord: readonly number[]): number {
  let best = midi;
  let dist = Infinity;
  for (const c of chord) {
    const n = nearestPc(((c % 12) + 12) % 12, midi);
    if (Math.abs(n - midi) < dist) {
      dist = Math.abs(n - midi);
      best = n;
    }
  }
  return best;
}

/** The motif over two bars, varied: as it is, moved onto the chord, mirrored, thinned out or ornamented. */
function phraseNotes(comp: Composition, variation: Variation, rand: () => number, chordDegree: number) {
  const out: { at: number; len: number; midi: number; vel: number }[] = [];
  const first = comp.motif.notes.find((n) => n !== null) ?? 0;
  let t = 0;
  comp.motif.notes.forEach((deg, i) => {
    const len = comp.motif.steps[i]!;
    const at = t;
    t += len;
    if (deg === null) return;
    if (variation === 'sparse' && i % 2 === 1 && rand() < 0.6) return;
    let d = deg;
    if (variation === 'chord') d = deg + chordDegree;
    if (variation === 'mirror') d = first - (deg - first);
    const midi = degreeMidi(comp.tonic, comp.mode, d);
    if (variation === 'ornament' && len >= 4 && rand() < 0.5) {
      // A neighbour note just before it (in the scale).
      out.push({ at, len: 1, midi: degreeMidi(comp.tonic, comp.mode, d + 1), vel: 0.45 });
      out.push({ at: at + 1, len: len - 1, midi, vel: 0.7 });
      return;
    }
    out.push({ at, len, midi, vel: at % 8 === 0 ? 0.75 : 0.62 });
  });
  return out;
}
