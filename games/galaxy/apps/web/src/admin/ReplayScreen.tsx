import type { AdminRunReplay } from '@galaxy/shared';
import { createReplayer, decodeLog, fromBase64, hudSnapshot, type HudSnapshot, type InputLog, relicVision, SIM_VERSION, type SimOptions } from '@galaxy/sim';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAdminRun } from '../api/admin-runs';
import { BeaconMarker, BossBar } from '../arena/hud/Overlays';
import { clockText, Hud } from '../arena/hud/Hud';
import { createLoop } from '../arena/loop';
import type { Camera } from '../arena/stage/camera';
import { createStage, type Stage } from '../arena/stage/stage';
import { errorText } from '../auth/useMe';
import { copy, fmt } from '../copy/es';
import { Icon } from '../ui/Icon';
import { typing } from '../ui/keys';
import { useReducedMotion } from '../ui/motion';
import { ActionDialog } from './ActionDialog';
import { checkReplay, type CheckRow, CLIPPING_FLAGS, createPlayback, type Playback, replayOptionsOf, replayUntil } from './replay/playback';
import { outcomeText } from './RunsScreen';
import { usePrefs } from '../settings/prefs';

// A run's replay in the panel (GDD §16.2, §16.6; M6d-3, DESIGN_SYSTEM §8 duovicies): the arena drawn from the run's own
// seed, snapshot and recorded inputs, played at 1x to 8x and moved along a timeline; «Comprobar» replays it to its last
// tick on the side and compares the end with what the server kept; and the run is marked as suspicious or not. It never
// starts by itself, and plays no sound.

const t = copy.admin.runs;
const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const SPEEDS = [1, 2, 4, 8] as const;
type Speed = (typeof SPEEDS)[number];
const TICKS_PER_SECOND = 60;
const JUMP = 5 * TICKS_PER_SECOND;
/** Ticks simulated per slice while seeking or checking, between two yields to the page (about a tenth of a second). */
const CHUNK = 3000;
const SYNC_MS = 100;

interface Clock {
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
}
const browserClock: Clock = {
  now: () => performance.now(),
  schedule: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(() => cb(performance.now()), 16)),
};
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What a replay is built from, checked once: its options, its decoded log and the tick it plays to. */
interface Replayable {
  opts: SimOptions;
  log: InputLog;
  until: number;
}

export function ReplayScreen({ clock = browserClock }: { clock?: Clock }) {
  const { id = '' } = useParams();
  const run = useAdminRun(id);
  if (!run.data) {
    return (
      <section className="admin-page">
        {run.error ? (
          <p className="field-error" role="alert">
            {errorText(run.error, copy.errors)}
          </p>
        ) : (
          <p className="panel-note">{t.loading}</p>
        )}
      </section>
    );
  }
  return <Replay key={id} data={run.data} clock={clock} />;
}

