import { TIERS, type FinishRunRequest, type GalaxySummary, type HangarView, type ProbeCard, type RunResult, type RunStart } from '@galaxy/shared';
import { DEFAULT_CONTENT, describeRelic, type RelicInput, SIM_VERSION } from '@galaxy/sim';
import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import type { RunEnd } from '../arena/ArenaScreen';
import { spriteDataUrl } from '../arena/sprites';
import { ApiError } from '../api/client';
import { useGacha } from '../api/economy';
import { clearPending, loadPending, type PendingRun, savePending } from '../api/pending-run';
import { useChooseProbe, useFinishRun, useHangar, useSetLoadout, useStartRun } from '../api/runs';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { errorText } from '../auth/useMe';
import { Icon } from '../ui/Icon';
import { RelicPicker } from './RelicPicker';
import { SetsPanel } from './SetsPanel';
import { ResultsScreen } from './ResultsScreen';

// The hangar (GDD §5.1, §8.4, §11.3 bis): sector, probe and relics before a run, and the daily yield. Launching opens
// the arena (its own chunk with PixiJS); its end goes to the server once, and a result that did not arrive is kept
// and sent again with the same key (plan ruling 17).

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

function relicInput(g: GalaxySummary): RelicInput {
  return { id: g.id, seed: g.seed, tier: TIERS.indexOf(g.tier), level: g.level, traits: g.traits };
}

function Splash({ label }: { label: string }) {
  return (
    <div className="splash" role="status" aria-label={label}>
      <span aria-hidden="true">⠋⠙⠹</span>
    </div>
  );
}

