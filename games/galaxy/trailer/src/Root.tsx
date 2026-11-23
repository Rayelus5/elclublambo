import { Composition } from 'remotion';
import { fr, MUSIC_SECONDS } from './theme';
import { NavidadBanner, NavidadDetalles, NavidadH, NavidadPremiosH, NavidadPremiosV, NavidadV } from './promo/Navidad';
import { RecompensasH, RecompensasV, T2H, T2V } from './promo/Temporada2';
import { GrupoH, GrupoV, PodioH, PodioV } from './promo/Torneo';
import { Trailer } from './Trailer';
import { TrailerVertical } from './Vertical';

export function RemotionRoot() {
  const full = Math.round(MUSIC_SECONDS * 60);
  return (
    <>
      <Composition id="Trailer" component={Trailer} durationInFrames={full} fps={60} width={1920} height={1080} />
      <Composition id="TrailerVertical" component={TrailerVertical} durationInFrames={full - fr(39)} fps={60} width={1080} height={1920} />
      {/* Weekend tournament stills (13–22 Nov 2026). */}
      <Composition id="TorneoPodioH" component={PodioH} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="TorneoGrupoH" component={GrupoH} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="TorneoPodioV" component={PodioV} durationInFrames={1} fps={60} width={1080} height={1920} />
      <Composition id="TorneoGrupoV" component={GrupoV} durationInFrames={1} fps={60} width={1080} height={1920} />
      {/* Season 2 stills (23 Nov – 31 Dec 2026). */}
      <Composition id="T2H" component={T2H} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="T2V" component={T2V} durationInFrames={1} fps={60} width={1080} height={1920} />
      <Composition id="T2RecompensasH" component={RecompensasH} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="T2RecompensasV" component={RecompensasV} durationInFrames={1} fps={60} width={1080} height={1920} />
      {/* «Torneo Navideño» stills (1–31 Dec 2026). */}
      <Composition id="NavidadH" component={NavidadH} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="NavidadV" component={NavidadV} durationInFrames={1} fps={60} width={1080} height={1920} />
      <Composition id="NavidadPremiosH" component={NavidadPremiosH} durationInFrames={1} fps={60} width={1920} height={1080} />
      <Composition id="NavidadPremiosV" component={NavidadPremiosV} durationInFrames={1} fps={60} width={1080} height={1920} />
      <Composition id="NavidadBanner" component={NavidadBanner} durationInFrames={1} fps={60} width={1600} height={600} />
      <Composition id="NavidadDetalles" component={NavidadDetalles} durationInFrames={1} fps={60} width={1600} height={900} />
    </>
  );
}
