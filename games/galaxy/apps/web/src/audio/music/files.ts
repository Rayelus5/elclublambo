import type { AudioFormat } from '../bank';
import { COMPOSITIONS } from './compositions';
import type { MusicStyleId } from './styles';

// The owner's own music (plan «banda sonora», part A): files in `src/assets/audio/musica/<estilo>/` named as a piece
// (`menu-deriva.ogg`) take that piece's place in that style — whole, or as layers (`-capa0` … `-capa3`) that follow
// the intensity like the generated ones. They are found when the app is built (hashed, cached for a year), so a missing
// file is simply not there and the generated piece plays (on this server an unknown path would answer the page, not a
// 404). `propia/` holds a style of its own, «Mi música», offered only when it has files. See its LEEME.md.

/** «Mi música»: the owner's own files, over the default style for whatever they leave out. */
export type MusicChoice = MusicStyleId | 'own';

/** Each style's folder (the styles still to come keep theirs, so files can wait for them). */
const FOLDERS: Readonly<Record<string, string>> = { ambient: 'ambiente', lofi: 'lofi', synthwave: 'synthwave', own: 'propia' };
const FOLDER_OF = (choice: MusicChoice): string => FOLDERS[choice] ?? choice;
const PIECES = new Set(COMPOSITIONS.map((c) => c.id));
const NAME = /musica\/([a-z0-9-]+)\/([a-z0-9-]+?)(?:-capa([0-3]))?\.(ogg|m4a)$/i;

export interface PieceFiles {
  /** Lowest layer first. */
  layers: string[];
}

export function musicLibrary(found: Readonly<Record<string, string>>, format: AudioFormat) {
  // folder → piece → layer → format → url
  const all = new Map<string, Map<string, Map<number, Partial<Record<AudioFormat, string>>>>>();
  let count = 0;
  for (const [path, url] of Object.entries(found)) {
    const hit = NAME.exec(path.replaceAll('\\', '/'));
    if (!hit) continue;
    const [, folder, piece, layer, ext] = hit;
    if (!PIECES.has(piece!.toLowerCase()) || !Object.values(FOLDERS).includes(folder!.toLowerCase())) continue;
    const byPiece = all.get(folder!.toLowerCase()) ?? new Map();
    all.set(folder!.toLowerCase(), byPiece);
    const byLayer = byPiece.get(piece!.toLowerCase()) ?? new Map();
    byPiece.set(piece!.toLowerCase(), byLayer);
    const formats = byLayer.get(Number(layer ?? 0)) ?? {};
    if (!formats.ogg && !formats.m4a) count++;
    formats[ext!.toLowerCase() as AudioFormat] = url;
    byLayer.set(Number(layer ?? 0), formats);
  }
  return {
    /** How many pieces and layers have a file. */
    count,
    /** Whether «Mi música» has anything. */
    hasOwn: (all.get('propia')?.size ?? 0) > 0,
    /** The files of a piece in a style, or null (it is generated). */
    piece(choice: MusicChoice, piece: string): PieceFiles | null {
      const byLayer = all.get(FOLDER_OF(choice))?.get(piece);
      if (!byLayer || byLayer.size === 0) return null;
      const layers = [...byLayer.entries()].sort((a, b) => a[0] - b[0]).map(([, f]) => f[format] ?? f.ogg ?? f.m4a!);
      return { layers };
    },
  };
}

export type MusicLibrary = ReturnType<typeof musicLibrary>;