function RelicSlots({ view, onChoose, onRemove, error }: { view: HangarView; onChoose: (slot: number) => void; onRemove: (slot: number) => void; error: unknown }) {
  const all = view.loadout.filter((g): g is GalaxySummary => g !== null).map(relicInput);
  return (
    <section className="lip panel hangar-relics" aria-labelledby="hangar-relics">
      <h2 id="hangar-relics">{copy.hangar.relics}</h2>
      <p className="hangar-help">{copy.hangar.relicsHelp}</p>
      <ol className="relic-slots">
        {Array.from({ length: view.maxSlots }, (_, i) => {
          if (i >= view.slots) {
            return (
              <li key={i} className="relic-slot locked">
                <Icon name="lock" />
                <span>{copy.hangar.lockedSlot}</span>
              </li>
            );
          }
          const g = view.loadout[i];
          if (!g) {
            return (
              <li key={i} className="relic-slot empty">
                <button type="button" className="lip pill" onClick={() => onChoose(i)}>
                  <Icon name="cards" />
                  <span>{copy.hangar.chooseRelic}</span>
                </button>
              </li>
            );
          }
          const skill = describeRelic(relicInput(g), all, DEFAULT_CONTENT);
          const family = copy.hangar.families[skill.family];
          return (
            <li key={i} className="relic-slot filled" role="group" aria-label={copy.hangar.slot(i + 1)}>
              <GalaxyCard galaxy={g} size={112} />
              <div className="relic-info">
                <b>{g.name}</b>
                <span className="relic-family">{family}</span>
                {skill.element && <span className={`relic-chip el-${skill.element}`}>{copy.hangar.elements[skill.element]}</span>}
                {skill.phenomenon && <span className="relic-chip phen">{copy.hangar.phenomena[skill.phenomenon]}</span>}
                <span className="relic-power">{copy.hangar.power(skill.magnitude)}</span>
                <button type="button" className="relic-remove" onClick={() => onRemove(i)} aria-label={copy.hangar.unequip(g.name)}>
                  <Icon name="close" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {error ? (
        <p className="field-error" role="alert">
          {errorText(error, copy.errors)}
        </p>
      ) : null}
      <SetsPanel relics={all} />
    </section>
  );
}

function DailyYield({ daily }: { daily: HangarView['daily'] }) {
  const full = daily.fullSecondsLeft > 0;
  return (
    <div className={`hangar-daily${full ? '' : ' cut'}`}>
      <b>{full ? copy.hangar.dailyFull(copy.hangar.duration(daily.fullSecondsLeft)) : copy.hangar.dailyTier(Math.round(daily.multiplier * 100))}</b>
      <span>{copy.hangar.dailyHint}</span>
    </div>
  );
}

/** Where a locked probe stands: its condition and how far the account is (GDD §6). */
function Unlock({ card }: { card: ProbeCard }) {
  if (!card.condition) return <small className="probe-tile-sub">{copy.hangar.unlockSoon}</small>;
  const { stat, value } = card.condition;
  // The server sends stat / value; rounding gives the stat back (1999 of 2000 stays 1999, never a full bar).
  const now = Math.min(value - 1, Math.round(card.progress * value));
  return (
    <>
      <small className="probe-tile-sub">{copy.hangar.unlock[stat](value)}</small>
      <span className="probe-tile-progress">
        <span className="probe-tile-bar" role="progressbar" aria-label={card.name} aria-valuemin={0} aria-valuemax={value} aria-valuenow={now}>
          <i style={{ inlineSize: `${(now / value) * 100}%` }} />
        </span>
        <small className="probe-tile-count">
          {now}/{value}
        </small>
      </span>
    </>
  );
}

/** The probe for the next runs and the eight to pick from: the unlocked are chosen, the locked say what earns them. */
function ProbePanel({ view }: { view: HangarView }) {
  const choose = useChooseProbe();
  const probe = view.probes.find((p) => p.id === view.probe) ?? view.probes[0];
  if (!probe) return null;
  return (
    <section className="lip panel hangar-probe" aria-labelledby="hangar-probe">
      <span className="hangar-kicker">{copy.hangar.probe}</span>
      <div className="hangar-probe-detail">
        <img className="hangar-probe-art" src={spriteDataUrl(probe.sprite, 8)} alt="" width={128} height={128} />
        <div className="hangar-probe-info">
          <h2 id="hangar-probe">{probe.name}</h2>
          <p>{probe.description}</p>
          <dl className="hangar-stats">
            <div>
              <dt>{copy.hangar.hp}</dt>
              <dd>{probe.hp}</dd>
            </div>
            <div>
              <dt>{copy.hangar.speed}</dt>
              <dd>{probe.speed}</dd>
            </div>
            <div>
              <dt>{copy.hangar.weapon}</dt>
              <dd>
                <img src={spriteDataUrl(probe.weapon.icon, 2)} alt="" width={24} height={24} />
                {probe.weapon.name}
              </dd>
            </div>
          </dl>
          {probe.quirk && (
            <p className="probe-quirk">
              <b>{copy.probeTest.quirk}</b>
              <span>{copy.probeTest.quirks[probe.quirk]}</span>
            </p>
          )}
        </div>
      </div>
      <ul className="probe-picker" aria-label={copy.hangar.probePicker}>
        {view.probes.map((p) => {
          const chosen = p.id === view.probe;
          const art = <img className="probe-tile-art" src={spriteDataUrl(p.sprite, 3)} alt="" width={48} height={48} />;
          return (
            <li key={p.id}>
              {p.unlocked ? (
                <button
                  type="button"
                  className={`probe-tile${chosen ? ' chosen' : ''}`}
                  aria-label={p.name}
                  aria-pressed={chosen}
                  aria-busy={(choose.isPending && choose.variables === p.id) || undefined}
                  onClick={() => {
                    if (!chosen && !choose.isPending) choose.mutate(p.id);
                  }}
                >
                  {art}
                  <span className="probe-tile-text">
                    <b>{p.name}</b>
                    <small className="probe-tile-sub">{chosen ? copy.hangar.chosen : p.weapon.name}</small>
                  </span>
                  {chosen && <Icon name="check" className="ico probe-tile-check" />}
                </button>
              ) : (
                <div className="probe-tile locked">
                  <span className="probe-tile-lock">
                    {art}
                    <Icon name="lock" />
                  </span>
                  <span className="probe-tile-text">
                    <b>{p.name}</b>
                    <Unlock card={p} />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {choose.error ? (
        <p className="field-error" role="alert">
          {errorText(choose.error, copy.errors)}
        </p>
      ) : null}
    </section>
  );
}

function Hangar({ view, onLaunch, launching, error }: { view: HangarView; onLaunch: () => void; launching: boolean; error: unknown }) {
  const setLoadout = useSetLoadout();
  const [picking, setPicking] = useState<number | null>(null);
  const ids = view.loadout.map((g) => g?.id ?? null);
  const sector = view.sectors[0];
  const save = (next: (string | null)[]) => setLoadout.mutate(next);
  return (
    <div className="hangar-grid">
      {sector && (
        <section className="lip panel hangar-sector" aria-labelledby="hangar-sector">
          <span className="hangar-kicker">{copy.hangar.sector}</span>
          <h2 id="hangar-sector">{sector.name}</h2>
          <p>{sector.description}</p>
          <div className="hangar-boss">
            <img src={spriteDataUrl(sector.boss.sprite, 2)} alt="" width={80} height={80} />
            <span>
              <small>{sector.boss.title}</small>
              <b>{sector.boss.name}</b>
            </span>
          </div>
          <span className="hangar-kicker">{copy.hangar.fauna}</span>
          <ul className="hangar-fauna">
            {sector.fauna.map((f) => (
              <li key={f.id} title={f.name}>
                <img src={spriteDataUrl(f.sprite, 3)} alt={f.name} />
              </li>
            ))}
          </ul>
          <p className="hangar-help">{copy.hangar.layers(Math.round(sector.layerSeconds / 60))}</p>
          <p className="hangar-more">
            <Icon name="lock" />
            <span>{copy.hangar.moreSectors}</span>
          </p>
        </section>
      )}
      <ProbePanel view={view} />
      <RelicSlots
        view={view}
        error={setLoadout.error}
        onChoose={setPicking}
        onRemove={(slot) => {
          const next = [...ids];
          next[slot] = null;
          save(next);
        }}
      />
      <div className="hangar-launch">
        <DailyYield daily={view.daily} />
        {!view.runsEnabled && <p className="field-error">{copy.errors.runs_disabled}</p>}
        {error ? <p className="field-error">{errorText(error, copy.errors)}</p> : null}
        <button type="button" className="lip launch" disabled={!view.runsEnabled || launching} aria-busy={launching || undefined} onClick={onLaunch}>
          <Icon name="play" />
          <span>{copy.hangar.launch}</span>
        </button>
      </div>
      {picking !== null && (
        <RelicPicker
          taken={new Set(ids.filter((x): x is string => x !== null && x !== ids[picking]))}
          onClose={() => setPicking(null)}
          onPick={(g) => {
            const next = ids.map((x) => (x === g.id ? null : x));
            next[picking] = g.id;
            save(next);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

export function HangarScreen() {
  const hangar = useHangar();
  const gacha = useGacha();
  const start = useStartRun();
  const finish = useFinishRun();
  const [run, setRun] = useState<RunStart | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [pending, setPending] = useState<PendingRun | null>(() => loadPending());
  const [sendError, setSendError] = useState<unknown>(null);
  const sentOnce = useRef(false);

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
      loot: s.loot.map((l) => ({ coins: Math.floor(l.coins), dust: Math.floor(l.dust) })),
      hash: s.hash,
      inputs: end.inputs,
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
    return (
      <ArenaBoundary>
        <Suspense fallback={<Splash label={copy.arena.loading} />}>
          <ArenaScreen run={run} onEnd={ended} onSave={keep} />
        </Suspense>
      </ArenaBoundary>
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
    body = (
      <Hangar
        view={hangar.data}
        launching={start.isPending}
        error={start.error ?? sendError}
        onLaunch={() => {
          setSendError(null);
          start.mutate({ sector: hangar.data.sectors[0]!.id, probe: hangar.data.probe, simVersion: SIM_VERSION }, { onSuccess: (r) => setRun(r) });
        }}
      />
    );
  }

  return (
    <div className="screen-root hangar-root">
      <div className="hangar">
        <header className="collection-bar">
          <Link to="/" className="lip pill">
            <Icon name="back" />
            <span>{copy.hangar.back}</span>
          </Link>
          <h1>{copy.hangar.title}</h1>
          <div className="lip panel hud">
            <WalletBar wallet={gacha.data?.wallet} />
          </div>
        </header>
        {body}
      </div>
    </div>
  );
}
