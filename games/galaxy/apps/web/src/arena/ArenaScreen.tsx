import { simOptions } from './sim-options';
import type { RunStart } from '@galaxy/shared';
import {
  createSim,
  debugClear,
  debugEvent,
  type DebugGrant,
  debugGrant,
  debugHeal,
  debugLevelUp,
  type DebugResult,
  type EventKind,
  debugSkipLayer,
  debugSummonCore,
  encodeLog,
  hudSnapshot,
  type HudSnapshot,
  relicVision,
  runSummary,
  type RunSummary,
  setGod,
  type Sim,
  type SimEvent,
  step,
  toBase64,
} from '@galaxy/sim';
import { useCallback, useEffect, useRef, useState } from 'react';
import { musicStinger, setMusicScene, startMusic } from '../audio/music';
import { deepLayer, runScene } from '../audio/music/state';
import { emitTour } from '../tour/bus';
import { Briefing } from './hud/Briefing';
import { copy } from '../copy/es';
import { useReducedMotion } from '../ui/motion';
import { announceFor } from './announce';
import { playEvents } from './arena-sfx';
import { coreRadio, sectorRadio } from '../codex/texts';
import { BeaconMarker, BossBar, EventMarkers, Radio } from './hud/Overlays';
import { Hud } from './hud/Hud';
import { LevelUp } from './hud/LevelUp';
import { PauseMenu } from './hud/PauseMenu';
import { DASH_BUTTONS, dashWaits, emptyInput, mouseCode, pointerAngle, readInput } from './input';
import { actionOf, isAction, keyLabels } from '../settings/keybinds';
import { createLoop, type Loop } from './loop';
import { arenaZoom, manualAim as storedAim, markRadioSeen, radioSeen, setManualAim } from './settings';
import { useWheelZoom } from './zoom';
import type { Camera } from './stage/camera';
import { createStage, type Stage } from './stage/stage';
import { useUi } from '../state/ui';
import { typing } from '../ui/keys';
import { useLive } from '../live/LiveConnection';
import { createRunStream, type RunStream } from './run-stream';
import { usePrefs } from '../settings/prefs';
import { Dialog } from '../ui/Dialog';
import { DebugInfo } from './debug/DebugInfo';
import { DebugPanel } from './debug/DebugPanel';
import { createRates } from './debug/rates';
import { createNoticeQueue, noticesFor, type RunNotice as Notice } from './notices';
import { RunNotice } from './hud/RunNotice';

// A run in the browser (GDD §5.1–5.2): the simulation stepped at 60 Hz by a fixed-step loop, drawn by the PixiJS
// stage, with the React HUD on top. Pause with Escape, P or Start, and automatically when the tab hides or the
// window loses focus. When the run ends the result (with the recorded inputs) is handed over at once to be kept
// (onSave), and the screen changes a moment later (onEnd).

export interface RunEnd {
  outcome: 'extracted' | 'died' | 'abandoned';
  summary: RunSummary;
  /** The recorded inputs, base64 (packages/sim encodeLog). */
  inputs: string;
  /** A test run of the admin debug mode (2026-11-15): the finish says so and nothing is paid. */
  test?: boolean;
}

/**
 * The admin debug mode (2026-11-15), solo runs only: an admin with TOTP gets the side panel (F2 or the pause menu). The
 * first change to play turns the run into a test run on the server (`markTest`) before it applies.
 */