function Replay({ data, clock }: { data: AdminRunReplay; clock: Clock }) {
  const { run, start } = data;
  /** The open mark dialog, with the state it sets (fixed when it opens, so a refetch never turns it around). */
  const [open, setOpen] = useState<{ suspicious: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const sector = start.content.sectors.find((s) => s.id === start.sector)?.name ?? start.sector;
  const probe = start.content.probes.find((p) => p.id === start.probe)?.name ?? start.probe;
  // A group run plays to the group's end (phase 6c); a solo run to its own.
  const hasLog = data.inputs !== null && (data.coop ? data.coop.ticks !== null : (run.claimed?.ticks ?? run.ticks) !== null);
  // Built once: a log that does not decode, or a sector or probe its content lacks, says so instead of breaking the page.
  const replayable = useMemo<Replayable | null>(() => {
    if (!hasLog) return null;
    try {
      const until = replayUntil(run, data.coop);
      const opts = replayOptionsOf(start, data.coop);
      const log = decodeLog(fromBase64(data.inputs!));
      createReplayer(opts, log, until);
      return { opts, log, until };
    } catch {
      return null;
    }
    // The run's start, inputs and claim never change; a refetch after a mark keeps the same replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLog, run.id]);
  // Runs finished before M6d-3 kept only the clipped figures: a clean run may still differ from them.
  const clipped = hasLog && !run.claimed && run.flags.some((f) => (CLIPPING_FLAGS as readonly string[]).includes(f));
  return (
    <section className="admin-page replay">
      <Link to="/admin/partidas" className="lip pill small replay-back">
        <Icon name="back" />
        {t.back}
      </Link>
      <header className="replay-head">
        <div>
          <h1>{t.heading(run.player)}</h1>
          <ul className="replay-facts">
            <li>{sector}</li>
            <li>{probe}</li>
            <li>{outcomeText(run.outcome)}</li>
            {data.coop ? <li>{t.coopFact(data.coop.players.length)}</li> : null}
            {run.seconds !== null ? <li>{clockText(run.seconds)}</li> : null}
            <li className={run.suspicious ? 'run-flag' : undefined}>{run.suspicious ? t.marked : t.notMarked}</li>
          </ul>
        </div>
        {run.finishedAt ? (
          <button type="button" className={`lip pill${run.suspicious ? '' : ' danger'}`} onClick={() => setOpen({ suspicious: !run.suspicious })}>
            {run.suspicious ? t.unmark : t.mark}
          </button>
        ) : null}
      </header>
      {notice ? (
        <p className="admin-done" role="status">
          {notice}
        </p>
      ) : null}
      {run.simVersion !== SIM_VERSION ? (
        <p className="replay-warning" role="note">
          <Icon name="alert" />
          {t.otherVersion(run.simVersion, SIM_VERSION)}
        </p>
      ) : null}
      {data.contentFallback ? (
        <p className="replay-warning" role="note">
          <Icon name="alert" />
          {t.contentFallback(run.contentVersion)}
        </p>
      ) : null}
      {clipped ? (
        <p className="replay-warning" role="note">
          <Icon name="alert" />
          {t.clipped}
        </p>
      ) : null}
      <div className="replay-grid">
        {replayable ? (
          <Player replayable={replayable} data={data} clock={clock} />
        ) : (
          <p className="panel-note replay-none">{hasLog ? t.cannotReplay : run.finishedAt ? t.noLog : t.noInputs}</p>
        )}
        <aside className="replay-side">
          {replayable ? <Check replayable={replayable} data={data} /> : null}
          <Details data={data} />
        </aside>
      </div>
      {open ? (
        <ActionDialog
          url={`/admin/runs/${run.id}/mark`}
          title={open.suspicious ? t.mark : t.unmark}
          submit={open.suspicious ? t.mark : t.unmark}
          intro={<p>{open.suspicious ? t.markIntro : t.unmarkIntro}</p>}
          password={() => false}
          build={() => ({ suspicious: open.suspicious })}
          onDone={() => {
            setNotice(open.suspicious ? t.markedDone : t.unmarkedDone);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/** The arena, its HUD and the transport under it. */
function Player({ replayable, data, clock }: { replayable: Replayable; data: AdminRunReplay; clock: Clock }) {
  const { until } = replayable;
  const playback = useMemo<Playback>(() => createPlayback(replayable.opts, replayable.log, replayable.until), [replayable]);
  const reduced = useReducedMotion();
  const colorVision = usePrefs((p) => p.colorVision);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const playing = useRef(false);
  const speed = useRef<Speed>(1);
  const seeking = useRef(false);
  const pending = useRef<number | null>(null);
  /** The tick the seek under way is heading to (null when none is). */
  const heading = useRef<number | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [rate, setRate] = useState<Speed>(1);
  const [tick, setTick] = useState(0);
  const [ended, setEnded] = useState(false);
  const [seekPct, setSeekPct] = useState<number | null>(null);
  /** The probe the camera and the HUD follow: the player looked at, or (a group run) any of the group. */
  const [follow, setFollow] = useState(data.coop?.slot ?? 0);
  const followRef = useRef(follow);
  const [hud, setHud] = useState<HudSnapshot>(() => hudSnapshot(playback.sim, follow));
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });

  const sync = useCallback(() => {
    setTick(playback.tick);
    setEnded(playback.ended);
    setHud(hudSnapshot(playback.sim, followRef.current));
    setCamera(stageRef.current?.camera() ?? null);
  }, [playback]);

  const stop = useCallback(() => {
    playing.current = false;
    setPlaying(false);
  }, []);

  /** Lands on `target`, in slices so a long jump keeps the page alive; the last jump asked for wins. */
  const seekTo = useCallback(
    async (target: number) => {
      pending.current = Math.max(0, Math.min(until, Math.round(target)));
      if (seeking.current) return;
      seeking.current = true;
      while (pending.current !== null) {
        const goal = pending.current;
        pending.current = null;
        heading.current = goal;
        if (goal < playback.tick) playback.rewind();
        while (playback.tick < goal && !playback.ended) {
          playback.advance(Math.min(CHUNK, goal - playback.tick));
          if (playback.tick < goal && !playback.ended) {
            setSeekPct(Math.round((playback.tick / Math.max(1, goal)) * 100));
            await yieldToPage();
            if (pending.current !== null) break;
          }
        }
      }
      seeking.current = false;
      heading.current = null;
      setSeekPct(null);
      sync();
    },
    [playback, until, sync],
  );

  const toggle = useCallback(() => {
    if (playing.current) {
      stop();
      return;
    }
    if (playback.ended) {
      playback.rewind();
      sync();
    }
    playing.current = true;
    setPlaying(true);
  }, [playback, stop, sync]);

  const pickSpeed = (s: Speed) => {
    speed.current = s;
    setRate(s);
  };

  // The stage and the fixed-step loop: while playing, each step plays `speed` ticks and hands their events to the stage.
  useEffect(() => {
    let disposed = false;
    const loop = createLoop({
      now: clock.now,
      schedule: clock.schedule,
      step: () => {
        if (!playing.current || seeking.current) return;
        playback.advance(speed.current, (events) => stageRef.current?.feed(events, playback.tick));
        if (playback.ended) {
          playing.current = false;
          setPlaying(false);
        }
      },
      render: (alpha) => stageRef.current?.render(playback.sim, playing.current ? alpha : 1),
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
    const biome = data.start.content.sectors.find((s) => s.id === data.start.sector)?.biome ?? 'nebula';
    const first = followRef.current;
    void createStage(canvas, data.start.content, { reduced, colorVision, vision: relicVision(playback.sim, playback.sim.probes[first]!), probe: first, seed: data.start.seed, biome }).then((stage) => {
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
    // The run is fixed for the life of the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  // The HUD, the timeline and the end read the playback a few times per second while it plays.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(sync, SYNC_MS);
    return () => {
      clearInterval(id);
      sync();
    };
  }, [isPlaying, sync]);

  // Space plays or pauses and the arrows move 5 s, also on the timeline (its own arrows would move one tick). A second
  // arrow during a long seek counts from where the first one is going, not from where the rebuild has got to.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const onSlider = e.target instanceof HTMLInputElement && e.target.type === 'range';
      if (!onSlider && typing(e)) return;
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const from = pending.current ?? heading.current ?? playback.tick;
        void seekTo(from + (e.code === 'ArrowRight' ? JUMP : -JUMP));
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [toggle, seekTo, playback]);

  const watch = (slot: number) => {
    followRef.current = slot;
    setFollow(slot);
    stageRef.current?.follow(slot);
    sync();
  };

  const now = clockText(tick / TICKS_PER_SECOND);
  const total = clockText(until / TICKS_PER_SECOND);
  return (
    <div className="replay-player">
      {data.coop ? (
        <div className="segmented replay-cameras" role="radiogroup" aria-label={t.camera}>
          {data.coop.players.map((pl, i) => (
            <button key={pl.username} type="button" role="radio" aria-checked={follow === i} onClick={() => watch(i)}>
              {i === data.coop!.slot ? t.cameraOf(pl.username) : pl.username}
            </button>
          ))}
        </div>
      ) : null}
      <div className={`replay-stage${reduced ? ' reduced' : ''}`}>
        <canvas ref={canvasRef} className="arena-canvas" role="img" aria-label={t.stage} />
        <Hud hud={hud} content={data.start.content} announce="" />
        {hud.boss ? <BossBar boss={hud.boss} /> : null}
        {hud.beacon ? <BeaconMarker beacon={hud.beacon} camera={camera} width={size.w} height={size.h} /> : null}
        {ended && !isPlaying ? (
          <p className="replay-ended" role="status">
            {t.ended}
          </p>
        ) : null}
        {seekPct !== null ? (
          <p className="replay-seeking" role="status">
            {t.seeking(seekPct)}
          </p>
        ) : null}
      </div>
      <div className="replay-transport lip panel">
        <button type="button" className="lip pill replay-play" onClick={toggle}>
          <Icon name={isPlaying ? 'pause' : 'play'} />
          {isPlaying ? t.pause : t.play}
        </button>
        <div className="replay-speeds" role="group" aria-label={t.speed}>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className="lip pill small" aria-pressed={rate === s} aria-label={t.speedOf(s)} onClick={() => pickSpeed(s)}>
              {t.speeds(s)}
            </button>
          ))}
        </div>
        <div className="replay-time">
          <span aria-hidden="true">{now}</span>
          <input
            className="replay-range"
            type="range"
            min={0}
            max={until}
            step={1}
            value={tick}
            aria-label={t.timeline}
            aria-valuetext={t.timeAt(now, total)}
            style={{ '--p': `${until > 0 ? (tick / until) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => void seekTo(Number(e.target.value))}
          />
          <span aria-hidden="true">{total}</span>
        </div>
        <div className="replay-jumps">
          <button type="button" className="lip pill small" onClick={() => void seekTo(0)}>
            {t.restart}
          </button>
          <button type="button" className="lip pill small" onClick={() => void seekTo(until)}>
            {t.toEnd}
          </button>
        </div>
      </div>
      <p className="hint replay-keys">{t.keysHint}</p>
    </div>
  );
}

/** «Comprobar»: the run replayed on the side to its last tick, its end against what the server kept. */
function Check({ replayable, data }: { replayable: Replayable; data: AdminRunReplay }) {
  const [pct, setPct] = useState<number | null>(null);
  const [result, setResult] = useState<{ matches: boolean; rows: CheckRow[] } | null>(null);
  const alive = useRef(true);
  // Set on every mount: StrictMode mounts, unmounts and mounts again in development, and the ref outlives that.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async () => {
    const { until } = replayable;
    // Exactly what the server's `replay` does (every step the log allows, up to the last tick), in slices.
    const r = createReplayer(replayable.opts, replayable.log, until);
    setResult(null);
    setPct(0);
    let more = true;
    while (more) {
      for (let n = 0; n < CHUNK && (more = r.next()); n++);
      if (!alive.current) return;
      setPct(Math.round((r.sim.tick / Math.max(1, until)) * 100));
      if (more) await yieldToPage();
    }
    if (!alive.current) return;
    setPct(null);
    setResult(checkReplay(r.sim, data.run, data.coop));
  };
  // The hash in two groups of eight, one per line; the counts grouped the Spanish way.
  const shown = (r: CheckRow, v: string | number | null) => (v === null ? '—' : r.key === 'hash' ? String(v).replace(/^(.{8})/, '$1\n') : typeof v === 'number' ? fmt(v) : String(v));
  return (
    <section className="lip panel replay-check" aria-labelledby="replay-check-title">
      <h2 id="replay-check-title">{t.checkTitle}</h2>
      <p className="panel-note">{t.checkIntro}</p>
      <button type="button" className="lip pill small" onClick={() => void run()} disabled={pct !== null}>
        {t.check}
      </button>
      {pct !== null ? (
        <p className="panel-note" role="status">
          {t.checking(pct)}
        </p>
      ) : null}
      {result ? (
        <>
          <p className={`replay-verdict ${result.matches ? 'ok' : 'bad'}`} role="status">
            <Icon name={result.matches ? 'check' : 'alert'} />
            {result.matches ? t.matches : t.differs}
          </p>
          <table className="admin-table replay-check-table" aria-labelledby="replay-check-title">
            <thead>
              <tr>
                <th scope="col">{t.checkCols.what}</th>
                <th scope="col">{t.checkCols.saved}</th>
                <th scope="col">{t.checkCols.replayed}</th>
                <th scope="col">{t.checkCols.same}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.key} className={r.same ? undefined : 'differs'}>
                  <th scope="row">{t.checkKeys[r.key]}</th>
                  <td className={r.key === 'hash' ? 'mono' : undefined}>{shown(r, r.saved)}</td>
                  <td className={r.key === 'hash' ? 'mono' : undefined}>{shown(r, r.replayed)}</td>
                  <td>{r.same ? t.same : t.different}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function Details({ data }: { data: AdminRunReplay }) {
  const { run, start } = data;
  const rows: [string, string][] = [
    [t.details.started, date.format(new Date(run.startedAt))],
    [t.details.seconds, run.seconds === null ? '—' : clockText(run.seconds)],
    [t.details.seed, start.seed],
    [t.details.simVersion, run.simVersion],
    [t.details.contentVersion, t.contentVersionOf(run.contentVersion)],
    [t.details.relics, String(start.relics.length)],
    [t.details.flags, run.flags.length ? run.flags.map((f) => t.flagNames[f] ?? f).join(', ') : t.noFlags],
  ];
  return (
    <section className="lip panel replay-details" aria-labelledby="replay-details-title">
      <h2 id="replay-details-title">{t.detailsTitle}</h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Link to={`/admin/jugadores/${run.player}`}>{t.playerPage(run.player)}</Link>
    </section>
  );
}
