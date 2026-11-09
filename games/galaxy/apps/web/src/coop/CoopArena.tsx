import { type CoopRunStart, type CoopServerMessage, coopSimOptions, type RunResult } from '@galaxy/shared';
import { CoopFeed, createSim, decodeLog, fromBase64, hudSnapshot, type HudSnapshot, relicVision, type Sim, type SimEvent, step } from '@galaxy/sim';
import { useCallback, useEffect, useRef, useState } from 'react';
import { announceFor } from '../arena/announce';
import { playEvents } from '../arena/arena-sfx';
import { BeaconMarker, BossBar } from '../arena/hud/Overlays';
import { Hud } from '../arena/hud/Hud';
import { PauseMenu } from '../arena/hud/PauseMenu';
import { emptyInput, readInput } from '../arena/input';
import { createLockstep, type Lockstep } from '../arena/lockstep';
import { manualAim as storedAim, setManualAim } from '../arena/settings';
import type { Camera } from '../arena/stage/camera';
import { createStage, type Stage } from '../arena/stage/stage';
import { retryDelay } from '../chat/useChatSocket';
import { copy } from '../copy/es';
import { ResultsScreen } from '../hangar/ResultsScreen';
import { useLive } from '../live/LiveConnection';
import { typing } from '../ui/keys';
import { useReducedMotion } from '../ui/motion';
import type { CoopMark } from '@galaxy/shared';
import { CoopCards, LifeNotice, SpectateBar, spectateTarget, TeamPanel } from './CoopHud';
import { CoopMarks, MARK_SHOW_MS, markFrom, MarkWheel, type ShownMark, toWorld } from './Marks';
import { playMark } from './sfx';
import { TeamResults, teamRows } from './TeamResults';

// A co-op run in the browser (multiplayer plan, phase 6). The play socket says hello with the run and the sealed log
// so far; from then on it brings the sealed events and the tick the server closed. The run is simulated only up to
// that tick (arena/lockstep.ts), so every player sees the same world; my inputs go to the server only when they
// change. Nothing pauses: Escape opens a menu over the running world, and the cards are a strip picked with 1, 2 or
// 3 before their time runs out. A dropped socket comes back and fills in what it missed; a reload replays the log
// from the start. At the end the server says what I was paid, and the room waits again.

const HUD_EVERY_MS = 100;
const END_DELAY_MS = 1500;
const FINAL = new Set([4401, 4403, 4404, 4400, 4409]);
const t = copy.coop.arena;

type Link = 'connecting' | 'live' | 'lost' | 'gone';

interface Clock {
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
}
const browserClock: Clock = { now: () => performance.now(), schedule: (cb) => requestAnimationFrame(cb) };