export interface ArenaDebug {
  /** Already a test run (a content draft starts as one). */
  test: boolean;
  /** The run plays a content draft (not published). */
  draft: boolean;
  markTest: () => Promise<void>;
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
  coached = false,
  onSkipTutorial,
  debug,
}: {
  run: RunStart;
  onEnd: (end: RunEnd) => void;
  /** Called the moment the run ends, before the ending screen: keep the result so a reload never loses it. */
  onSave?: (end: RunEnd) => void;
  clock?: Clock;
  onSim?: (sim: Sim) => void;
  /** The tutorial's first run (polish phase 3): it waits behind a briefing and PERKINS coaches it. */
  coached?: boolean;
  onSkipTutorial?: () => void;
  /** The admin debug mode (2026-11-15); absent for everyone else. */
  debug?: ArenaDebug;
}) {
  const [sim] = useState(() => createSim(simOptions(run)));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  useWheelZoom(canvasRef, stageRef);
  const loopRef = useRef<Loop | null>(null);
  const input = useRef(emptyInput());
  /** A level-up pick, with the offer it was made on: it only counts while that offer is still the open one. */
  const pick = useRef<{ index: number; offer: HudSnapshot['offer'] } | null>(null);
  const shownOffer = useRef<HudSnapshot['offer']>(null);
  const seenReactions = useRef(new Set<string>());
  const ended = useRef(false);
  const reduced = useReducedMotion();
  const colorVision = usePrefs((p) => p.colorVision);
  const probeGlow = usePrefs((p) => p.probeGlow);
  // Centre-screen notices (2026-11-16): the run's moments, one at a time; the run's settings turn them off.
  const runNotices = usePrefs((p) => p.runNotices);
  const [notices] = useState(createNoticeQueue);
  const [centre, setCentre] = useState<Notice | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(() => hudSnapshot(sim, 0));
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [paused, setPaused] = useState(false);
  // The music reads it a few times a second (plan «banda sonora»).
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const [manualAim, setAim] = useState(storedAim);
  const aimRef = useRef(manualAim);
  // PERKINS's first line, unless this player has heard it (marked as heard once shown, below).
  // The first run ever explains the controls; after that, a new sector introduces itself once.
  const [radio, setRadio] = useState<string | null>(() => {
    if (!radioSeen('start')) return copy.arena.radio.start;
    const intro = sectorRadio(run.content, run.sector);
    return intro && !radioSeen(`sector:${run.sector}`) ? intro : null;
  });
  const [over, setOver] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [ending, setEnding] = useState<'extracted' | 'died' | null>(null);
  const seen = useRef({ level: 1, boss: false, beacon: false, layer: 1, low: false });
  const [briefing, setBriefing] = useState(coached);
  const coachRef = useRef(coached);
  const [coaching, setCoaching] = useState(coached);
  const briefingRef = useRef(coached);
  const radioRef = useRef<string | null>(null);
  useEffect(() => {
    radioRef.current = radio;
  }, [radio]);
  // The tour's first run starts here (polish phase 3).
  useEffect(() => emitTour('run:started'), []);
  // Friends see «in a run, layer N» while it lasts (plan phase 3).
  useEffect(() => {
    useLive.getState().setRun({ layer: hud.layer });
  }, [hud.layer]);
  useEffect(() => () => useLive.getState().setRun(null), []);

  useEffect(() => {
    onSim?.(sim);
  }, [onSim, sim]);

  // The admin debug mode (2026-11-15).
  const debugRef = useRef(debug);
  useEffect(() => {
    debugRef.current = debug;
  });
  const [debugOpen, setDebugOpen] = useState(false);
  const isTestRef = useRef(debug?.test ?? false);
  const [isTest, setIsTest] = useState(debug?.test ?? false);
  const [speed, setSpeedState] = useState(1);
  const speedRef = useRef(1);
  const [hitboxes, setHitboxes] = useState(false);
  const [info, setInfo] = useState(false);
  const [god, setGodState] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<DebugGrant | null>(null);
  /** The change waiting for the admin to confirm the test run, and whether the run was going when it was asked. */
  const [asking, setAsking] = useState<{ act: () => void; resume: boolean; id: number } | null>(null);
  const askingRef = useRef(false);
  /** Each question is numbered: a cancelled one's late answer is not applied; a confirm runs once. */
  const askSeq = useRef(0);
  const confirmingRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    askingRef.current = asking !== null;
  }, [asking]);
  const [rates] = useState(createRates);
  /** The latest handler of the simulation's events (the world's effect sets it), for what the debug actions push. */
  const onEventsRef = useRef<((events: readonly SimEvent[]) => void) | null>(null);

  useEffect(() => {
    shownOffer.current = hud.offer;
  }, [hud.offer]);

  const handlers = useRef({ onEnd, onSave });
  useEffect(() => {
    handlers.current = { onEnd, onSave };
  });
  // Plan «escáner pro», part G: the run streams its log live, for staff to watch; it never gets in the run's way.
  const streamRef = useRef<RunStream | null>(null);
  useEffect(() => {
    // A test run is not watched live (its clock no longer follows the wall's): a content draft starts as one.
    if (debug?.test) return;
    const stream = createRunStream({
      runId: run.id,
      log: () => sim.log,
      tick: () => sim.tick,
      state: () => (loopRef.current?.paused ? 'pause' : sim.status === 'choosing' ? 'pick' : 'run'),
    });
    streamRef.current = stream;
    return () => stream.close();
    // The debug mode is fixed for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, sim]);
  /** Builds the result, hands it over to be kept, and ends the screen now or after `delay` ms. */
  const finish = useCallback(
    (outcome: RunEnd['outcome'], delay = 0) => {
      streamRef.current?.end();
      const end: RunEnd = { outcome, summary: runSummary(sim), inputs: toBase64(encodeLog(sim.log ?? { probes: 1, events: [] })), ...(isTestRef.current ? { test: true } : {}) };
      handlers.current.onSave?.(end);
      if (delay > 0) setTimeout(() => handlers.current.onEnd(end), delay);
      else handlers.current.onEnd(end);
    },
    [sim],
  );
  const choose = useCallback((i: number) => {
    pick.current = { index: i, offer: shownOffer.current };
  }, []);
  // A dash asked for (SHIFT, Space, the pad's A or RB; SIM 1.12.0): it goes with the next world tick.
  const dashAsked = useRef(false);
  const askDash = useCallback(() => {
    if (sim.status === 'running' && !loopRef.current?.paused && !briefingRef.current) dashAsked.current = true;
  }, [sim]);

  const say = useCallback((id: string, text: string) => {
    if (radioSeen(id)) return;
    markRadioSeen(id);
    setRadio(text);
  }, []);

  const pause = useCallback(() => {
    // While the debug mode asks about the test run, the question is the pause (2026-11-16).
    if (ended.current || sim.status === 'choosing' || askingRef.current) return;
    dashAsked.current = false;
    loopRef.current?.pause();
    setPaused(true);
  }, [sim]);
  const resume = useCallback(() => {
    loopRef.current?.resume();
    setPaused(false);
  }, []);

  // The admin debug mode (2026-11-15). A change to play applies at once in a test run; the first one asks, pauses the
  // run while it asks, and applies only once the server has made it a test run.
  const gated = useCallback((act: () => void) => {
    if (!debugRef.current) return;
    if (isTestRef.current) {
      act();
      return;
    }
    const going = !(loopRef.current?.paused ?? false);
    loopRef.current?.pause();
    askSeq.current++;
    setAsking({ act, resume: going, id: askSeq.current });
  }, []);
  const settleAsk = useCallback((a: { resume: boolean }) => {
    setAsking(null);
    if (a.resume && !pausedRef.current) loopRef.current?.resume();
  }, []);
  const cancelAsk = useCallback(
    (a: { resume: boolean }) => {
      askSeq.current++;
      settleAsk(a);
    },
    [settleAsk],
  );
  const confirmTest = useCallback(async () => {
    const a = asking;
    const d = debugRef.current;
    if (!a || !d || confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      await d.markTest();
    } catch {
      if (askSeq.current === a.id) {
        setNotice(copy.arena.debug.failed);
        settleAsk(a);
      }
      return;
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
    // The server made it a test run: so is it here, even if the question was cancelled meanwhile.
    isTestRef.current = true;
    setIsTest(true);
    streamRef.current?.end();
    if (askSeq.current !== a.id) return;
    a.act();
    settleAsk(a);
  }, [asking, settleAsk]);
  /** Runs a debug helper and hands what it pushed to the stage, the sounds and the HUD at once. */
  const apply = useCallback(
    (fn: () => DebugResult): DebugResult => {
      const from = sim.events.length;
      const r = fn();
      if (sim.events.length > from) onEventsRef.current?.(sim.events.slice(from));
      setHud(hudSnapshot(sim, 0));
      return r;
    },
    [sim],
  );
  const report = useCallback((r: DebugResult) => setNotice(r === 'ok' ? null : (copy.arena.debug.results[r] ?? null)), []);
  const debugActions = {
    speed: (s: number) => {
      const set = () => {
        loopRef.current?.setSpeed(s);
        speedRef.current = s;
        setSpeedState(s);
      };
      if (s === 1) set();
      else gated(set);
    },
    hitboxes: (on: boolean) => {
      setHitboxes(on);
      stageRef.current?.setDebug({ hitboxes: on });
    },
    god: (on: boolean) =>
      gated(() => {
        setGod(sim, on);
        setGodState(on);
      }),
    level: (n: number) => gated(() => report(apply(() => debugLevelUp(sim, 0, n)))),
    heal: () => gated(() => report(apply(() => debugHeal(sim, 0)))),
    clear: () => gated(() => report(apply(() => debugClear(sim)))),
    core: () => gated(() => report(apply(() => debugSummonCore(sim)))),
    layer: () => gated(() => report(apply(() => debugSkipLayer(sim)))),
    event: (kind: EventKind) => gated(() => report(apply(() => debugEvent(sim, kind)))),
    grant: (g: DebugGrant) =>
      gated(() => {
        const r = apply(() => debugGrant(sim, 0, g));
        if (r === 'slots_full' && g.replace === undefined) {
          setReplacing(g);
          setNotice(null);
          return;
        }
        setReplacing(null);
        const name = (g.kind === 'passive' ? run.content.passives : run.content.weapons).find((x) => x.id === g.id)?.name ?? g.id;
        setNotice(r === 'ok' ? copy.arena.debug.given(name) : (copy.arena.debug.results[r] ?? null));
      }),
  };

  // The world: stage, loop and the simulation's events.
  useEffect(() => {
    let disposed = false;
    const onEvents = (events: readonly SimEvent[]) => {
      stageRef.current?.feed(events, sim.tick);
      // Above x2 the effects would be a din: the debug mode mutes them.
      if (speedRef.current <= 2) playEvents(events);
      if (debugRef.current) rates.onEvents(events, sim.tick);
      const said = announceFor(events, run.content, seenReactions.current);
      if (said) setAnnounce(said);
      notices.push(noticesFor(events, 0, run.content, sim.sector.id), Date.now());
      for (const e of events) {
        if (e.t === 'layer') musicStinger('layer');
        if (e.t === 'extracted') musicStinger('extract');
        if (e.t === 'bossSpawn') {
          const line = coreRadio(run.content, e.boss);
          if (line) say(`boss:${e.boss}`, line);
          else say('boss', copy.arena.radio.boss);
        }
        else if (e.t === 'beaconOpen') say('beacon', copy.arena.radio.beacon);
        else if (e.t === 'satellite' && e.what === 'appear') say('satellite', copy.arena.radio.satellite);
        else if (e.t === 'worldEvent' && e.what === 'appear') say(`event:${e.kind}`, copy.arena.radio.events[e.kind]);
        else if (e.t === 'layer') say('layer', copy.arena.radio.layer(e.layer));
      }
    };
    onEventsRef.current = onEvents;
    const loop = createLoop({
      now: clock.now,
      schedule: clock.schedule,
      step: () => {
        const cam = stageRef.current?.camera();
        const rect = canvasRef.current?.getBoundingClientRect();
        const aimFrom = cam && rect ? { x: rect.left + cam.bars + (cam.worldW * cam.zoom) / 2, y: rect.top + rect.height / 2 } : undefined;
        const i = readInput(input.current, { manualAim: aimRef.current }, aimFrom);
        // A press a moment early (the pause between two dashes) waits for it; otherwise it goes now. One left from
        // before the cards opened is dropped (the pause menu drops it too).
        if (sim.status !== 'running') dashAsked.current = false;
        if (dashAsked.current && !dashWaits(sim.probes[0]?.dash)) {
          dashAsked.current = false;
          if (sim.status === 'running') i.dash = pointerAngle(input.current, aimFrom);
        }
        if (pick.current) {
          // A quick second Enter belongs to the offer on screen; once the simulation has moved on, it is dropped.
          if (pick.current.offer === sim.probes[0]?.offer) i.pick = pick.current.index;
          pick.current = null;
        }
        step(sim, [i]);
        if (sim.events.length) onEvents(sim.events);
        if ((sim.status === 'dead' || sim.status === 'extracted') && !ended.current) {
          ended.current = true;
          if (sim.status === 'dead') musicStinger('death');
          const outcome = sim.status === 'extracted' ? 'extracted' : 'died';
          setEnding(outcome);
          finish(outcome, END_DELAY_MS);
        }
      },
      render: (alpha) => {
        if (debugRef.current) rates.onFrame(clock.now());
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
    const biome = run.content.sectors.find((s) => s.id === run.sector)?.biome ?? 'nebula';
    void createStage(canvas, run.content, { reduced, colorVision, probeGlow, vision: relicVision(sim, sim.probes[0]!), probe: 0, seed: run.seed, biome, zoom: arenaZoom(), skins: [run.skin] }).then((stage) => {
      if (disposed) {
        stage.destroy();
        return;
      }
      stageRef.current = stage;
      fit();
      loop.start();
      // The tutorial's run waits behind its briefing.
      if (coachRef.current) loop.pause();
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

  // Ajustes → Movimiento can change from the pause: the stage follows without restarting the run.
  useEffect(() => stageRef.current?.setReduced(reduced), [reduced]);
  useEffect(() => stageRef.current?.setColorVision(colorVision), [colorVision]);
  useEffect(() => stageRef.current?.setProbeGlow(probeGlow), [probeGlow]);

  // The HUD reads the simulation a few times per second.
  useEffect(() => {
    const id = setInterval(() => {
      const h = hudSnapshot(sim, 0);
      setHud(h);
      setCentre(notices.current(Date.now()));
      setCamera(stageRef.current?.camera() ?? null);
      const s = seen.current;
      if (h.level > s.level) setAnnounce(copy.arena.announce.level(h.level));
      else if (h.boss && !s.boss) setAnnounce(copy.arena.announce.boss(h.boss.name));
      else if (h.beacon && !s.beacon) setAnnounce(copy.arena.announce.beacon);
      else if (h.layer > s.layer) setAnnounce(copy.arena.announce.layer(h.layer));
      else if (h.hp <= h.maxHp * 0.3 && !s.low) setAnnounce(copy.arena.announce.lowHp);
      seen.current = { level: h.level, boss: !!h.boss, beacon: !!h.beacon, layer: h.layer, low: h.hp <= h.maxHp * 0.3 };
      // The first level-up ever (M7c): PERKINS says what it is, once.
      if (h.offer) say('levelup', copy.arena.radio.levelup);
      // The tutorial's coaching (polish phase 3): one line at a time, never over another, each once.
      if (coachRef.current && !radioRef.current) {
        const c = copy.tour.coach;
        const line: [string, string] | null =
          h.hp <= h.maxHp * 0.3 && !radioSeen('coach:lowhp') ? ['coach:lowhp', c.lowHp]
          : !radioSeen('coach:move') ? ['coach:move', c.move(keyLabels())]
          : h.kills >= 3 && !radioSeen('coach:gems') ? ['coach:gems', c.gems]
          : h.kills >= 12 && !radioSeen('coach:dash') ? ['coach:dash', c.dash(keyLabels())]
          : h.kills >= 25 && !radioSeen('coach:loot') ? ['coach:loot', c.loot]
          : h.phase === 'waves' && h.layer === 1 && h.phaseLeft <= 60 && !radioSeen('coach:boss') ? ['coach:boss', c.boss]
          : null;
        if (line) say(line[0], line[1]);
      }
      // The music follows the run (plan «banda sonora»): the sector's piece, its intensity, the Núcleo's, a choice.
      const scene = runScene({ hp: h.hp, maxHp: h.maxHp, phase: h.phase, layer: h.layer, status: h.status, boss: h.boss ? { phase: h.boss.phase } : null }, sim.sector.biome, deepLayer(sim), pausedRef.current);
      if (scene) setMusicScene(scene);
    }, HUD_EVERY_MS);
    startMusic();
    return () => {
      clearInterval(id);
      setMusicScene({ kind: 'menu' });
    };
  }, [sim, say, notices]);

  useEffect(() => {
    if (radio === copy.arena.radio.start) {
      markRadioSeen('start');
      // It says what the tutorial's first coaching line would (polish phase 3).
      markRadioSeen('coach:move');
    } else if (radio && radio === sectorRadio(run.content, run.sector)) markRadioSeen(`sector:${run.sector}`);
  }, [radio, run.sector, run.content]);

  useEffect(() => {
    if (!radio) return;
    const id = setTimeout(() => setRadio(null), RADIO_MS);
    return () => clearTimeout(id);
  }, [radio]);

  // The chat sheet does not come into a run: it would take the keyboard and cover the playfield.
  useEffect(() => useUi.getState().closeChat(), []);

  // Keyboard, mouse and the reasons to pause.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      // The admin debug mode's panel (2026-11-15): F2 opens and closes it.
      if (e.code === 'F2' && debugRef.current) {
        e.preventDefault();
        setDebugOpen((o) => !o);
        return;
      }
      // Escape always pauses; the player's pause key too (Ajustes › Controles).
      if (e.code === 'Escape' || isAction('pause', e.code)) {
        if (sim.status === 'choosing' || briefingRef.current || askingRef.current) return;
        if (loopRef.current?.paused) resume();
        else pause();
        return;
      }
      if (isAction('dash', e.code)) {
        if (!e.repeat) askDash();
        e.preventDefault();
        return;
      }
      input.current.keys.add(e.code);
      // A key of the run (the arrows, Space…) never scrolls the page.
      if (actionOf(e.code) || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    };
    const up = (e: KeyboardEvent) => input.current.keys.delete(e.code);
    // Mouse buttons on the field (never on the HUD's buttons): the dash's (the left click by default), or a move.
    const canvas = canvasRef.current;
    const press = (e: PointerEvent) => {
      const code = mouseCode(e.button);
      if (isAction('dash', code)) {
        askDash();
        e.preventDefault();
      } else if (actionOf(code)) input.current.keys.add(code);
    };
    const release = (e: PointerEvent) => input.current.keys.delete(mouseCode(e.button));
    const noMenu = (e: MouseEvent) => e.preventDefault();
    canvas?.addEventListener('pointerdown', press);
    canvas?.addEventListener('contextmenu', noMenu);
    window.addEventListener('pointerup', release);
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
      canvas?.removeEventListener('pointerdown', press);
      canvas?.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('pointerup', release);
    };
  }, [askDash, pause, resume, sim]);

  // Gamepad: left stick moves, right stick aims (manual aim), Start pauses, A or RB dash (A picks the highlighted
  // upgrade while the cards are up: no dash then).
  useEffect(() => {
    let raf = 0;
    let startWas = false;
    let dashWas = false;
    const poll = () => {
      const pad = typeof navigator.getGamepads === 'function' ? navigator.getGamepads()[0] : null;
      if (pad) {
        input.current.pad = { x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0, rx: pad.axes[2] ?? 0, ry: pad.axes[3] ?? 0 };
        const start = pad.buttons[9]?.pressed ?? false;
        // Start never resumes the run under the debug mode's question.
        if (start && !startWas && !askingRef.current) {
          if (loopRef.current?.paused) resume();
          else pause();
        }
        startWas = start;
        const dash = DASH_BUTTONS.some((b) => pad.buttons[b]?.pressed);
        if (dash && !dashWas) askDash();
        dashWas = dash;
      }
      raf = requestAnimationFrame(poll);
    };
    if (typeof requestAnimationFrame === 'function' && typeof navigator.getGamepads === 'function') raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [askDash, pause, resume]);

  const choosing = hud.status === 'choosing' && hud.offer && !paused;
  return (
    <div className={`arena${reduced ? ' reduced' : ''}`}>
      <canvas ref={canvasRef} className="arena-canvas" aria-label={copy.arena.loading} />
      <Hud hud={hud} content={run.content} onPause={pause} announce={announce} />
      {isTest ? <span className="arena-test-badge">{copy.arena.debug.badge}</span> : null}
      {debug && debugOpen ? (
        <DebugPanel
          content={run.content}
          speed={speed}
          onSpeed={debugActions.speed}
          hitboxes={hitboxes}
          onHitboxes={debugActions.hitboxes}
          info={info}
          onInfo={setInfo}
          god={god}
          onGod={debugActions.god}
          paused={paused}
          onPause={pause}
          onResume={resume}
          choosing={hud.status === 'choosing'}
          test={isTest}
          draft={debug.draft}
          owned={{ weapons: hud.weapons, passives: hud.passives }}
          onLevel={debugActions.level}
          onHeal={debugActions.heal}
          onClear={debugActions.clear}
          onCore={debugActions.core}
          onEvent={debugActions.event}
          onLayer={debugActions.layer}
          onGrant={debugActions.grant}
          replacing={replacing}
          onCancelReplace={() => setReplacing(null)}
          notice={notice}
          onClose={() => setDebugOpen(false)}
        />
      ) : null}
      {debug && info ? <DebugInfo sim={sim} rates={rates} now={clock.now} speed={speed} content={debug.draft ? copy.arena.debug.draft : copy.arena.debug.contentVersion(run.contentVersion)} /> : null}
      {asking ? (
        <Dialog title={copy.arena.debug.confirmTitle} role="alertdialog" onClose={() => cancelAsk(asking)} className="pause confirm">
          <p>{copy.arena.debug.confirmBody}</p>
          <div className="modal-actions">
            <button type="button" className="lip pill" onClick={() => cancelAsk(asking)} data-autofocus>
              {copy.arena.debug.cancel}
            </button>
            <button type="button" className="lip pill pill-solar" disabled={confirming} onClick={() => void confirmTest()}>
              {copy.arena.debug.confirm}
            </button>
          </div>
        </Dialog>
      ) : null}
      {hud.boss && <BossBar boss={hud.boss} />}
      {runNotices && hud.status !== 'choosing' ? <RunNotice notice={centre} /> : null}
      {hud.beacon && <BeaconMarker beacon={hud.beacon} camera={camera} width={size.w} height={size.h} />}
      <EventMarkers hud={hud} sector={sim.sector.id} content={run.content} camera={camera} width={size.w} height={size.h} />
      {radio && <Radio text={radio} onClose={() => setRadio(null)} />}
      {briefing ? (
        <Briefing
          onLaunch={() => {
            briefingRef.current = false;
            setBriefing(false);
            loopRef.current?.resume();
          }}
          onSkip={() => {
            coachRef.current = false;
            setCoaching(false);
            briefingRef.current = false;
            setBriefing(false);
            loopRef.current?.resume();
            onSkipTutorial?.();
          }}
        />
      ) : null}
      {ending && (
        <div className={`arena-ending ${ending}`} role="status">
          <b>{copy.arena.ending[ending]}</b>
        </div>
      )}
      {choosing && (
        <LevelUp offer={hud.offer!} content={run.content} onPick={choose} />
      )}
      {paused && !over && !ending && !debugOpen && !asking && (
        <PauseMenu
          onDebug={debug ? () => setDebugOpen(true) : undefined}
          manualAim={manualAim}
          onManualAim={(on) => {
            aimRef.current = on;
            setManualAim(on);
            setAim(on);
          }}
          onResume={resume}
          onSkipTutorial={
            coaching && onSkipTutorial
              ? () => {
                  coachRef.current = false;
                  setCoaching(false);
                  onSkipTutorial();
                  resume();
                }
              : undefined
          }
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
