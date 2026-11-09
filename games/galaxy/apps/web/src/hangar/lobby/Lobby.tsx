import type { HangarView } from '@galaxy/shared';
import type { BiomeId } from '@galaxy/sim';
import { type CSSProperties, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useGacha } from '../../api/economy';
import { useRooms } from '../../api/rooms';
import { BIOME_LOOK } from '../../arena/stage/biomes';
import { useMe } from '../../auth/useMe';
import { useGalaxyImage } from '../../cards/useGalaxyImage';
import { copy } from '../../copy/es';
import { TodayMissions } from '../../hub/TodayMissions';
import { TopBar } from '../../hub/TopBar';
import { BackLink } from '../../ui/BackLink';
import { useReducedMotion } from '../../ui/motion';
import planetUrl from '../lobby-art/planet.png';
import stationUrl from '../lobby-art/station.png';
import { LobbyScene } from '../LobbyScene';
import { GroupPanel, RoomPanel } from './GroupPanel';
import { LaunchDock } from './LaunchDock';
import { Rail } from './Rail';
import { RelicStrip } from './RelicStrip';
import { type Mode, Stage } from './Stage';
import { WherePanel } from './WherePanel';

// The lobby (/incursion; the owner's «Escenario», Brawl Stars style): a living backdrop of the chosen sector (things
// happen far away), the game's bar on top and its places on the rail, and the run built in order: 1, who with (alone
// or in a group, over the stage); 2, where (the sector, or the room); 3, with what (the probe on its pad, which opens
// the workshop, and the relics along the foot); then the launch. A grid whose areas never overlap: nothing covers
// anything (the owner). `?modo=grupo` keeps the group side across reloads; being in a room is always the group side.

/** A real galaxy far away: one of my relics, or the lobby's own. */
function FarGalaxy({ seed }: { seed: string }) {
  const { ref, canvas, state } = useGalaxyImage(seed, 192, 560);
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!host.current || !canvas) return;
    host.current.prepend(canvas);
    return () => canvas.remove();
  }, [canvas]);
  return (
    <div ref={ref} className="lobby-galaxy" data-state={state}>
      <div ref={host} className="lobby-galaxy-art" />
    </div>
  );
}

export function Lobby({ view, onLaunch, launching, error, coached }: { view: HangarView; onLaunch: () => void; launching: boolean; error: unknown; coached: boolean }) {
  const reduced = useReducedMotion();
  const me = useMe().data;
  const gacha = useGacha().data;
  const room = useRooms().data?.mine ?? null;
  const [params, setParams] = useSearchParams();
  const mode: Mode = room || (!coached && params.get('modo') === 'grupo') ? 'group' : 'solo';
  const sector = view.sectors.find((s) => s.id === (room?.sector ?? view.sector)) ?? view.sectors[0];
  const look = BIOME_LOOK[(sector?.biome ?? 'nebula') as BiomeId] ?? BIOME_LOOK.nebula;
  const fauna = sector?.fauna.map((f) => f.sprite).join(',') ?? '';
  const probes = view.probes
    .filter((p) => p.unlocked)
    .map((p) => p.sprite)
    .join(',');
  const cast = useMemo(() => ({ look, fauna: fauna ? fauna.split(',') : [], probes: probes ? probes.split(',') : [] }), [look, fauna, probes]);
  const seed = view.loadout.find((g) => g !== null)?.seed ?? '2026110901';
  const onMode = (m: Mode) => setParams(m === 'group' ? { modo: 'grupo' } : {}, { replace: true });

  return (
    <div className={`screen-root lobby-root${launching ? ' launching' : ''}`} style={{ '--n1': look.nebula[0], '--n2': look.nebula[1] } as CSSProperties}>
      <div className="lobby-sky" aria-hidden="true">
        <LobbyScene key={sector?.id ?? 'none'} cast={cast} reduced={reduced} />
        <FarGalaxy seed={seed} />
        <span className="lobby-planet" style={{ backgroundImage: `url(${planetUrl})` }} />
        <span className="lobby-station" style={{ backgroundImage: `url(${stationUrl})` }} />
        <span className="lobby-vignette" />
      </div>
      <div className="lobby">
        <div className="lobby-top">
          <BackLink fallback="/" className="lip pill lobby-back" />
          <h1 className="sr-only">{copy.hangar.title}</h1>
          {me ? <TopBar me={me} wallet={gacha?.wallet} freePull={gacha?.freePullAvailable ?? false} /> : null}
        </div>
        <Rail />
        <Stage view={view} room={room} me={me?.username ?? ''} mode={mode} onMode={onMode} showModes={!coached} />
        <aside className="lip panel lobby-side" aria-label={mode === 'group' ? copy.coop.title : copy.lobby.where}>
          {room ? <RoomPanel view={view} room={room} me={me?.username ?? ''} /> : mode === 'group' ? <GroupPanel view={view} /> : <WherePanel view={view} />}
        </aside>
        <div className="lobby-foot">
          <TodayMissions d=".3s" className="lobby-missions" />
          <RelicStrip view={view} />
          <LaunchDock view={view} mode={mode} room={room} me={me?.username ?? ''} onLaunch={onLaunch} launching={launching} error={error} />
        </div>
      </div>
      {launching ? <span className="lobby-flash" aria-hidden="true" /> : null}
    </div>
  );
}
