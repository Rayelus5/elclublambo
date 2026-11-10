import { Composition } from 'remotion';
import { fr, MUSIC_SECONDS } from './theme';
import { Trailer } from './Trailer';
import { TrailerVertical } from './Vertical';

export function RemotionRoot() {
  const full = Math.round(MUSIC_SECONDS * 60);
  return (
    <>
      <Composition id="Trailer" component={Trailer} durationInFrames={full} fps={60} width={1920} height={1080} />
      <Composition id="TrailerVertical" component={TrailerVertical} durationInFrames={full - fr(39)} fps={60} width={1080} height={1920} />
    </>
  );
}
