import { hudSnapshot, type HudSnapshot, relicVision } from '@galaxy/sim';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BeaconMarker, BossBar } from '../arena/hud/Overlays';
import { Hud } from '../arena/hud/Hud';
import { createLoop } from '../arena/loop';
import type { Camera } from '../arena/stage/camera';
import { createStage, type Stage } from '../arena/stage/stage';
import { copy } from '../copy/es';
import { usePrefs } from '../settings/prefs';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';
import { createLiveFeed, type LiveFeed } from './replay/live-feed';

// Watching a solo run live (plan «escáner pro», part G; the owner: «los admins deberían de poder ver partidas
// individuales en directo»). Staff, moderators included, as for group runs. The staff socket brings the run's start and
// its log so far; the arena is drawn from the replay of it, which catches up fast and then follows the player at its
// pace, a moment behind. What is going on is always said: connecting, catching up, choosing a level-up, paused, the
// player's connection lost, over, or no longer live. It plays no sound.

const s = copy.admin.moderation.solo;
/** Further behind than 2 s, it catches up fast; a little behind, it plays a touch quicker until it is level again. */
const LAG = 120;
/** Catching up goes in slices, for at most this long per step, so the tab never freezes on a long run. */
const CATCH_UP = 120;
const CATCH_UP_MS = 6;
const SYNC_MS = 100;

interface Clock {
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
}
const browserClock: Clock = {
  now: () => performance.now(),
  schedule: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(() => cb(performance.now()), 16)),
};

/** The bits of a WebSocket the screen uses (the browser's fits; the tests use a fake). */
export interface WatchSocket {
  readonly readyState: number;
  close(code?: number): void;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
}
const defaultOpen = (url: string): WatchSocket => new WebSocket(url) as unknown as WatchSocket;

export function SoloWatchScreen({ clock = browserClock, open = defaultOpen }: { clock?: Clock; open?: (url: string) => WatchSocket }) {
  const { runId = '' } = useParams();
  return <SoloWatch key={runId} runId={runId} clock={clock} open={open} />;
}

