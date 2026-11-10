import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SHOTS, WORDS } from './edit';
import { Caption, Clip, Flash, Fonts, Logo, Slam, Stars, Vignette } from './parts';
import { BEAT_FRAMES, C, fr, MUSIC_SECONDS, PLAY_URL, SANS } from './theme';

// The vertical cut for short-video feeds (1080×1920): the climax of the music (bar 39 on) with its words, and the
// logo with where to play. The clips are cropped to the centre, where the probe always is.

const FROM = 39;
const BAR = BEAT_FRAMES * 4;

function OutroVertical() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 150, mass: 0.8 } });
  const cta = spring({ frame: frame - BAR * 0.75, fps, config: { damping: 14, stiffness: 160 } });
  const fade = interpolate(frame, [durationInFrames - 50, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Stars seed={11} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 60 }}>
        <div style={{ transform: `scale(${1.5 - 0.5 * s})`, opacity: Math.min(1, s * 2) }}>
          <Logo scale={0.66} />
        </div>
        <div style={{ opacity: cta, textAlign: 'center' }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 58, color: C.ice }}>Juega gratis</div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 58, color: C.ice }}>en tu navegador</div>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 40, color: '#9aa1d8', marginTop: 16 }}>{PLAY_URL}</div>
        </div>
      </AbsoluteFill>
      <Flash frames={22} peak={0.7} />
    </AbsoluteFill>
  );
}

export function TrailerVertical() {
  const offset = fr(FROM);
  const end = Math.round(MUSIC_SECONDS * 60) - offset;
  const at = (bar: number) => fr(bar) - offset;
  return (
    <AbsoluteFill style={{ background: C.void }}>
      <Fonts />
      <Audio src={staticFile('music.wav')} startFrom={offset} />
      {SHOTS.filter((s) => s.from >= FROM).map((s, i) => (
        <Sequence key={i} from={at(s.from)} durationInFrames={fr(s.to) - fr(s.from)}>
          <Clip name={s.clip} start={s.start} rate={s.rate} zoom={[s.zoom?.[0] ?? 1, s.zoom?.[1] ?? 1]} punch={s.punch} />
          <Vignette />
          {s.cap ? <Caption top={s.cap[0]} bottom={s.cap[1]} at="mid" size={92} /> : null}
        </Sequence>
      ))}
      {WORDS.map((w) => (
        <Sequence key={w.bar} from={at(w.bar)} durationInFrames={Math.round(BAR * 1.5)}>
          <Slam word={w.word} color={w.color} size={150} />
        </Sequence>
      ))}
      <Sequence from={0} durationInFrames={22}>
        <Flash frames={22} />
      </Sequence>
      <Sequence from={at(48)} durationInFrames={end - at(48)}>
        <OutroVertical />
      </Sequence>
    </AbsoluteFill>
  );
}
