import { createBank, filesByName, pickFormat, type Bank } from '../../audio/bank';
import { audioBus } from '../../audio/mixer';
import { synthStems } from '../../audio/stems-synth';
import { type CueOpts, PRO_SOUNDS, type ProSound } from './cues';
import { synthMythicStem } from './mythic-stem';

// Where the pro scanner's sounds come from (plan «escáner pro», part B): the files in `src/assets/audio/escaner/`
// (found when the app is built, hashed and cached for a year; see its LEEME.md) and, for anything missing, the
// synthesised recipes. One bank per audio context, shared by the shell (the bands closing) and the cinema. The music
// has a fifth layer for a mythic (plan «rareza Mítica» M2), synthesised with the other four.

const FOUND = import.meta.glob('../../assets/audio/escaner/*.{ogg,m4a}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** The audio files there are, by name. */
export const PRO_FILES = filesByName(FOUND);

/** The music's four layers as files (all four, or the synthesised ones are used). */
export const MUSIC_FILES = ['musica-base', 'musica-rara', 'musica-epica', 'musica-legendaria'] as const;
/**
 * A mythic's own layer as a file, optional, played with the four files. Without it they play four layers: the
 * synthesised fifth is written over the synthesised loop's chords and would clash with someone else's music.
 */
export const MYTHIC_MUSIC_FILE = 'musica-mitica';

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

/**
 * The music's layers: the four files when they are all there (and the mythic's when it is too), else the synthesised
 * loop with the mythic's fifth layer (null if neither works).
 */
export async function proStems(ctx: BaseAudioContext): Promise<AudioBuffer[] | null> {
  const format = pickFormat(canPlay);
  const urlOf = (name: string) => PRO_FILES[name]?.[format] ?? PRO_FILES[name]?.ogg ?? PRO_FILES[name]?.m4a ?? null;
  const decode = async (url: string) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const urls = MUSIC_FILES.map(urlOf);
  if (urls.every((u): u is string => !!u)) {
    try {
      const layers = await Promise.all(urls.map(decode));
      const mythic = urlOf(MYTHIC_MUSIC_FILE);
      if (mythic) {
        try {
          layers.push(await decode(mythic));
        } catch {
          // Without it, a mythic plays the legendary's music.
        }
      }
      return layers;
    } catch {
      // A file that does not load: the synthesised layers instead.
    }
  }
  const [layers, mythic] = await Promise.all([synthStems(ctx.sampleRate), synthMythicStem(ctx.sampleRate)]);
  return layers && mythic ? [...layers, mythic] : layers;
}
