import { HScroll } from '../ui/HScroll';
import { type BoostsConfig, type ConfigValue, type EconomyPay, type EconomyResult, type EconomySample, parseConfig, simulateEconomy } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, runSummary, step } from '@galaxy/sim';
import { useEffect, useId, useRef, useState } from 'react';
import { useConfigKeys } from '../api/config';
import { copy, fmt } from '../copy/es';

// The economy simulator (GDD §16.6; M6d-5, DESIGN_SYSTEM §8 quatervicies), under the editor of `runs` and `boosts`:
// three runs played by the simulation's bot in the chosen sector and length, in slices (the page stays alive, and it can
// be stopped), then what they pay under the live config and under the draft, per run and over a day of play. An
// estimate from bot runs; nothing is sent.

const t = copy.admin.economy;
const CHUNK = 3000;
const SEEDS = ['20261108', '20261109', '20261110'];
const PER_DAY = [60, 180, 360];
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type RunsConfig = ConfigValue<'runs'>;

export function EconomySimulator({ editing, draft, lengths = [5, 10, 15] }: { editing: 'runs' | 'boosts'; draft: Record<string, unknown>; lengths?: number[] }) {
  const ids = useId();
  const keys = useConfigKeys();
  const [sector, setSector] = useState(DEFAULT_CONTENT.sectors[0]!.id);
  const [minutes, setMinutes] = useState(lengths[0]!);
  const [perDay, setPerDay] = useState(PER_DAY[1]!);
  const [pct, setPct] = useState<number | null>(null);
  const [result, setResult] = useState<{ live: EconomyResult; draft: EconomyResult; samples: number } | null>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const liveOf = <K extends 'runs' | 'boosts'>(key: K) => parseConfig(key, keys.data?.find((k) => k.key === key)?.data ?? {});

  const run = async () => {
    stop.current = false;
    setResult(null);
    setPct(0);
    const ticks = Math.round(minutes * 60 * 60);
    const samples: EconomySample[] = [];
    for (const [i, seed] of SEEDS.entries()) {
      const sim = createSim({ seed, content: DEFAULT_CONTENT, sector, probes: [{ probe: 'lumen', relics: [] }], record: false });
      while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
        for (let n = 0; n < CHUNK && sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing'); n++) {
          if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })));
          else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
        }
        await yieldToPage();
        if (!alive.current) return;
        if (stop.current) {
          setPct(null);
          return;
        }
        setPct(Math.round(((i + sim.tick / ticks) / SEEDS.length) * 100));
      }
      const s = runSummary(sim);
      samples.push({ outcome: sim.status === 'dead' ? 'died' : sim.status === 'extracted' ? 'extracted' : 'abandoned', ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level, loot: s.loot });
    }
    const at = new Date();
    const liveRuns = liveOf('runs');
    const liveBoosts = liveOf('boosts');
    const draftRuns = editing === 'runs' ? (draft as unknown as RunsConfig) : liveRuns;
    const draftBoosts = editing === 'boosts' ? (draft as unknown as BoostsConfig) : liveBoosts;
    setPct(null);
    setResult({
      live: simulateEconomy(samples, liveRuns, liveBoosts, { minutesPerDay: perDay, at }),
      draft: simulateEconomy(samples, draftRuns, draftBoosts, { minutesPerDay: perDay, at }),
      samples: samples.length,
    });
  };

  const rows: { label: string; pick: (r: EconomyResult) => number; decimals?: number }[] = [
    ...(['coins', 'dust', 'material', 'signals'] as (keyof EconomyPay)[]).map((k) => ({ label: t.perRun(t.currencies[k] ?? k), pick: (r: EconomyResult) => r.perRun[k], decimals: k === 'signals' ? 2 : 0 })),
    ...(['coins', 'dust', 'material', 'signals'] as (keyof EconomyPay)[]).map((k) => ({ label: t.perDay(t.currencies[k] ?? k), pick: (r: EconomyResult) => r.perDay[k], decimals: k === 'signals' ? 1 : 0 })),
  ];
  const show = (n: number, decimals = 0) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(n);
  const diff = (a: number, b: number, decimals = 0) => {
    const d = b - a;
    if (Math.abs(d) < 10 ** -decimals / 2) return t.same;
    const pctText = a !== 0 ? ` (${d > 0 ? '+' : ''}${fmt(Math.round((d / a) * 100))} %)` : '';
    return `${d > 0 ? '+' : ''}${show(d, decimals)}${pctText}`;
  };

  return (
    <section className="lip panel economy-sim" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>{t.title}</h2>
      <p className="panel-note">{t.intro}</p>
      <div className="economy-controls">
        <div className="field">
          <label htmlFor={`${ids}-sector`}>{t.sector}</label>
          <div className="control">
            <select id={`${ids}-sector`} value={sector} onChange={(e) => setSector(e.target.value)}>
              {DEFAULT_CONTENT.sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-len`}>{t.length}</label>
          <div className="control">
            <select id={`${ids}-len`} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {lengths.map((m) => (
                <option key={m} value={m}>
                  {t.minutes(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-day`}>{t.dayLength}</label>
          <div className="control">
            <select id={`${ids}-day`} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))}>
              {PER_DAY.map((m) => (
                <option key={m} value={m}>
                  {t.minutes(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {pct === null ? (
          <button type="button" className="lip pill" onClick={() => void run()} disabled={!keys.data}>
            {t.run}
          </button>
        ) : (
          <button
            type="button"
            className="lip pill danger"
            onClick={() => {
              stop.current = true;
            }}
          >
            {t.stop}
          </button>
        )}
      </div>
      {pct !== null ? (
        <p className="panel-note" role="status">
          {t.playing(pct)}
        </p>
      ) : null}
      {result ? (
        <>
          <p className="panel-note" role="status">
            {t.estimate(result.samples, result.draft.perDay.runs)}
          </p>
          <HScroll variant="table" className="admin-table-wrap">
            <table className="admin-table economy-table">
              <caption>{t.tableTitle}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.cols.what}</th>
                  <th scope="col">{t.cols.live}</th>
                  <th scope="col">{t.cols.draft}</th>
                  <th scope="col">{t.cols.diff}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td className="num">{show(r.pick(result.live), r.decimals)}</td>
                    <td className="num">{show(r.pick(result.draft), r.decimals)}</td>
                    <td className="num">{diff(r.pick(result.live), r.pick(result.draft), r.decimals)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScroll>
          {result.draft.capped > 0 ? <p className="panel-note">{t.capped(result.draft.capped)}</p> : null}
        </>
      ) : null}
    </section>
  );
}
