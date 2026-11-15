import type { FinishRunRequest, RunResult, RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { useQueryClient } from '@tanstack/react-query';
import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import type { ArenaDebug, RunEnd } from '../arena/ArenaScreen';
import { clearContentDraft, readContentDraft } from '../admin/content-draft';
import { ApiError } from '../api/client';
import { useGacha } from '../api/economy';
import { clearPending, loadPending, type PendingRun, savePending } from '../api/pending-run';
import { ROOMS_KEY, useLeaveRoom, useRooms } from '../api/rooms';
import { markTestRun, useFinishRun, useHangar, useStartRun } from '../api/runs';
import { tourActive, useTutorial, useTutorialUpdate } from '../api/tutorial';
import { errorText, isAdmin, useMe } from '../auth/useMe';
import { CoopArena } from '../coop/CoopArena';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { BackLink } from '../ui/BackLink';
import { playLaunch } from '../workshop/sfx';
import { Lobby } from './lobby/Lobby';
import { ResultsScreen } from './ResultsScreen';

// The hangar (GDD §5.1, §8.4, §11.3 bis), drawn as the lobby (hangar/lobby): who with, where and with what before a
// run. Launching opens the arena (its own chunk with PixiJS); its end goes to the server once, and a result that did
// not arrive is kept and sent again with the same key (plan ruling 17). While my room plays its run (multiplayer plan,
// phase 6) the page is that run, and it stays on its results until the player goes back to the lobby.

const ArenaScreen = lazy(() => import('../arena/ArenaScreen'));

/** Errors after which the result is kept to send again: no answer, the server, a session to renew or a rate limit. */
function lost(e: unknown): boolean {
  return !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 401 || e.status === 403 || e.status === 429;
}

/** A chunk that did not load (a network blip, a deploy) says so instead of blanking the app. */
class ArenaBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen-root hangar-root">
        <div className="hangar">
          <div className="results sending" role="alert">
            <p>{copy.hangar.arenaFailed}</p>
            <button type="button" className="lip pill pill-solar" onClick={() => window.location.reload()}>
              {copy.hangar.reload}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function Splash({ label }: { label: string }) {
  return (
    <div className="splash" role="status" aria-label={label}>
      <span aria-hidden="true">⠋⠙⠹</span>
    </div>
  );
}

export function HangarScreen() {
  const hangar = useHangar();
  const gacha = useGacha();
  const start = useStartRun();
  // The tutorial's first run is coached (polish phase 3).
  const tutorial = useTutorial().data;
  const tutorialUpdate = useTutorialUpdate();
  const coached = tourActive(tutorial) && (tutorial?.chapter === 'hangar' || tutorial?.chapter === 'run');
  const finish = useFinishRun();
  // The admin debug mode (2026-11-15): admins with TOTP, in solo runs, never in the tutorial's.
  const me = useMe().data;
  const debugAllowed = isAdmin(me) && !!me?.mfa && !coached;
  // «Probar en incursión»: the content draft the panel sent here, only for an admin who may play it.
  const [stored, setStored] = useState(readContentDraft);
  const draft = debugAllowed ? stored : null;
  const [draftError, setDraftError] = useState<string | null>(null);
  /** The run on screen plays the draft (a test run from its start). */
  const [runDraft, setRunDraft] = useState(false);
  const [run, setRun] = useState<RunStart | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pending, setPending] = useState<PendingRun | null>(() => loadPending());
  const [sendError, setSendError] = useState<unknown>(null);
  const sentOnce = useRef(false);
  const qc = useQueryClient();
  const leave = useLeaveRoom();
  const coopRun = useRooms().data?.mine?.run?.id ?? null;
  // The room's run on screen: while it plays, and after it until its results are closed.
  const [playing, setPlaying] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  if (coopRun && coopRun !== playing && coopRun !== finished) setPlaying(coopRun);

  function send(p: PendingRun): void {
    setSendError(null);
    finish.mutate(p, {
      onSuccess: (r) => {
        setPending(null);
        setResult(r);
      },
      onError: (e) => {
        if (lost(e)) setSendError(e);
        else {
          clearPending();
          setPending(null);
          setSendError(e);
        }
      },
    });
  }

  useEffect(() => {
    if (pending && !sentOnce.current) {
      sentOnce.current = true;
      send(pending);
    }
    // Only on arrival: a pending result from an earlier visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kept = useRef<PendingRun | null>(null);

  /** Keeps the result (with its key) the moment the run ends; the same run is kept once. */
  function keep(end: RunEnd): PendingRun | null {
    if (!run) return null;
    if (kept.current?.runId === run.id) return kept.current;
    const s = end.summary;
    const body: FinishRunRequest = {
      outcome: end.outcome,
      ticks: s.ticks,
      depth: s.depth,
      kills: s.kills,
      bossKills: s.bossKills,
      level: s.level,
      loot: s.loot.map((l) => ({ coins: Math.floor(l.coins), dust: Math.floor(l.dust), components: Math.floor(l.components ?? 0), ...(l.signals ? { signals: l.signals } : {}) })),
      hash: s.hash,
      inputs: end.inputs,
      // A test run gives up its rewards, also when this copy is resent after a reload.
      ...(end.test ? { test: true as const } : {}),
    };
    const p: PendingRun = { runId: run.id, key: crypto.randomUUID(), body };
    savePending(p);
    kept.current = p;
    return p;
  }

  function ended(end: RunEnd): void {
    const p = keep(end);
    if (!p) return;
    setPending(p);
    setRun(null);
    send(p);
  }

  if (run) {
    const runId = run.id;
    const debug: ArenaDebug | undefined = debugAllowed ? { test: runDraft, draft: runDraft, markTest: () => markTestRun(runId).then(() => undefined) } : undefined;
    return (
      <ArenaBoundary>
        <Suspense fallback={<Splash label={copy.arena.loading} />}>
          <ArenaScreen run={run} onEnd={ended} onSave={keep} coached={coached} onSkipTutorial={() => tutorialUpdate.mutate({ action: 'skip' })} debug={debug} />
        </Suspense>
      </ArenaBoundary>
    );
  }

  if (playing) {
    return (
      <CoopArena
        key={playing}
        runId={playing}
        onExit={() => {
          setFinished(playing);
          setPlaying(null);
          void qc.invalidateQueries({ queryKey: ROOMS_KEY });
        }}
        onAbandon={() => {
          setFinished(playing);
          setPlaying(null);
          leave.mutate();
        }}
      />
    );
  }

  let body;
  if (result) {
    body = (
      <ResultsScreen
        result={result}
        onAgain={() => {
          setResult(null);
          void hangar.refetch();
        }}
      />
    );
  } else if (pending) {
    body = (
      <div className="results sending" role="status">
        {finish.isPending ? (
          <p>{copy.results.sending}</p>
        ) : (
          <>
            <p>{copy.results.lost}</p>
            {sendError ? <p className="field-error">{errorText(sendError, copy.errors)}</p> : null}
            <button type="button" className="lip pill pill-solar" onClick={() => send(pending)}>
              {copy.results.retry}
            </button>
          </>
        )}
      </div>
    );
  } else if (!hangar.data) {
    body = <Splash label={copy.loading} />;
  } else if (!hangar.data.test.taken) {
    // No run without the probe the test gives (GDD §12.2).
    return <Navigate to="/sonda" replace />;
  } else {
    return (
      <Lobby
        view={hangar.data}
        launching={start.isPending}
        // The coached first run keeps to one way: alone.
        coached={coached}
        error={start.error ?? sendError}
        notice={
          draft ? (
            <div className="lip panel lobby-draft" role="status" aria-label={copy.hangar.draft.notice}>
              <b>{copy.hangar.draft.notice}</b>
              <span>{copy.hangar.draft.hint}</span>
              <button
                type="button"
                className="lip pill small"
                onClick={() => {
                  clearContentDraft();
                  setStored(null);
                  setDraftError(null);
                }}
              >
                {copy.hangar.draft.discard}
              </button>
              {draftError ? <p className="field-error">{draftError}</p> : null}
            </div>
          ) : null
        }
        onLaunch={() => {
          setSendError(null);
          setDraftError(null);
          const req = { sector: hangar.data.sector, probe: hangar.data.probe, simVersion: SIM_VERSION };
          if (draft) {
            // The draft plays the run: it must have what the run is launched with, or the arena could not start.
            const c = draft.content;
            if (!c.sectors.some((s) => s.id === req.sector) || !c.probes.some((p) => p.id === req.probe)) {
              setDraftError(copy.hangar.draft.missing);
              return;
            }
            playLaunch();
            start.mutate(
              { ...req, test: true },
              {
                onSuccess: (r) => {
                  if ((r.variant && !c.weapons.some((w) => w.id === r.variant)) || (r.anomaly && !c.anomalies.some((a) => a.id === r.anomaly))) {
                    setDraftError(copy.hangar.draft.missing);
                    return;
                  }
                  setRunDraft(true);
                  setRun({ ...r, content: c });
                },
              },
            );
            return;
          }
          playLaunch();
          start.mutate(req, {
            onSuccess: (r) => {
              setRunDraft(false);
              setRun(r);
            },
          });
        }}
      />
    );
  }

  return (
    <div className="screen-root hangar-root">
      <div className="hangar">
        <header className="collection-bar">
          <BackLink fallback="/" />
          <h1>{copy.hangar.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} components />
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}
