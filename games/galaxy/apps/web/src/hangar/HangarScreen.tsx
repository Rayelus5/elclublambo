import { TIERS, type FinishRunRequest, type GalaxySummary, type HangarView, type RunResult, type RunStart, type SectorCard } from '@galaxy/shared';
import { DEFAULT_CONTENT, describeRelic, type RelicInput, SIM_VERSION } from '@galaxy/sim';
import { Component, lazy, type ReactNode, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import type { RunEnd } from '../arena/ArenaScreen';
import { spriteDataUrl } from '../arena/sprites';
import { ApiError } from '../api/client';
import { useGacha } from '../api/economy';
import { clearPending, loadPending, type PendingRun, savePending } from '../api/pending-run';
import { ModeBar } from './ModeBar';
import { useChooseSector, useFinishRun, useHangar, useSetLoadout, useStartRun, useUnlockSlot } from '../api/runs';
import { Progress } from '../workshop/parts';
import { GalaxyCard } from '../cards/GalaxyCard';
import { copy } from '../copy/es';
import { WalletBar } from '../hub/WalletBar';
import { errorText } from '../auth/useMe';
import { Icon } from '../ui/Icon';
import { RelicPicker } from './RelicPicker';
import { SetsPanel } from './SetsPanel';
import { ResultsScreen } from './ResultsScreen';
import { AnomalyTag } from '../hub/AnomalyTag';
import { BoostChips } from '../hub/Boosts';
import { BackLink } from '../ui/BackLink';
import { tourActive, useTutorial, useTutorialUpdate } from '../api/tutorial';
import { emitTour } from '../tour/bus';

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

/** The next relic slot (GDD §8.4, M4c-1): what opens it with its bar, then «Abrir ranura» with its dust. */
function NextSlotItem({ next }: { next: NonNullable<HangarView['nextSlot']> }) {
  const unlock = useUnlockSlot();
  const dust = useGacha().data?.wallet.dust;
  const short = dust === undefined ? null : Math.max(0, next.dust - dust);
  const have = Math.min(next.condition.value, Math.round(next.progress * next.condition.value));
  const condition = copy.hangar.unlock[next.condition.stat](next.condition.value);
  const missing = useId();
  return (
    <li className={`relic-slot next-slot${next.ready ? ' ready' : ''}`} role="group" aria-label={copy.hangar.slot(next.slot)}>
      <Icon name="lock" />
      <span className="next-slot-condition">{condition}</span>
      <span
        className="next-slot-bar"
        role="progressbar"
        aria-label={condition}
        aria-valuemin={0}
        aria-valuemax={next.condition.value}
        aria-valuenow={have}
        aria-valuetext={copy.hangar.slotProgress(have, next.condition.value)}
      >
        <i style={{ inlineSize: `${next.progress * 100}%` }} />
      </span>
      <small className="next-slot-count">
        {have}/{next.condition.value}
      </small>
      {next.ready ? (
        <>
          <button
            type="button"
            className="lip pill pill-solar station-upgrade"
            disabled={short === null || short > 0 || unlock.isPending}
            aria-busy={unlock.isPending || undefined}
            aria-describedby={short !== null && short > 0 ? missing : undefined}
            onClick={() => unlock.mutate(next.slot)}
          >
            <Icon name="cards" />
            <span>{copy.hangar.openSlot}</span>
            <small>{copy.collection.levelCost(next.dust)}</small>
          </button>
          {short !== null && short > 0 ? (
            <p className="panel-note" id={missing}>
              {copy.lab.missing(short, 0)}
            </p>
          ) : null}
        </>
      ) : null}
      {unlock.error ? (
        <p className="field-error" role="alert">
          {errorText(unlock.error, copy.errors)}
        </p>
      ) : null}
    </li>
  );
}

function RelicSlots({ view, onChoose, onRemove, error }: { view: HangarView; onChoose: (slot: number) => void; onRemove: (slot: number) => void; error: unknown }) {
  const all = view.loadout.filter((g): g is GalaxySummary => g !== null).map(relicInput);
  // The same family stacked (GDD §8.6): said when some family has as many relics as the rule starts at.
  const families = all.map((r) => describeRelic(r, all, DEFAULT_CONTENT).family);
  const stacked = families.some((f) => families.filter((x) => x === f).length >= DEFAULT_CONTENT.relics.stacking.from);
  return (
    <section className="lip panel hangar-relics" aria-labelledby="hangar-relics">
      <h2 id="hangar-relics">{copy.hangar.relics}</h2>
      <p className="hangar-help">{copy.hangar.relicsHelp}</p>
      <ol className="relic-slots">
        {Array.from({ length: view.maxSlots }, (_, i) => {
          if (i === view.slots && view.nextSlot) return <NextSlotItem key={i} next={view.nextSlot} />;
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
              <li key={i} className="relic-slot empty" data-tour={view.loadout.findIndex((x) => !x) === i ? 'relic-slot' : undefined}>
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
      {stacked ? <p className="panel-note relic-stacking">{copy.hangar.stacking}</p> : null}
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
      <span>{copy.hangar.dailyHint(daily.fullHours)}</span>
    </div>
  );
}



/** The sector for the next runs and the five to pick from: open ones are chosen, closed ones say what opens them. */
function SectorPanel({ view }: { view: HangarView }) {
  const choose = useChooseSector();
  const sector = view.sectors.find((s) => s.id === view.sector) ?? view.sectors[0];
  if (!sector) return null;
  /** A closed sector's line: the Core to beat (named from the sector the condition is about), or the season. */
  const closedLine = (s: SectorCard) => {
    if (!s.condition) return s.season ? copy.hangar.offSeason : copy.hangar.unlockSoon;
    const from = view.sectors.find((x) => x.id === s.condition!.sector);
    return copy.hangar.sectorUnlock[s.condition.stat](s.condition.value, from?.boss.name ?? '', from?.name ?? s.condition.sector);
  };
  return (
    <section className="lip panel hangar-sector" aria-labelledby="hangar-sector" data-tour="sector">
      <span className="hangar-kicker">{copy.hangar.sector}</span>
      <div className="hangar-sector-title">
        <h2 id="hangar-sector">{sector.name}</h2>
        {sector.season && <span className="season-badge">{copy.hangar.seasonBadge}</span>}
      </div>
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
      <ul className="probe-picker sector-picker" aria-label={copy.hangar.sectorPicker}>
        {view.sectors.map((s) => {
          const chosen = s.id === view.sector;
          const art = <img className="sector-tile-art" src={spriteDataUrl(s.boss.sprite, 1)} alt="" width={40} height={40} />;
          return (
            <li key={s.id}>
              {s.unlocked ? (
                <button
                  type="button"
                  className={`probe-tile${chosen ? ' chosen' : ''}`}
                  aria-label={s.name}
                  aria-pressed={chosen}
                  aria-busy={(choose.isPending && choose.variables === s.id) || undefined}
                  onClick={() => {
                    if (!chosen && !choose.isPending) choose.mutate(s.id);
                  }}
                >
                  {art}
                  <span className="probe-tile-text">
                    <b>{s.name}</b>
                    <small className={`probe-tile-sub${s.season && !chosen ? ' season' : ''}`}>
                      {chosen ? copy.hangar.sectorChosen : s.season ? copy.hangar.seasonBadge : copy.hangar.species(s.fauna.length)}
                    </small>
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
                    <b>{s.name}</b>
                    {s.condition ? (
                      <Progress name={s.name} text={closedLine(s)} value={s.condition.value} progress={s.progress} />
                    ) : (
                      <small className="probe-tile-sub">{closedLine(s)}</small>
                    )}
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




/** The probe for the next runs (equipped in the workshop): what it is, its level and weapon, and the way in. */
function ProbePanel({ view }: { view: HangarView }) {
  const probe = view.probes.find((p) => p.id === view.probe) ?? view.probes[0];
  if (!probe) return null;
  const weapon = probe.variants.find((w) => w.id === probe.variant) ?? probe.weapon;
  return (
    <section className="lip panel hangar-probe" aria-labelledby="hangar-probe" data-tour="probe">
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
              <dt>{copy.workshop.levelShort}</dt>
              <dd>{copy.hangar.level(probe.level, probe.maxLevel)}</dd>
            </div>
          </dl>
          <p className="probe-quirk">
            <b>{copy.hangar.startingWeapon}</b>
            <span>{weapon.name}</span>
          </p>
        </div>
      </div>
      <Link to={`/taller?sonda=${probe.id}`} className="lip pill pill-solar hangar-workshop-link" data-sfx="hover">
        <Icon name="wrench" />
        <span>{copy.workshop.open}</span>
      </Link>
    </section>
  );
}

function Hangar({ view, onLaunch, launching, error, modes }: { view: HangarView; onLaunch: () => void; launching: boolean; error: unknown; modes: boolean }) {
  const setLoadout = useSetLoadout();
  const [picking, setPicking] = useState<number | null>(null);
  const ids = view.loadout.map((g) => g?.id ?? null);
  const save = (next: (string | null)[]) => setLoadout.mutate(next, { onSuccess: () => (next.some((x) => x !== null) ? emitTour('hangar:relicEquipped') : undefined) });
  return (
    <>
    {modes ? <ModeBar onQuick={onLaunch} launching={launching} disabled={!view.runsEnabled} /> : null}
    <div className="hangar-grid">
      <SectorPanel view={view} />
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
        <AnomalyTag className="in-hangar" />
        <BoostChips />
        {!view.runsEnabled && <p className="field-error">{copy.errors.runs_disabled}</p>}
        {error ? <p className="field-error">{errorText(error, copy.errors)}</p> : null}
        <button type="button" className="lip launch" disabled={!view.runsEnabled || launching} aria-busy={launching || undefined} onClick={onLaunch} data-tour="launch">
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
    </>
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
      loot: s.loot.map((l) => ({ coins: Math.floor(l.coins), dust: Math.floor(l.dust), components: Math.floor(l.components ?? 0) })),
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
          <ArenaScreen run={run} onEnd={ended} onSave={keep} coached={coached} onSkipTutorial={() => tutorialUpdate.mutate({ action: 'skip' })} />
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
        // Co-op opens after the tutorial: the coached first run keeps the hangar as it was.
        modes={!coached}
        error={start.error ?? sendError}
        onLaunch={() => {
          setSendError(null);
          start.mutate({ sector: hangar.data.sector, probe: hangar.data.probe, simVersion: SIM_VERSION }, { onSuccess: (r) => setRun(r) });
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
