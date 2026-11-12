// A bank of sounds that may come from files (plan «escáner pro», part B; the owner: «dejando listos los
// placeholders/rutas de audio para que yo solo tenga que meter mis archivos»). Each sound has a synthesised recipe, so
// everything plays with no files at all; when a file with its name exists, it is fetched once (same origin, which
// the CSP allows), decoded and played instead. Files are found when the app is built (`import.meta.glob`), so a
// missing one is simply not in the map — the server would answer an unknown path with the page, not a 404.

/** Plays a synthesised sound at `at` (audio-context seconds) into `out`. */
export type Recipe<O> = (ctx: BaseAudioContext, out: AudioNode, at: number, opts: O) => void;

export interface BankSound<O> {
  /** The file's name without its extension (`impacto`), or one per option (`revelar-rara`). */
  file: string | ((opts: O) => string);
  /** The file's level (synthesised recipes carry their own). */
  gain?: number;
  /** For sounds that last as long as asked (`opts.dur`): the file fades out by then. */
  fit?: boolean;
  synth: Recipe<O>;
}

export interface Bank<Id extends string, O> {
  /** Starts fetching and decoding the files there are for these sounds (the rest stay synthesised). */
  preload(ids: readonly Id[], opts?: readonly O[]): Promise<void>;
  /** Plays a sound at `at`: its decoded file when it is ready, else its recipe. */
  play(id: Id, at: number, out: AudioNode, opts: O): void;
  /** Whether a file plays for this sound (the Ensayo shows which). */
  fromFile(id: Id, opts: O): boolean;
}

export type AudioFormat = 'ogg' | 'm4a';

/** Opus in Ogg where the browser plays it (Chrome, Firefox, recent Safari), else AAC in M4A. */
export function pickFormat(canPlay: (type: string) => string): AudioFormat {
  return canPlay('audio/ogg; codecs=opus') ? 'ogg' : 'm4a';
}

/** `{ name: { ogg?: url, m4a?: url } }` from the URLs `import.meta.glob` found (keys end in `/<name>.<ext>`). */
export function filesByName(found: Readonly<Record<string, string>>): Record<string, Partial<Record<AudioFormat, string>>> {
  const out: Record<string, Partial<Record<AudioFormat, string>>> = {};
  for (const [path, url] of Object.entries(found)) {
    const m = /([^/\\]+)\.(ogg|m4a)$/i.exec(path);
    if (!m) continue;
    const name = m[1]!.toLowerCase();
    (out[name] ??= {})[m[2]!.toLowerCase() as AudioFormat] = url;
  }
  return out;
}

export function createBank<Id extends string, O extends { dur?: number }>(
  ctx: BaseAudioContext,
  sounds: Readonly<Record<Id, BankSound<O>>>,
  files: Readonly<Record<string, Partial<Record<AudioFormat, string>>>>,
  deps: { format: AudioFormat; fetch?: typeof fetch } = { format: 'ogg' },
): Bank<Id, O> {
  const buffers = new Map<string, AudioBuffer>();
  const loading = new Map<string, Promise<void>>();
  const get = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const nameOf = (id: Id, opts: O) => {
    const f = sounds[id].file;
    return typeof f === 'function' ? f(opts) : f;
  };
  const urlOf = (name: string) => {
    const options = files[name];
    return options?.[deps.format] ?? options?.ogg ?? options?.m4a ?? null;
  };

  function load(name: string): Promise<void> {
    const url = urlOf(name);
    if (!url || buffers.has(name)) return Promise.resolve();
    let p = loading.get(name);
    if (!p) {
      p = (async () => {
        try {
          const res = await get(url);
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          buffers.set(name, await ctx.decodeAudioData(data));
        } catch {
          // A file that does not fetch or decode: its recipe keeps playing.
        }
      })();
      loading.set(name, p);
    }
    return p;
  }

  return {
    async preload(ids, opts = [{} as O]) {
      const names = new Set<string>();
      for (const id of ids) for (const o of opts) names.add(nameOf(id, o));
      await Promise.all([...names].map(load));
    },
    play(id, at, out, opts) {
      const sound = sounds[id];
      const buffer = buffers.get(nameOf(id, opts));
      if (!buffer) {
        sound.synth(ctx, out, at, opts);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      const level = sound.gain ?? 1;
      g.gain.setValueAtTime(level, at);
      src.connect(g).connect(out);
      src.start(at);
      if (sound.fit && opts.dur && opts.dur < buffer.duration) {
        const end = at + opts.dur;
        g.gain.setValueAtTime(level, Math.max(at, end - 0.12));
        g.gain.linearRampToValueAtTime(0.0001, end);
        src.stop(end + 0.02);
      }
    },
    fromFile(id, opts) {
      return buffers.has(nameOf(id, opts));
    },
  };
}
