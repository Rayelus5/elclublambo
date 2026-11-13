import { FINISHES, FUSION_TOP, TIERS, type Finish, type PulledGalaxy, type Tier } from '@galaxy/shared';
import { useEffect, useId, useState } from 'react';
import { copy } from '../copy/es';
import { ClassicStage } from '../scanner/ClassicStage';
import { fabricatePulls, fusionInputs, randomSeed, REHEARSAL_PRESETS, type RehearsalPreset } from '../scanner/pro/fabricate';
import type { CinemaControl } from '../scanner/pro/ProCinema';
import { ProShell } from '../scanner/pro/ProShell';
import type { Phase, PhaseKind } from '../scanner/pro/script';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Segmented';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';

// The pro scanner's rehearsal (plan «escáner pro», part B; the owner: «me gustaría dirigirte en esta mejora visual»).
// The admin plays the cinematic with invented scans — real galaxies from the game's generator, nothing paid or saved —
// choosing one or ten, the tiers, the finish, «Destacada», the phenomenon, the surge, the motion and the speed, and
// changing how long each phase lasts. Over the stage, the phase and its time, «Ir a la fase», pause and replay.
// «Copiar guion» hands the numbers over as JSON. The durations stay in this browser. A fusion (plan «fusión pro»)
// plays one new galaxy from 2 to 10 going in, of the tier below it (never a mythic: a fusion does not make one).
// «Presentación» (plan «rareza Mítica» M2: the admin must be able to watch every animation) plays the same invented
// pulls through the classic reveal too, as the scanner shows it with «Presentación pro» off; what only the pro one
// has (the surge, the speed, the phase durations, the script) is not offered then. A fusion there shows its new
// galaxy alone, as the collection does without the pro cinematic.

const t = copy.admin.rehearsal;
const KEY = 'galaxy.rehearsal.durations';
const SINGLE: PhaseKind[] = ['ignicion', 'salto', 'ascenso', 'caida', 'silencio', 'impacto', 'carta', 'fenomeno', 'resumen'];
const TEN: PhaseKind[] = ['ignicion', 'salto', 'ascenso', 'caida', 'impacto', 'reparto', 'giro', 'silencio', 'solo', 'final', 'resumen'];
const FUSION: PhaseKind[] = ['ignicion', 'orbita', 'ascenso', 'colapso', 'impacto', 'carta', 'fenomeno', 'resumen'];
const INPUT_COUNTS = ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;
const PHENOMENA = Object.keys(copy.traitValues.phenomenon as Record<string, string>);
/** What a fusion can make: up to the legendary. */
const FUSED = TIERS.slice(0, FUSION_TOP + 1);

type Durations = Partial<Record<PhaseKind, number>>;

function readDurations(): Durations {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && v > 0 && v < 20)) as Durations;
  } catch {
    return {};
  }
}

function saveDurations(d: Durations) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private windows: they last for this page.
  }
}

