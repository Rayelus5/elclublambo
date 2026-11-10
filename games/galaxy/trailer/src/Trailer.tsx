import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SHOTS, WORDS } from './edit';
import { Caption, Clip, Flash, Fonts, Logo, Slam, Stars, Vignette } from './parts';
import { BEAT_FRAMES, BRAILLE_BRAND, C, fr, MUSIC_SECONDS, PLAY_URL, sec, SANS } from './theme';

// The full trailer (1920×1080, 60 fps, the music's length): the logo out of the braille, the incursions, the station,
// the scanner, the group, a climax cut on every other beat, and the logo with where to play.

const BAR = BEAT_FRAMES * 4;

/** The opening: the braille name decodes out of the dark, then the logo slams in on the first strong bar. */
function Intro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const slamAt = fr(1);
  const s = spring({ frame: frame - slamAt, fps, config: { damping: 12, stiffness: 160, mass: 0.8 } });
  const typed = Math.max(0, Math.min(BRAILLE_BRAND.length, Math.floor((frame / (slamAt * 0.85)) * BRAILLE_BRAND.length)));
  const tag = spring({ frame: frame - slamAt - BAR / 2, fps, config: { damping: 9, stiffness: 220 } });
  const starsIn = interpolate(frame, [0, slamAt], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <AbsoluteFill style={{ opacity: starsIn }}>
        <Stars />
      </AbsoluteFill>
      {frame < slamAt ? (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 120, letterSpacing: '0.12em', color: C.ice, textShadow: '0 0 30px rgba(150,205,255,.8)', fontFamily: "'Segoe UI Symbol', 'Noto Sans Symbols 2', sans-serif" }}>{BRAILLE_BRAND.slice(0, typed)}</div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ transform: `scale(${1.7 - 0.7 * s})`, opacity: Math.min(1, s * 2) }}>
            <Logo scale={1.05} tag={tag} />
          </div>
        </AbsoluteFill>
      )}
      <Sequence from={slamAt} durationInFrames={30}>
        <Flash frames={26} />
      </Sequence>
    </AbsoluteFill>
  );
}

/** The close: the logo again, and where to play. */
function Outro() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 150, mass: 0.8 } });
  const cta = spring({ frame: frame - BAR * 0.75, fps, config: { damping: 14, stiffness: 160 } });
  const fade = interpolate(frame, [durationInFrames - 50, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Stars seed={11} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 46 }}>
        <div style={{ transform: `scale(${1.5 - 0.5 * s})`, opacity: Math.min(1, s * 2) }}>
          <Logo scale={0.95} />
        </div>
        <div style={{ opacity: cta, transform: `translateY(${(1 - cta) * 30}px)`, textAlign: 'center' }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 54, color: C.ice }}>Juega gratis en tu navegador</div>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 38, color: '#9aa1d8', marginTop: 10, letterSpacing: '0.04em' }}>{PLAY_URL}</div>
        </div>
      </AbsoluteFill>
      <Flash frames={22} peak={0.7} />
    </AbsoluteFill>
  );
}

export function Trailer() {
  const end = Math.round(MUSIC_SECONDS * 60);
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Fonts />
      <Audio src={staticFile('music.wav')} />
      <Sequence from={0} durationInFrames={fr(3)}>
        <Intro />
      </Sequence>
      {SHOTS.map((s, i) => (
        <Sequence key={i} from={fr(s.from)} durationInFrames={fr(s.to) - fr(s.from)}>
          <Clip name={s.clip} start={s.start} rate={s.rate} zoom={s.zoom} pan={s.pan} punch={s.punch} dim={s.dim} />
          <Vignette />
          {s.cap ? <Caption top={s.cap[0]} bottom={s.cap[1]} at={s.capAt} size={s.capSize} side={s.capSide} /> : null}
          {s.flash ? <Flash color={s.flash} frames={18} peak={0.75} /> : null}
        </Sequence>
      ))}
      {WORDS.map((w) => (
        <Sequence key={w.bar} from={fr(w.bar)} durationInFrames={Math.round(BAR * 1.5)}>
          <Slam word={w.word} color={w.color} />
        </Sequence>
      ))}
      <Sequence from={fr(39)} durationInFrames={22}>
        <Flash frames={22} />
      </Sequence>
      <Sequence from={fr(48)} durationInFrames={end - fr(48)}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}

/** Seconds into the music where a bar starts (for the vertical cut). */
export const barSeconds = sec;