function SoloWatch({ runId, clock, open }: { runId: string; clock: Clock; open: (url: string) => WatchSocket }) {
  const feed = useMemo(() => createLiveFeed(), []);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [closed, setClosed] = useState<number | null>(null);

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/galaxy/api/admin/solo/watch/ws?run=${encodeURIComponent(runId)}`;
    let socket: WatchSocket;
    try {
      socket = open(url);
    } catch {
      // A socket that cannot even be made reads as a dropped one (said after this render).
      const id = setTimeout(() => setClosed(1006), 0);
      return () => clearTimeout(id);
    }
    socket.onmessage = (e) => {
      try {
        feed.apply(JSON.parse(e.data));
      } catch {
        // A message that is not JSON changes nothing.
      }
      bump();
    };
    socket.onclose = (e) => setClosed(e.code);
    socket.onerror = () => {};
    return () => {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close(1000);
    };
  }, [feed, open, runId]);

  const hello = feed.hello;
  const back = (
    <Link to="/admin/moderacion/salas" className="lip pill small">
      <Icon name="back" />
      <span>{s.back}</span>
    </Link>
  );
  if (!hello) {
    return (
      <section className="admin-page">
        {back}
        <p className="panel-note" role="status">
          {feed.state === 'broken' ? s.broken : closed !== null ? (closed === 4404 ? s.gone : s.closed) : s.connecting}
        </p>
      </section>
    );
  }
  const content = hello.start.content;
  const sector = content.sectors.find((x) => x.id === hello.start.sector)?.name ?? hello.start.sector;
  const probe = content.probes.find((x) => x.id === hello.start.probe)?.name ?? hello.start.probe;
  return (
    <section className="admin-page solo-watch">
      {back}
      <header className="admin-player-head">
        <h1>{s.title(hello.run.player)}</h1>
        <p className="admin-chips">
          <span className="admin-chip ok live-chip">{s.live}</span>
          <span className="admin-chip">{sector}</span>
          <span className="admin-chip">{probe}</span>
        </p>
      </header>
      <LiveArena feed={feed} clock={clock} closed={closed} onTick={bump} />
    </section>
  );
}

/** What the view says over the arena now (null: nothing, the run plays). */
function statusOf(feed: LiveFeed, closed: number | null): string | null {
  const st = feed.state;
  if (st === 'broken') return s.broken;
  if (st === 'ended') return feed.behind === 0 ? s.ended : s.syncing;
  if (closed !== null) return closed === 4404 ? s.gone : s.closed;
  if (feed.behind > LAG) return s.syncing;
  if (st === 'done') return s.saving;
  if (st === 'lost') return s.lost;
  if (st === 'pause') return s.paused;
  if (feed.waiting || st === 'pick') return s.picking;
  return null;
}

function LiveArena({ feed, clock, closed, onTick }: { feed: LiveFeed; clock: Clock; closed: number | null; onTick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const reduced = useReducedMotion();
  const colorVision = usePrefs((p) => p.colorVision);
  const sim = feed.sim!;
  const start = feed.hello!.start;
  const [hud, setHud] = useState<HudSnapshot>(() => hudSnapshot(sim, 0));
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });

  // The stage and the fixed-step loop: one step per tick at the player's pace, many while far behind (then without the
  // effects, which would only pile up).
  useEffect(() => {
    let disposed = false;
    const loop = createLoop({
      now: clock.now,
      schedule: clock.schedule,
      step: () => {
        const behind = feed.behind;
        if (behind > LAG) {
          const until = performance.now() + CATCH_UP_MS;
          while (feed.behind > LAG && feed.advance(CATCH_UP) > 0 && performance.now() < until);
        } else feed.advance(behind > 30 ? 2 : 1, (events) => stageRef.current?.feed(events, sim.tick));
      },
      render: (alpha) => stageRef.current?.render(sim, sim.status === 'running' && feed.behind > 0 ? alpha : 1),
    });
    const canvas = canvasRef.current!;
    const fit = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(1, Math.floor(box?.width || 1280));
      const h = Math.max(1, Math.floor(box?.height || 720));
      canvas.width = w;
      canvas.height = h;
      stageRef.current?.resize(w, h);
      setSize({ w, h });
    };
    const biome = start.content.sectors.find((x) => x.id === start.sector)?.biome ?? 'nebula';
    void createStage(canvas, start.content, { reduced, colorVision, vision: relicVision(sim, sim.probes[0]!), probe: 0, seed: start.seed, biome }).then((stage) => {
      if (disposed) {
        stage.destroy();
        return;
      }
      stageRef.current = stage;
      fit();
      loop.start();
    });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    return () => {
      disposed = true;
      loop.stop();
      ro?.disconnect();
      stageRef.current?.destroy();
      stageRef.current = null;
    };
    // The run is fixed for the life of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  useEffect(() => stageRef.current?.setReduced(reduced), [reduced]);
  useEffect(() => stageRef.current?.setColorVision(colorVision), [colorVision]);

  // The HUD and what the view says, a few times per second.
  useEffect(() => {
    const id = setInterval(() => {
      setHud(hudSnapshot(sim, 0));
      setCamera(stageRef.current?.camera() ?? null);
      onTick();
    }, SYNC_MS);
    return () => clearInterval(id);
  }, [sim, onTick]);

  const status = statusOf(feed, closed);
  return (
    <div className="replay-player">
      <div className={`replay-stage${reduced ? ' reduced' : ''}`}>
        <canvas ref={canvasRef} className="arena-canvas" role="img" aria-label={s.stage} />
        <Hud hud={hud} content={start.content} announce="" />
        {hud.boss ? <BossBar boss={hud.boss} /> : null}
        {hud.beacon ? <BeaconMarker beacon={hud.beacon} camera={camera} width={size.w} height={size.h} /> : null}
        <p className={`replay-ended solo-status${status ? '' : ' is-quiet'}`} role="status">
          {status ?? ''}
        </p>
      </div>
    </div>
  );
}