/** Over the stage: the phase playing, its time, and the director's buttons. */
function Hud({ control, phase, onReplay }: { control: CinemaControl | null; phase: Phase | null; onReplay: () => void }) {
  const [, frame] = useState(0);
  const [paused, setPaused] = useState(false);
  const ids = useId();
  useEffect(() => {
    let id = 0;
    const tick = () => {
      frame((n) => n + 1);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  if (!control) return null;
  const now = control.time();
  return (
    <div className="lip panel rehearsal-hud" onClick={(e) => e.stopPropagation()}>
      <span className="rehearsal-phase">
        <b>{phase?.label ?? '—'}</b>
        <span>
          {now.toFixed(2)} s / {control.script.duration.toFixed(2)} s
        </span>
      </span>
      <span id={`${ids}-go`} className="sr-only">
        {t.goTo}
      </span>
      <Select
        aria-labelledby={`${ids}-go`}
        size="sm"
        value={phase?.label ?? ''}
        placeholder={t.goTo}
        options={control.script.phases.map((p) => ({ value: p.label, label: `${p.label} · ${p.at.toFixed(2)} s` }))}
        onChange={(label) => {
          const p = control.script.phases.find((x) => x.label === label);
          if (p) control.seek(p.at);
        }}
      />
      <button
        type="button"
        className="lip pill small"
        onClick={() => {
          if (paused) control.resume();
          else control.pause();
          setPaused(!paused);
        }}
      >
        <Icon name={paused ? 'play' : 'pause'} />
        <span>{paused ? t.resume : t.pause}</span>
      </button>
      <button type="button" className="lip pill small" onClick={onReplay}>
        <Icon name="flip" />
        <span>{t.replay}</span>
      </button>
    </div>
  );
}

/** The admin's rehearsal of the scanner's reveals, classic or pro, with invented pulls. */
export function RevealRehearsal() {
  const ids = useId();
  const [presentation, setPresentation] = useState<'classic' | 'pro'>('pro');
  const [origin, setOrigin] = useState<'scan' | 'fusion'>('scan');
  const [going, setGoing] = useState<(typeof INPUT_COUNTS)[number]>('5');
  // What was made for the take playing, and as what (the controls may change while the next one is being made).
  const [shot, setShot] = useState<{ intro: 'scan' | 'fusion'; inputs: PulledGalaxy[]; presentation: 'classic' | 'pro' }>({ intro: 'scan', inputs: [], presentation: 'pro' });
  const [count, setCount] = useState<'one' | 'ten'>('ten');
  const [tier, setTier] = useState<Tier>('legendary');
  const [preset, setPreset] = useState<RehearsalPreset>('variada');
  const [finish, setFinish] = useState<Finish>('normal');
  const [featured, setFeatured] = useState(false);
  const [phenomenon, setPhenomenon] = useState('auto');
  const [surge, setSurge] = useState<'auto' | 'yes' | 'no'>('yes');
  const [motion, setMotion] = useState<'full' | 'reduced'>('full');
  const [speed, setSpeed] = useState<'1' | '0.5' | '0.25'>('1');
  const [durations, setDurations] = useState<Durations>(readDurations);
  const [pulls, setPulls] = useState<PulledGalaxy[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [take, setTake] = useState(0);
  const [copied, setCopied] = useState(false);
  const fusion = origin === 'fusion';
  const pro = presentation === 'pro';
  const families = fusion ? FUSION : count === 'one' ? SINGLE : TEN;
  // A fusion never makes a mythic: with one picked, a fusion rehearses the legendary.
  const asked: Tier = fusion && !FUSED.includes(tier) ? FUSED[FUSED.length - 1]! : tier;

  async function play() {
    setBusy(true);
    try {
      const tiers = fusion || count === 'one' ? [asked] : [...REHEARSAL_PRESETS[preset]];
      // The classic reveal has no ring of galaxies going in: only the pro one needs them made.
      const inputs = fusion && pro ? await fabricatePulls({ tiers: fusionInputs(asked, Number(going)) }, randomSeed()) : [];
      const made = await fabricatePulls({
        tiers,
        finish,
        featured: featured ? [tiers.length - 1] : [],
        phenomenon: phenomenon === 'auto' ? null : phenomenon,
      });
      setPulls(made);
      setShot({ intro: fusion ? 'fusion' : 'scan', inputs, presentation });
      setTake((n) => n + 1);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const setDuration = (k: PhaseKind, raw: string) => {
    const v = Number(raw.replace(',', '.'));
    const next = { ...durations };
    if (raw.trim() === '' || !Number.isFinite(v) || v <= 0) delete next[k];
    else next[k] = Math.min(20, v);
    setDurations(next);
    saveDurations(next);
  };

  // Only the phases this origin has (the same phase, «carta» say, is shared by a scan and a fusion).
  const used: Durations = Object.fromEntries(Object.entries(durations).filter(([k]) => families.includes(k as PhaseKind)));
  const playing: Durations = Object.fromEntries(Object.entries(durations).filter(([k]) => (shot.intro === 'fusion' ? FUSION : (pulls?.length ?? 0) > 1 ? TEN : SINGLE).includes(k as PhaseKind)));
  const script = JSON.stringify(
    fusion
      ? { origen: 'fusion', entran: Number(going), rareza: asked, duraciones: used }
      : { tiradas: count === 'one' ? 1 : 10, rarezas: count === 'one' ? [tier] : REHEARSAL_PRESETS[preset], duraciones: used },
    null,
    2,
  );

  return (
    <section className="admin-page rehearsal">
      <h1>{t.title}</h1>
      <p className="panel-note">{t.intro}</p>
      <div className="lip panel rehearsal-panel">
        <div className="rehearsal-grid">
          <div className="rehearsal-field">
            <span id={`${ids}-presentation`}>{t.presentation}</span>
            <Segmented
              aria-labelledby={`${ids}-presentation`}
              value={presentation}
              options={(['classic', 'pro'] as const).map((x) => ({ value: x, label: t.presentations[x] }))}
              onChange={setPresentation}
            />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-origin`}>{t.origin}</span>
            <Segmented aria-labelledby={`${ids}-origin`} value={origin} options={(['scan', 'fusion'] as const).map((x) => ({ value: x, label: t.origins[x] }))} onChange={setOrigin} />
          </div>
          {fusion ? (
            <div className="rehearsal-field">
              <span id={`${ids}-going`}>{t.inputs}</span>
              <Select aria-labelledby={`${ids}-going`} value={going} options={INPUT_COUNTS.map((x) => ({ value: x, label: x }))} onChange={setGoing} />
            </div>
          ) : (
            <div className="rehearsal-field">
              <span id={`${ids}-count`}>{t.count}</span>
              <Segmented aria-labelledby={`${ids}-count`} value={count} options={[{ value: 'one', label: t.counts.one }, { value: 'ten', label: t.counts.ten }]} onChange={setCount} />
            </div>
          )}
          {fusion || count === 'one' ? (
            <div className="rehearsal-field">
              <span id={`${ids}-tier`}>{t.tier}</span>
              <Select<Tier> aria-labelledby={`${ids}-tier`} value={asked} options={(fusion ? FUSED : TIERS).map((x) => ({ value: x, label: copy.tiers[x] }))} onChange={setTier} />
            </div>
          ) : (
            <div className="rehearsal-field">
              <span id={`${ids}-preset`}>{t.preset}</span>
              <Select<RehearsalPreset> aria-labelledby={`${ids}-preset`} value={preset} options={(Object.keys(REHEARSAL_PRESETS) as RehearsalPreset[]).map((x) => ({ value: x, label: t.presets[x] }))} onChange={setPreset} />
            </div>
          )}
          <div className="rehearsal-field">
            <span id={`${ids}-finish`}>{t.finish}</span>
            <Select<Finish> aria-labelledby={`${ids}-finish`} value={finish} options={FINISHES.map((x) => ({ value: x, label: copy.finishes[x] }))} onChange={setFinish} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-phen`}>{t.phenomenon}</span>
            <Select aria-labelledby={`${ids}-phen`} value={phenomenon} options={[{ value: 'auto', label: t.phenomenonAuto }, ...PHENOMENA.map((x) => ({ value: x, label: (copy.traitValues.phenomenon as Record<string, string>)[x]! }))]} onChange={setPhenomenon} />
          </div>
          <div className="rehearsal-field">
            <span id={`${ids}-featured`}>{t.featured}</span>
            <Switch aria-labelledby={`${ids}-featured`} checked={featured} onChange={setFeatured} />
          </div>
          {pro ? (
            <div className="rehearsal-field">
              <span id={`${ids}-surge`}>{t.surge}</span>
              <Segmented aria-labelledby={`${ids}-surge`} value={surge} options={(['auto', 'yes', 'no'] as const).map((x) => ({ value: x, label: t.surges[x] }))} onChange={setSurge} />
            </div>
          ) : null}
          <div className="rehearsal-field">
            <span id={`${ids}-motion`}>{t.motion}</span>
            <Segmented aria-labelledby={`${ids}-motion`} value={motion} options={(['full', 'reduced'] as const).map((x) => ({ value: x, label: t.motions[x] }))} onChange={setMotion} />
          </div>
          {pro ? (
            <div className="rehearsal-field">
              <span id={`${ids}-speed`}>{t.speed}</span>
              <Segmented aria-labelledby={`${ids}-speed`} value={speed} options={(['1', '0.5', '0.25'] as const).map((x) => ({ value: x, label: `${x.replace('.', ',')}×` }))} onChange={setSpeed} />
            </div>
          ) : null}
        </div>
        {pro ? (
          <fieldset className="rehearsal-durations">
            <legend>{t.durations}</legend>
            <p className="panel-note">{t.durationsHint}</p>
            <div className="rehearsal-durations-grid">
              {families.map((k) => (
                <label key={k} className="rehearsal-duration">
                  <span>{t.families[k]}</span>
                  <input inputMode="decimal" value={durations[k] !== undefined ? String(durations[k]) : ''} placeholder="—" onChange={(e) => setDuration(k, e.target.value)} />
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="modal-actions rehearsal-actions">
          {pro ? (
            <>
              <button
                type="button"
                className="lip pill"
                onClick={() => {
                  setDurations({});
                  saveDurations({});
                }}
              >
                {t.reset}
              </button>
              <button
                type="button"
                className="lip pill"
                onClick={() => {
                  void navigator.clipboard?.writeText(script).then(() => setCopied(true));
                }}
              >
                <Icon name="copy" />
                <span>{copied ? t.copied : t.copy}</span>
              </button>
            </>
          ) : null}
          <button type="button" className="lip pill pill-solar" disabled={busy} aria-busy={busy || undefined} onClick={() => void play()}>
            <Icon name="play" />
            <span>{busy ? t.making : t.play}</span>
          </button>
        </div>
      </div>
      {open && pulls && shot.presentation === 'classic' ? (
        // Each take starts the classic reveal afresh (its steps, images and focus).
        <ClassicStage key={take} pulls={pulls} title={t.title} onClose={() => setOpen(false)} reduced={motion === 'reduced'} />
      ) : null}
      {open && pulls && shot.presentation === 'pro' ? (
        <ProShell
          pulls={pulls}
          title={t.title}
          intro={shot.intro}
          inputs={shot.inputs}
          onClose={() => setOpen(false)}
          direction={{ overrides: playing, surge: surge === 'auto' ? undefined : surge === 'yes', rate: Number(speed), take, motion }}
          rehearsal={(control, phase) => <Hud control={control} phase={phase} onReplay={() => setTake((n) => n + 1)} />}
        />
      ) : null}
    </section>
  );
}
