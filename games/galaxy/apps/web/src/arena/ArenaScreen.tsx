import type { RunStart } from '@galaxy/shared';
import { createSim, encodeLog, hudSnapshot, type HudSnapshot, relicVision, runSummary, type RunSummary, type Sim, type SimEvent, step, toBase64 } from '@galaxy/sim';
import { useCallback, useEffect, useRef, useState } from 'react';
import { copy } from '../copy/es';
import { useReducedMotion } from '../ui/motion';
import { announceFor } from './announce';
import { playEvents } from './arena-sfx';
import { BeaconMarker, BossBar, Radio } from './hud/Overlays';
import { Hud } from './hud/Hud';
import { LevelUp } from './hud/LevelUp';
import { PauseMenu } from './hud/PauseMenu';
import { emptyInput, readInput } from './input';
import { createLoop, type Loop } from './loop';
import { manualAim as storedAim, markRadioSeen, radioSeen, setManualAim } from './settings';
import type { Camera } from './stage/camera';
import { createStage, type Stage } from './stage/stage';

// A run in the browser (GDD §5.1–5.2): the simulation stepped at 60 Hz by a fixed-step loop, drawn by the PixiJS
// stage, with the React HUD on top. Pause with Escape, P or Start, and automatically when the tab hides or the
// window loses focus. When the run ends the result (with the recorded inputs) is handed over at once to be kept
// (onSave), and the screen changes a moment later (onEnd).

export interface RunEnd {
  outcome: 'extracted' | 'died' | 'abandoned';
  summary: RunSummary;
  /** The recorded inputs, base64 (packages/sim encodeLog). */
  inputs: string;
}

interface Clock {
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
}

const HUD_EVERY_MS = 100;
const END_DELAY_MS = 1500;
const RADIO_MS = 7000;

const browserClock: Clock = { now: () => performance.now(), schedule: (cb) => requestAnimationFrame(cb) };

