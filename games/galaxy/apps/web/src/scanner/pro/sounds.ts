import { createBank, filesByName, pickFormat, type Bank } from '../../audio/bank';
import { audioBus } from '../../audio/mixer';
import { synthStems } from '../../audio/stems-synth';
import { type CueOpts, PRO_SOUNDS, type ProSound } from './cues';

// Where the pro scanner's sounds come from (plan «escáner pro», part B): the files in `src/assets/audio/escaner/`
// (found when the app is built, hashed and cached for a year; see its LEEME.md) and, for anything missing, the
// synthesised recipes. One bank per audio context, shared by the shell (the bands closing) and the cinema.

const FOUND = import.meta.glob('../../assets/audio/escaner/*.{ogg,m4a}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** The audio files there are, by name. */
export const PRO_FILES = filesByName(FOUND);

/** The music's four layers as files (all four, or the synthesised ones are used). */
export const MUSIC_FILES = ['musica-base', 'musica-rara', 'musica-epica', 'musica-legendaria'] as const;

function canPlay(type: string): string {
  try {
    return document.createElement('audio').canPlayType(type);
  } catch {
    return '';
  }
}

export interface ProAudio {
  ctx: AudioContext;
  sfx: GainNode;
  music: GainNode;
  bank: Bank<ProSound, CueOpts>;
}

let current: { ctx: AudioContext; bank: Bank<ProSound, CueOpts> } | null = null;

/** The shared context's buses and the bank (null without WebAudio). */
export function proAudio(): ProAudio | null {
  const bus = audioBus();
  if (!bus) return null;
  if (!current || current.ctx !== bus.ctx) current = { ctx: bus.ctx, bank: createBank(bus.ctx, PRO_SOUNDS, PRO_FILES, { format: pickFormat(canPlay) }) };
  return { ctx: bus.ctx, sfx: bus.sfx, music: bus.music, bank: current.bank };
}

/** The music's layers: the four files when they are all there, else the synthesised loop (null if neither works). */
export async function proStems(ctx: BaseAudioContext): Promise<AudioBuffer[] | null> {
  const format = pickFormat(canPlay);
  const urls = MUSIC_FILES.map((name) => PRO_FILES[name]?.[format] ?? PRO_FILES[name]?.ogg ?? PRO_FILES[name]?.m4a ?? null);
  if (urls.every((u): u is string => !!u)) {
    try {
      return await Promise.all(urls.map(async (url) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())));
    } catch {
      // A file that does not load: the synthesised layers instead.
    }
  }
  return synthStems(ctx.sampleRate);
}