export function CoopArena({
  runId,
  onExit,
  onAbandon,
  clock = browserClock,
  onSim,
}: {
  runId: string;
  onExit: () => void;
  onAbandon: () => void;
  clock?: Clock;
  /** The simulation once the run arrived (tests). */
  onSim?: (sim: Sim) => void;
}) {
  /** The run once the hello arrived: its start, my simulation and the feed of sealed events (made once). */
  const [world, setWorld] = useState<{ start: CoopRunStart; sim: Sim; feed: CoopFeed } | null>(null);
  const [link, setLink] = useState<Link>('connecting');
  const [result, setResult] = useState<{ result: RunResult | null } | null>(null);
  const worldRef = useRef<{ start: CoopRunStart; sim: Sim; feed: CoopFeed } | null>(null);
  const known = useRef(0);
  const closed = useRef(0);
  const socket = useRef<WebSocket | null>(null);
  /** The quick marks on screen (phase 6c), newest last. */
  const [marks, setMarks] = useState<ShownMark[]>([]);
  const markId = useRef(0);
  // A mark goes when its time is up (they also fade out on their own in CSS).
  useEffect(() => {
    if (marks.length === 0) return;
    const due = marks[0]!.at + MARK_SHOW_MS - Date.now();
    const id = setTimeout(() => setMarks((ms) => ms.filter((k) => Date.now() - k.at < MARK_SHOW_MS)), Math.max(0, due));
    return () => clearTimeout(id);
  }, [marks]);

  /** Bumped on every hello: what was sent before a reconnect may never have arrived, so it is sent again. */
  const [epoch, setEpoch] = useState(0);
  /** Sends if the socket is open; false when it is not (the caller keeps it pending). */
  const send = useCallback((msg: unknown): boolean => {
    const s = socket.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    s.send(JSON.stringify(msg));
    return true;
  }, []);

  // The play socket: hello (the run, or what I missed), frames, the end.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/galaxy/api/coop/play/ws?run=${encodeURIComponent(runId)}`);
      socket.current = s;
      s.onmessage = (e: MessageEvent) => {
        let msg: CoopServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as CoopServerMessage;
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          attempt = 0;
          if (!worldRef.current) {
            worldRef.current = { start: msg.start, sim: createSim(coopSimOptions(msg.start)), feed: new CoopFeed(msg.start.players.length) };
            setWorld(worldRef.current);
            onSim?.(worldRef.current.sim);
          }
          const events = decodeLog(fromBase64(msg.log)).events;
          worldRef.current.feed.push(events.slice(known.current));
          known.current = Math.max(known.current, events.length);
          closed.current = Math.max(closed.current, msg.to);
          setLink('live');
          setEpoch((e) => e + 1);
        } else if (msg.t === 'f') {
          worldRef.current?.feed.push(msg.ev);
          known.current += msg.ev.length;
          closed.current = msg.to;
        } else if (msg.t === 'end') {
          setResult({ result: msg.result });
        } else if (msg.t === 'mark') {
          const at = Date.now();
          const shown: ShownMark = { id: ++markId.current, slot: msg.slot, kind: msg.kind, x: msg.x, y: msg.y, at };
          setMarks((ms) => [...ms.filter((k) => at - k.at < MARK_SHOW_MS).slice(-7), shown]);
          playMark(msg.kind);
        }
      };
      s.onclose = (e: CloseEvent) => {
        socket.current = null;
        if (stopped || e.code === 1000) return;
        if (FINAL.has(e.code)) {
          setLink('gone');
          return;
        }
        setLink('lost');
        timer = setTimeout(connect, retryDelay(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
    };
    // One socket per run; onSim is for tests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (link === 'gone' && !world) {
    return (
      <div className="results sending" role="alert">
        <p>{t.gone}</p>
        <button type="button" className="lip pill pill-solar" onClick={onExit}>
          {t.back}
        </button>
      </div>
    );
  }
  if (!world) {
    return (
      <div className="arena coop-arena">
        <p className="coop-arena-status" role="status">
          {t.connecting}
        </p>
      </div>
    );
  }
  return (
    <CoopWorld
      marks={marks}
      start={world.start}
      sim={world.sim}
      feed={world.feed}
      closed={closed}
      link={link}
      epoch={epoch}
      result={result}
      send={send}
      clock={clock}
      onExit={onExit}
      onAbandon={() => {
        send({ t: 'leave' });
        onAbandon();
      }}
    />
  );
}

