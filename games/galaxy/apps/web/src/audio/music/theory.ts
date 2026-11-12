// The soundtrack's music theory (plan «banda sonora», part A): MIDI notes, scales by mode, chords stacked in thirds
// from the scale (with the usual extensions and suspensions) and voicings that move each voice as little as possible
// from one chord to the next, which is what keeps a progression smooth and calm.

export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
} as const;
export type Mode = keyof typeof MODES;

export type ChordExt = 'triad' | '7' | '9' | 'add9' | 'sus2' | 'sus4' | '6';

/** A note's frequency (A4 = 69 = 440 Hz). */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** The MIDI note of a scale degree (0 the tonic; negative below it, 7 an octave up). */
export function degreeMidi(tonic: number, mode: Mode, degree: number): number {
  const scale = MODES[mode];
  const octave = Math.floor(degree / 7);
  const step = ((degree % 7) + 7) % 7;
  return tonic + octave * 12 + scale[step]!;
}

export function inScale(tonic: number, mode: Mode, midi: number): boolean {
  return (MODES[mode] as readonly number[]).includes((((midi - tonic) % 12) + 12) % 12);
}

/** A chord on a degree of the scale, root first. */
export function chordOf(tonic: number, mode: Mode, degree: number, ext: ChordExt): number[] {
  const at = (n: number) => degreeMidi(tonic, mode, degree + n);
  switch (ext) {
    case 'triad':
      return [at(0), at(2), at(4)];
    case '7':
      return [at(0), at(2), at(4), at(6)];
    case '9':
      return [at(0), at(2), at(4), at(6), at(8)];
    case 'add9':
      return [at(0), at(2), at(4), at(8)];
    case 'sus2':
      return [at(0), at(1), at(4)];
    case 'sus4':
      return [at(0), at(3), at(4)];
    case '6':
      return [at(0), at(2), at(4), at(5)];
  }
}

/**
 * The chord's notes placed near `center`, each voice as close as it can be to the last chord's (a calm voice leading).
 * Without a last chord, the closest voicing to the centre.
 */
export function voiceLead(chord: readonly number[], last: readonly number[] | null, center: number): number[] {
  const pcs = chord.map((n) => ((n % 12) + 12) % 12);
  const near = (pc: number, target: number) => {
    const base = target - ((((target - pc) % 12) + 12) % 12);
    return target - base > 6 ? base + 12 : base;
  };
  if (!last || last.length === 0) return pcs.map((pc) => near(pc, center)).sort((a, b) => a - b);
  const out: number[] = [];
  const used = new Set<number>();
  // Each voice of the last chord takes the nearest free note of the new one, kept within an octave of the centre.
  for (const prev of last) {
    let best = -1;
    let bestNote = 0;
    let bestDist = Infinity;
    pcs.forEach((pc, i) => {
      if (used.has(i) && used.size < pcs.length) return;
      let n = near(pc, prev);
      if (n - center > 9) n -= 12;
      if (center - n > 9) n += 12;
      const d = Math.abs(n - prev);
      if (d < bestDist) {
        bestDist = d;
        best = i;
        bestNote = n;
      }
    });
    used.add(best);
    out.push(bestNote);
  }
  // A chord with more notes than the last one: the rest near the centre.
  pcs.forEach((pc, i) => {
    if (!used.has(i)) out.push(near(pc, center));
  });
  return out;
}