export function ArenaScreen({
  run,
  onEnd,
  onSave,
  clock = browserClock,
  onSim,
}: {
  run: RunStart;
  onEnd: (end: RunEnd) => void;
  /** Called the moment the run ends, before the ending screen: keep the result so a reload never loses it. */
  onSave?: (end: RunEnd) => void;
  clock?: Clock;
  onSim?: (sim: Sim) => void;
}) {
  const [sim] = useState(() =>
    createSim({ seed: run.seed, content: run.content, sector: run.sector, probes: [{ probe: run.probe, relics: run.relics }], record: true }),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const loopRef = useRef<Loop | null>(null);
  const input = useRef(emptyInput());
  /** A level-up pick, with the offer it was made on: it only counts while that offer is still the open one. */
  const pick = useRef<{ index: number; offer: HudSnapshot['offer'] } | null>(null);
  const shownOffer = useRef<HudSnapshot['offer']>(null);
  const seenReactions = useRef(new Set<string>());
  const ended = useRef(false);
  const reduced = useReducedMotion();
  const [hud, setHud] = useState<HudSnapshot>(() => hudSnapshot(sim, 0));
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [paused, setPaused] = useState(false);
  const [manualAim, setAim] = useState(storedAim);
  const aimRef = useRef(manualAim);
  // PERKINS's first line, unless this player has heard it (marked as heard once shown, below).
  // The first run ever explains the controls; after that, a new sector introduces itself once.
  const [radio, setRadio] = useState<string | null>(() => {
    if (!radioSeen('start')) return copy.arena.radio.start;
    const intro = copy.arena.radio.sectors[run.sector];
    return intro && !radioSeen(`sector:${run.sector}`) ? intro : null;
  });
  const [over, setOver] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [ending, setEnding] = useState<'extracted' | 'died' | null>(null);
  const seen = useRef({ level: 1, boss: false, beacon: false, layer: 1, low: false });

  useEffect(() => {
    onSim?.(sim);
  }, [onSim, sim]);

  useEffect(() => {
    shownOffer.current = hud.offer;
  }, [hud.offer]);

  const handlers = useRef({ onEnd, onSave });
  useEffect(() => {
    handlers.current = { onEnd, onSave };
  });
  /** Builds the result, hands it over to be kept, and ends the screen now or after `delay` ms. */
  const finish = useCallback(
    (outcome: RunEnd['outcome'], delay = 0) => {
      const end: RunEnd = { outcome, summary: runSummary(sim), inputs: toBase64(encodeLog(sim.log ?? { probes: 1, events: [] })) };
      handlers.current.onSave?.(end);
      if (delay > 0) setTimeout(() => handlers.current.onEnd(end), delay);
      else handlers.current.onEnd(end);
    },
    [sim],
  );
  const choose = useCallback((i: number) => {
    pick.current = { index: i, offer: shownOffer.current };
  }, []);

  const say = useCallback((id: string, text: string) => {
    if (radioSeen(id)) return;
    markRadioSeen(id);
    setRadio(text);
  }, []);

  const pause = useCallback(() => {
    if (ended.current || sim.status === 'choosing') return;
    loopRef.current?.pause();
    setPaused(true);
  }, [sim]);
  const resume = useCallback(() => {
    loopRef.current?.resume();
    setPaused(false);
  }, []);

  // The world: stage, loop and the simulation's events.
  useEffect(() => {
    let disposed = false;
    const onEvents = (events: readonly SimEvent[]) => {
      stageRef.current?.feed(events);
      playEvents(events);
      const said = announceFor(events, run.content, seenReactions.current);
      if (said) setAnnounce(said);
      for (const e of events) {
        if (e.t === 'bossSpawn') {
          const line = copy.arena.radio.bosses[e.boss];
          if (line) say(`boss:${e.boss}`, line);
          else say('boss', copy.arena.radio.boss);
        }
        else if (e.t === 'beaconOpen') say('beacon', copy.arena.radio.beacon);
        else if (e.t === 'layer') say('layer', copy.arena.radio.layer(e.layer));
      }
    };
    const loop = createLoop({
      now: clock.now,
      schedule: clock.schedule,
      step: () => {
        const cam = stageRef.current?.camera();
        const rect = canvasRef.current?.getBoundingClientRect();
        const aimFrom = cam && rect ? { x: rect.left + cam.bars + (cam.worldW * cam.zoom) / 2, y: rect.top + rect.height / 2 } : undefined;
        const i = readInput(input.current, { manualAim: aimRef.current }, aimFrom);
        if (pick.current) {
          // A quick second Enter belongs to the offer on screen; once the simulation has moved on, it is dropped.
          if (pick.current.offer === sim.probes[0]?.offer) i.pick = pick.current.index;
          pick.current = null;
        }
        step(sim, [i]);
        if (sim.events.length) onEvents(sim.events);
        if ((sim.status === 'dead' || sim.status === 'extracted') && !ended.current) {
          ended.current = true;
          const outcome = sim.status === 'extracted' ? 'extracted' : 'died';
          setEnding(outcome);
          finish(outcome, END_DELAY_MS);
        }
      },
      render: (alpha) => stageRef.current?.render(sim, sim.status === 'running' ? alpha : 1),
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
    const biome = run.content.sectors.find((s) => s.id === run.sector)?.biome ?? 'nebula';
    void createStage(canvas, run.content, { reduced, vision: relicVision(sim, sim.probes[0]!), probe: 0, seed: run.seed, biome }).then((stage) => {
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

  // The HUD reads the simulation a few times per second.
  useEffect(() => {
    const id = setInterval(() => {
      const h = hudSnapshot(sim, 0);
      setHud(h);
      setCamera(stageRef.current?.camera() ?? null);
      const s = seen.current;
      if (h.level > s.level) setAnnounce(copy.arena.announce.level(h.level));
      else if (h.boss && !s.boss) setAnnounce(copy.arena.announce.boss(h.boss.name));
      else if (h.beacon && !s.beacon) setAnnounce(copy.arena.announce.beacon);
      else if (h.layer > s.layer) setAnnounce(copy.arena.announce.layer(h.layer));
      else if (h.hp <= h.maxHp * 0.3 && !s.low) setAnnounce(copy.arena.announce.lowHp);
      seen.current = { level: h.level, boss: !!h.boss, beacon: !!h.beacon, layer: h.layer, low: h.hp <= h.maxHp * 0.3 };
    }, HUD_EVERY_MS);
    return () => clearInterval(id);
  }, [sim]);

  useEffect(() => {
    if (radio === copy.arena.radio.start) markRadioSeen('start');
    else if (radio && radio === copy.arena.radio.sectors[run.sector]) markRadioSeen(`sector:${run.sector}`);
  }, [radio, run.sector]);

  useEffect(() => {
    if (!radio) return;
    const id = setTimeout(() => setRadio(null), RADIO_MS);
    return () => clearTimeout(id);
  }, [radio]);

  // Keyboard, mouse and the reasons to pause.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (sim.status === 'choosing') return;
        if (loopRef.current?.paused) resume();
        else pause();
        return;
      }
      input.current.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => input.current.keys.delete(e.code);
    const move = (e: MouseEvent) => {
      input.current.mouse = { x: e.clientX, y: e.clientY };
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    const blur = () => {
      input.current.keys.clear();
      pause();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (!ended.current) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('blur', blur);
    window.addEventListener('beforeunload', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('blur', blur);
      window.removeEventListener('beforeunload', leave);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [pause, resume, sim]);

  // Gamepad: left stick moves, right stick aims (manual aim), Start pauses, A picks the highlighted upgrade.
  useEffect(() => {
    let raf = 0;
    let startWas = false;
    const poll = () => {
      const pad = typeof navigator.getGamepads === 'function' ? navigator.getGamepads()[0] : null;
      if (pad) {
        input.current.pad = { x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0, rx: pad.axes[2] ?? 0, ry: pad.axes[3] ?? 0 };
        const start = pad.buttons[9]?.pressed ?? false;
        if (start && !startWas) {
          if (loopRef.current?.paused) resume();
          else pause();
        }
        startWas = start;
      }
      raf = requestAnimationFrame(poll);
    };
    if (typeof requestAnimationFrame === 'function' && typeof navigator.getGamepads === 'function') raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [pause, resume]);

  const choosing = hud.status === 'choosing' && hud.offer && !paused;
  return (
    <div className={`arena${reduced ? ' reduced' : ''}`}>
      <canvas ref={canvasRef} className="arena-canvas" aria-label={copy.arena.loading} />
      <Hud hud={hud} content={run.content} onPause={pause} announce={announce} />
      {hud.boss && <BossBar boss={hud.boss} />}
      {hud.beacon && <BeaconMarker beacon={hud.beacon} camera={camera} width={size.w} height={size.h} />}
      {radio && <Radio text={radio} onClose={() => setRadio(null)} />}
      {ending && (
        <div className={`arena-ending ${ending}`} role="status">
          <b>{copy.arena.ending[ending]}</b>
        </div>
      )}
      {choosing && (
        <LevelUp offer={hud.offer!} content={run.content} onPick={choose} />
      )}
      {paused && !over && !ending && (
        <PauseMenu
          manualAim={manualAim}
          onManualAim={(on) => {
            aimRef.current = on;
            setManualAim(on);
            setAim(on);
          }}
          onResume={resume}
          onAbandon={() => {
            ended.current = true;
            setOver(true);
            loopRef.current?.stop();
            finish('abandoned');
          }}
        />
      )}
    </div>
  );
}

export default ArenaScreen;
