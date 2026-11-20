import { useEffect, useId, useRef, useState } from 'react';
import { audioBus } from '../audio/mixer';
import { COMPOSITIONS } from '../audio/music/compositions';
import { createEngine, type EngineState, type MusicEngine, type StingerKind } from '../audio/music/engine';
import { type Layer, MUSIC_STYLES, type MusicStyleId, type Role, STYLES } from '../audio/music/styles';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';

// The music Ensayo (plan «banda sonora», part A2; the owner directs the soundtrack as he did the scanner's cinema).
// It plays any piece in any style with its own engine (the game's music waits in the panel), holds an intensity,
// tries the level-up dim, the pause and the stingers, changes each instrument's level and the seed, says what is
// playing (piece, section, bar, loop, voices) and copies the settings as JSON to hand over.

const t = copy.admin.music;
const PIECES = COMPOSITIONS.map((c) => ({ value: c.id, label: `${c.name} (${t.groups[c.group]})` }));

function seedNow(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  } catch {
    return Math.floor(Date.now() % 2 ** 31);
  }
}

export function MusicRehearsal() {
  const ids = useId();
  const [style, setStyle] = useState<MusicStyleId>('ambient');
  const [piece, setPiece] = useState(PIECES[0]!.value);
  const [intensity, setIntensity] = useState<Layer>(2);
  const [choosing, setChoosing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seed, setSeed] = useState(seedNow);
  const [mix, setMix] = useState<Partial<Record<Role, number>>>({});
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState<EngineState | null>(null);
  const [copied, setCopied] = useState(false);
  const engine = useRef<MusicEngine | null>(null);

  const comp = COMPOSITIONS.find((c) => c.id === piece)!;
  const roles = Object.keys(STYLES[style].arrangement[comp.group]) as Role[];
  const levelOf = (r: Role) => mix[r] ?? STYLES[style].mix[r];

  // One engine per take (a new seed is a new take); the scene follows the controls.
  useEffect(() => {
    if (!playing) return;
    const bus = audioBus();
    if (!bus) return;
    const e = createEngine(bus.ctx, bus.music, { seed, choice: style });
    engine.current = e;
    e.setScene({ kind: 'run', biome: comp.biome ?? 'nebula', boss: null, intensity, choosing, paused });
    e.direct({ piece, intensity });
    for (const [r, v] of Object.entries(mix)) e.setMix(r as Role, v!);
    e.start();
    e.tick();
    const timer = setInterval(() => e.tick(), 25);
    const show = setInterval(() => setNow(e.state()), 250);
    return () => {
      clearInterval(timer);
      clearInterval(show);
      e.stop();
      setTimeout(() => e.dispose(), 1200);
      engine.current = null;
    };
    // The take restarts with a new seed or on play; the rest is directed live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, seed]);

  useEffect(() => engine.current?.setChoice(style), [style]);
  useEffect(() => engine.current?.direct({ piece, intensity }), [piece, intensity]);
  useEffect(() => engine.current?.setScene({ kind: 'run', biome: comp.biome ?? 'nebula', boss: null, intensity, choosing, paused }), [comp.biome, intensity, choosing, paused]);

  const stinger = (kind: StingerKind) => engine.current?.stinger(kind);
  const settings = JSON.stringify({ estilo: style, pieza: piece, intensidad: intensity, semilla: seed, mezcla: mix }, null, 2);

  return (
    <section className="admin-page rehearsal music-rehearsal">
      <h1>{t.title}</h1>
      <p className="panel-note">{t.intro}</p>
      <div className="lip panel rehearsal-panel">
        <div className="rehearsal-grid">
          <div className="rehearsal-field">
            <span id={`${ids}-style`}>{t.style}</span>
            <Segmented aria-labelledby={`${ids}-style`} value={style} options={MUSIC_STYLES.map((s) => ({ value: s, label: t.styles[s] }))} onChange={setStyle} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-piece`}>{t.piece}</span>
            <Select aria-labelledby={`${ids}-piece`} value={piece} options={PIECES} onChange={setPiece} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-intensity`}>{t.intensity}</span>
            <Segmented aria-labelledby={`${ids}-intensity`} value={String(intensity)} options={([0, 1, 2, 3] as const).map((i) => ({ value: String(i), label: t.intensities[i] }))} onChange={(v) => setIntensity(Number(v) as Layer)} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-choosing`}>{t.choosing}</span>
            <Switch aria-labelledby={`${ids}-choosing`} checked={choosing} onChange={setChoosing} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-paused`}>{t.paused}</span>
            <Switch aria-labelledby={`${ids}-paused`} checked={paused} onChange={setPaused} />
          </div>
        </div>
        <fieldset className="rehearsal-durations music-mixer" aria-label={t.mixer}>
          <legend>{t.mixer}</legend>
          <div className="music-mixer-grid">
            {roles.map((r) => (
              <div key={r} className="music-mixer-row">
                <span id={`${ids}-mix-${r}`}>{t.roles[r]}</span>
                <Slider
                  aria-labelledby={`${ids}-mix-${r}`}
                  value={Math.round(levelOf(r) * 100)}
                  step={1}
                  valueText={(v) => `${v} %`}
                  onChange={(v) => {
                    setMix((m) => ({ ...m, [r]: v / 100 }));
                    engine.current?.setMix(r, v / 100);
                  }}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="modal-actions rehearsal-actions">
          {(['layer', 'extract', 'death'] as const).map((k) => (
            <button key={k} type="button" className="lip pill small" disabled={!playing} onClick={() => stinger(k)}>
              {t.stingers[k]}
            </button>
          ))}
          <button type="button" className="lip pill" onClick={() => setSeed(seedNow())}>
            <Icon name="flip" />
            <span>{t.reseed}</span>
          </button>
          <button
            type="button"
            className="lip pill"
            onClick={() => {
              void navigator.clipboard?.writeText(settings).then(() => setCopied(true));
            }}
          >
            <Icon name="copy" />
            <span>{copied ? t.copied : t.copy}</span>
          </button>
          <button type="button" className="lip pill pill-solar" onClick={() => setPlaying((p) => !p)}>
            <Icon name={playing ? 'pause' : 'play'} />
            <span>{playing ? t.stop : t.play}</span>
          </button>
        </div>
        <p className="music-now" role="status" aria-label={t.now}>
          {playing && now?.piece
            ? t.playing(COMPOSITIONS.find((c) => c.id === now.piece)?.name ?? now.piece, t.styles[now.style], now.section, now.bar + 1, now.loop + 1, now.voices)
            : t.idle}
        </p>
      </div>
    </section>
  );
}