function CoopWorld({
  marks,
  start,
  sim,
  feed,
  closed,
  link,
  epoch,
  result,
  send,
  clock,
  onExit,
  onAbandon,
}: {
  marks: ShownMark[];
  clock: Clock;
  start: CoopRunStart;
  sim: Sim;
  feed: CoopFeed;
  closed: { current: number };
  link: Link;
  epoch: number;
  result: { result: RunResult | null } | null;
  send: (msg: unknown) => boolean;
  onExit: () => void;
  onAbandon: () => void;
}) {
  const slot = start.slot;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const loopRef = useRef<Lockstep | null>(null);
  const input = useRef(emptyInput());
  const lastSent = useRef<string>('');
  const seenReactions = useRef(new Set<string>());
  const reduced = useReducedMotion();
  const [hud, setHud] = useState<HudSnapshot>(() => hudSnapshot(sim, slot));
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [menu, setMenu] = useState(false);
  const [behind, setBehind] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [ending, setEnding] = useState<'extracted' | 'died' | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [manualAim, setAim] = useState(storedAim);
  const aimRef = useRef(manualAim);
  /** The offer I already answered (its sequence): its strip hides until the next one opens. */
  const [picked, setPicked] = useState(-1);
  const hudRef = useRef(hud);
  /** Out until the next layer (phase 6c): the teammate the camera follows; null follows my own probe. */
  const [watching, setWatching] = useState<number | null>(null);
  const watchingRef = useRef<number | null>(null);
  const watch = useCallback(
    (to: number | null) => {
      if (to === watchingRef.current) return;
      watchingRef.current = to;
      setWatching(to);
      stageRef.current?.follow(to ?? slot);
    },
    [slot],
  );
  /** The quick-mark wheel while Q is held: where it opened, and the choice under the pointer. */
  const [wheel, setWheel] = useState<{ x: number; y: number; choice: CoopMark } | null>(null);
  const wheelRef = useRef(wheel);

  const sentAt = useRef(0);
  // A new hello (a reconnect): the server may have missed my last input; it goes again.
  useEffect(() => {
    lastSent.current = '';
  }, [epoch]);

  /** My input now, sent only when it changed, at most once per tick (idle while the window has no focus). */
  const sendInput = useCallback(() => {
    if (sim.probes[slot]?.life === 'left') return;
    const now = clock.now();
    if (now - sentAt.current < 15) return;
    const cam = stageRef.current?.camera();
    const rect = canvasRef.current?.getBoundingClientRect();
    const aimFrom = cam && rect ? { x: rect.left + cam.bars + (cam.worldW * cam.zoom) / 2, y: rect.top + rect.height / 2 } : undefined;
    const i = readInput(input.current, { manualAim: aimRef.current }, aimFrom);
    const key = `${i.mx},${i.my},${i.aim}`;
    if (key === lastSent.current) return;
    if (!send({ t: 'in', mx: i.mx, my: i.my, aim: i.aim })) return;
    lastSent.current = key;
    sentAt.current = now;
  }, [send, sim, slot, clock]);

  // The world: stage and the lockstep loop.
  useEffect(() => {
    let disposed = false;
    const onEvents = (events: readonly SimEvent[]) => {
      stageRef.current?.feed(events, sim.tick);
      playEvents(events);
      const said = announceFor(events, start.content, seenReactions.current);
      if (said) setAnnounce(said);
    };
    const loop = createLockstep({
      now: clock.now,
      schedule: clock.schedule,
      current: () => sim.tick,
      closed: () => closed.current,
      step: () => {
        step(sim, feed.inputsFor(sim.tick + 1));
        if (sim.events.length) onEvents(sim.events);
        if (sim.status === 'dead' || sim.status === 'extracted') {
          loop.stop();
          setEnding(sim.status === 'extracted' ? 'extracted' : 'died');
        }
      },
      render: (alpha) => {
        sendInput();
        stageRef.current?.render(sim, sim.status === 'running' ? alpha : 1);
      },
    });
    loopRef.current = loop;
    const canvas = canvasRef.current!;
    const fit = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(1, Math.floor(box?.width || window.innerWidth || 1280));
      const h = Math.max(1, Math.floor(box?.height || window.innerHeight || 720));
      canvas.width = w;
      canvas.height = h;
      stageRef.current?.resize(w, h);
      setSize({ w, h });
    };
    const biome = start.content.sectors.find((s) => s.id === start.sector)?.biome ?? 'nebula';
    void createStage(canvas, start.content, {
      reduced,
      vision: relicVision(sim, sim.probes[slot]!),
      probe: slot,
      seed: start.seed,
      biome,
      names: start.players.map((p) => p.username),
    }).then((stage) => {
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
    // The run is fixed for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The HUD a few times per second; friends see the layer.
  useEffect(() => {
    const id = setInterval(() => {
      const h = hudSnapshot(sim, slot);
      hudRef.current = h;
      setHud(h);
      watch(spectateTarget(h, slot, watchingRef.current));
      setCamera(stageRef.current?.camera() ?? null);
      setBehind(loopRef.current?.behind() ?? 0);
    }, HUD_EVERY_MS);
    return () => clearInterval(id);
  }, [sim, slot, watch]);
  useEffect(() => {
    useLive.getState().setRun({ layer: hud.layer });
  }, [hud.layer]);
  useEffect(() => () => useLive.getState().setRun(null), []);

  // The end: the world's last moment, then what I was paid.
  useEffect(() => {
    if (!ending) return;
    const id = setTimeout(() => setShowResult(true), END_DELAY_MS);
    return () => clearTimeout(id);
  }, [ending]);

  /** A quick mark at a screen point: to the world through the camera (my probe's place without one). */
  const sendMark = useCallback(
    (kind: CoopMark, at: { x: number; y: number }) => {
      const cam = stageRef.current?.camera();
      const rect = canvasRef.current?.getBoundingClientRect();
      const me = sim.probes[slot];
      const p = cam && rect ? toWorld(cam, rect, at) : { x: me?.x ?? 0, y: me?.y ?? 0 };
      const clamp = (v: number) => Math.max(-1_000_000, Math.min(1_000_000, Math.round(v)));
      send({ t: 'mark', kind, x: clamp(p.x), y: clamp(p.y) });
    },
    [send, sim, slot],
  );

  // Keyboard and mouse; nothing pauses: Escape or P open the menu over the running world. Q: the quick marks.
  useEffect(() => {
    const pointer = () => input.current.mouse ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'KeyQ') {
        if (!e.repeat && !wheelRef.current && sim.probes[slot]?.life !== 'left') {
          const at = pointer();
          wheelRef.current = { x: at.x, y: at.y, choice: 'here' };
          setWheel(wheelRef.current);
        }
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        setMenu((m) => !m);
        return;
      }
      input.current.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyQ' && wheelRef.current) {
        const w = wheelRef.current;
        const p = pointer();
        sendMark(markFrom(p.x - w.x, p.y - w.y), w);
        wheelRef.current = null;
        setWheel(null);
        return;
      }
      input.current.keys.delete(e.code);
    };
    const move = (e: MouseEvent) => {
      input.current.mouse = { x: e.clientX, y: e.clientY };
      const w = wheelRef.current;
      if (w) {
        const choice = markFrom(e.clientX - w.x, e.clientY - w.y);
        if (choice !== w.choice) {
          wheelRef.current = { ...w, choice };
          setWheel(wheelRef.current);
        }
      }
    };
    // No focus (another window, a hidden tab): idle at once, the frames stop until it comes back.
    const idle = () => {
      input.current.keys.clear();
      input.current.pad = null;
      sendInput();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') idle();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('blur', idle);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('blur', idle);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [sendInput, sendMark, sim, slot]);

  // Gamepad: the left stick moves, the right one aims.
  useEffect(() => {
    let raf = 0;
    const poll = () => {
      const pad = typeof navigator.getGamepads === 'function' ? navigator.getGamepads()[0] : null;
      if (pad) input.current.pad = { x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0, rx: pad.axes[2] ?? 0, ry: pad.axes[3] ?? 0 };
      raf = requestAnimationFrame(poll);
    };
    if (typeof requestAnimationFrame === 'function' && typeof navigator.getGamepads === 'function') raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pick = useCallback(
    (i: number, seq: number) => {
      setPicked(seq);
      send({ t: 'pick', i, seq });
    },
    [send],
  );

  // The run ended or the server restarted while I was away: nothing more will come. Back to the room.
  if (link === 'gone' && !result) {
    return (
      <div className="results sending" role="alert">
        <p>{t.gone}</p>
        <button type="button" className="lip pill pill-solar" onClick={onExit}>
          {t.back}
        </button>
      </div>
    );
  }
  if (showResult && result) {
    return result.result ? (
      <ResultsScreen result={result.result} onAgain={onExit} team={<TeamResults rows={teamRows(sim, start)} me={slot} />} />
    ) : (
      <div className="results sending" role="status">
        <p>{t.noResult}</p>
        <button type="button" className="lip pill pill-solar" onClick={onExit}>
          {t.back}
        </button>
      </div>
    );
  }
  const offer = hud.offer && hud.coop?.pickLeft != null && picked !== hud.coop.offerSeq;
  return (
    <div className={`arena coop-arena${reduced ? ' reduced' : ''}`}>
      <canvas ref={canvasRef} className="arena-canvas" aria-label={copy.arena.loading} />
      <Hud hud={hud} content={start.content} onPause={() => setMenu(true)} announce={announce} />
      <TeamPanel hud={hud} players={start.players} slot={slot} />
      {hud.boss && <BossBar boss={hud.boss} />}
      {hud.beacon && <BeaconMarker beacon={hud.beacon} camera={camera} width={size.w} height={size.h} />}
      <CoopMarks marks={marks} camera={camera} width={size.w} height={size.h} players={start.players} me={slot} />
      {wheel ? <MarkWheel at={wheel} choice={wheel.choice} /> : null}
      <LifeNotice hud={hud} downSeconds={start.rules.downSeconds} />
      {watching !== null && !ending ? <SpectateBar hud={hud} players={start.players} me={slot} watching={watching} onWatch={watch} /> : null}
      {offer && !ending ? <CoopCards hud={hud} content={start.content} pickSeconds={start.rules.pickSeconds} onPick={pick} /> : null}
      {link === 'lost' ? (
        <p className="coop-arena-status" role="status">
          {t.lost}
        </p>
      ) : behind > 30 && !ending ? (
        <p className="coop-arena-status" role="status">
          {t.catchingUp}
        </p>
      ) : null}
      {ending && (
        <div className={`arena-ending ${ending}`} role="status">
          <b>{copy.arena.ending[ending]}</b>
          {showResult && !result ? <small>{t.waitResult}</small> : null}
        </div>
      )}
      {menu && !ending && (
        <PauseMenu
          title={t.menu}
          abandonBody={t.abandonBody}
          manualAim={manualAim}
          onManualAim={(on) => {
            aimRef.current = on;
            setManualAim(on);
            setAim(on);
          }}
          onResume={() => setMenu(false)}
          onAbandon={onAbandon}
        />
      )}
    </div>
  );
}
