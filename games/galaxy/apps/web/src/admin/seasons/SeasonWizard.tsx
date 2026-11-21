import { type AdminSeason, madridDayOf, madridMidnightOf, parseConfig, type SeasonIssue, seasonRecordIssues, SEASON_FINISHES } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useConfigKey } from '../../api/config';
import { useAdminSeasons, useSaveSeason, useScheduleSeason, useValidateSeason } from '../../api/seasons';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { DateField } from '../../ui/DateField';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { PublishFields } from '../PublishFields';
import { AsPlayerLinks, groupOf, madridDate, seasonDays } from './SeasonsScreen';

// The season wizard (plan «temporadas como fichas», 2026-11-21): a season in five steps (its name and dates, its points
// and tiers with a live example, its route, shop, prizes, missions and lab, its anomaly and finish, and a review with
// the server's checks), then saved as a draft or saved and scheduled (it opens on its own at its date). A copy of a
// season starts where it ended, with the same length. The route, shop and prizes are copied or imported for now. The
// review leads to the saved season's shop and leaderboard as players will see them (2026-11-22).

const t = copy.admin.seasons;
type Step = 'data' | 'rules' | 'content' | 'anomaly' | 'review';
const STEPS: Step[] = ['data', 'rules', 'content', 'anomaly', 'review'];
const DAY = 86_400_000;

type Draft = Pick<AdminSeason, 'id' | 'name' | 'startsAt' | 'endsAt' | 'rules' | 'route' | 'missions' | 'lab'>;

const recordOf = (s: Draft): Draft => ({ id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, rules: s.rules, route: s.route, missions: s.missions, lab: s.lab });

/** A Madrid day plus whole days, as the instant that day starts. */
function shiftDay(iso: string, days: number): string {
  const [y, m, d] = madridDayOf(iso).split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return madridMidnightOf(next.toISOString().slice(0, 10));
}

/** The next id and name after a season's: season-2 → season-3, «Temporada 2» → «Temporada 3». */
function nextOf(id: string, name: string, taken: Set<string>): { id: string; name: string } {
  const m = /^(.*?)(\d+)$/.exec(id);
  let n = m ? Number(m[2]) + 1 : 2;
  const stem = m ? m[1]! : `${id}-`;
  while (taken.has(`${stem}${n}`)) n++;
  const nm = /^(.*?)(\d+)$/.exec(name.trim());
  return { id: `${stem}${n}`.slice(0, 32), name: (nm ? `${nm[1]}${n}` : `${name} ${n}`).slice(0, 40) };
}

function fresh(): Draft {
  const { id: _i, name: _n, startsAt: _s, endsAt: _e, ...rules } = parseConfig('season', {});
  const startsAt = shiftDay(new Date().toISOString(), 1);
  return { id: '', name: '', startsAt, endsAt: shiftDay(startsAt, 28), rules, route: parseConfig('seasonRoute', {}), missions: [], lab: [] };
}

/** The draft to start from: the season edited, a copy of one (from where it ends), or a new one. */
function startFrom(list: AdminSeason[], id: string | undefined, from: string | null): Draft {
  if (id) {
    const own = list.find((s) => s.id === id);
    if (own) return recordOf(own);
  }
  const source = list.find((s) => s.id === from);
  if (!source) return fresh();
  const days = Math.max(1, seasonDays(source));
  const startsAt = source.state === 'draft' ? source.startsAt : source.endsAt;
  return { ...recordOf(structuredClone(source)), ...nextOf(source.id, source.name, new Set(list.map((s) => s.id))), startsAt, endsAt: shiftDay(startsAt, days) };
}

/** Which step an issue belongs to (by its path). */
function stepOf(i: SeasonIssue): Step {
  if (i.path.startsWith('rules.anomaly') || i.path.startsWith('rules.finish')) return 'anomaly';
  if (i.path.startsWith('rules')) return 'rules';
  if (i.path.startsWith('route') || i.path.startsWith('missions') || i.path.startsWith('lab')) return 'content';
  return 'data';
}

function issueText(i: SeasonIssue): string {
  if (i.message.startsWith('season_overlap:')) return t.overlapWith(i.message.slice('season_overlap:'.length));
  if (i.message.startsWith('mission_duplicate:')) return t.duplicateMission(i.message.slice('mission_duplicate:'.length));
  return t.issueText[i.message] ?? `${i.path ? `${i.path} ` : ''}${i.message}`;
}

function NumField({ id, label, value, min = 0, onChange, disabled }: { id: string; label: string; value: number; min?: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div className="cf-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Wizard({ list, now, id, from }: { list: AdminSeason[]; now: number; id: string | undefined; from: string | null }) {
  const navigate = useNavigate();
  // `content` never comes in the keys' list (too big): its own query, like the content editor's.
  const content = useConfigKey('content');
  const save = useSaveSeason();
  const schedule = useScheduleSeason();
  const [draft, setDraft] = useState<Draft>(() => startFrom(list, id, from));
  const [step, setStep] = useState<Step>('data');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState(list.find((s) => s.id === from)?.id ?? list.filter((s) => s.state !== 'draft').at(-1)?.id ?? '');
  const own = id ? list.find((s) => s.id === id) : undefined;
  const readonly = !!own && own.state !== 'draft';
  const group = own ? groupOf(own, now) : 'draft';

  const anomalies = ((content.data?.data?.anomalies as { id: string; name: string }[] | undefined) ?? []).map((a) => ({ value: a.id, label: a.name }));
  const local = seasonRecordIssues(draft);
  const remote = useValidateSeason(draft, step === 'review' && !readonly);
  const issues = step === 'review' && remote.data ? remote.data.issues : local;
  const byStep = Object.fromEntries(STEPS.map((s) => [s, issues.filter((i) => stepOf(i) === s).length])) as Record<Step, number>;
  const valid = issues.length === 0 && (step !== 'review' || remote.data?.ok === true);
  const idx = STEPS.indexOf(step);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setRules = (patch: Partial<Draft['rules']>) => setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));
  const day = (iso: string) => {
    try {
      return madridDayOf(iso);
    } catch {
      return '';
    }
  };
  const setDay = (field: 'startsAt' | 'endsAt', value: string) => {
    try {
      set({ [field]: madridMidnightOf(value) } as Partial<Draft>);
    } catch {
      // A half-typed date waits for the rest.
    }
  };
  const latest = list.filter((s) => s.state !== 'draft' && s.id !== draft.id).sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))[0];
  const length = Math.max(1, seasonDays(draft));

  // The live example: a 20-minute run reaching layer 4 that beats one Core and extracts.
  const p = draft.rules.points;
  const example = Math.min(4 * p.layer + p.core + p.extraction, 20 * draft.rules.capPerMinute);
  const gold = draft.rules.tiers[2] ?? 0;

  const finished = (text: string) => navigate('/admin/temporadas', { state: { done: text } });
  const doSave = (then?: (password: string, r: string) => void, password?: string, r = reason.trim()) =>
    save.mutate({ record: draft, reason: r }, { onSuccess: () => (then && password ? then(password, r) : finished(t.done.saved(draft.name))) });

  return (
    <>
      {readonly ? <p className="panel-note">{group === 'open' ? t.openNote : group === 'closed' ? t.closedNote : t.readonly}</p> : null}
      <ol className="ev-steps" aria-label={t.stepsLabel}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" aria-current={s === step ? 'step' : undefined} className={`ev-step${s === step ? ' on' : ''}${i < idx ? ' done' : ''}`} onClick={() => setStep(s)}>
              <span className="ev-step-n">{byStep[s] ? <Icon name="alert" /> : i + 1}</span>
              <span>{t.steps[s]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="ev-wizard">
        <div className="ev-step-body">
          <h2>{t.steps[step]}</h2>
          <p className="panel-note">{t.stepHints[step]}</p>
          {step === 'data' ? (
            <>
              <div className="cf-grid">
                <div className="cf-field">
                  <label htmlFor="sw-name">{t.fields.name}</label>
                  <input id="sw-name" type="text" maxLength={40} value={draft.name} disabled={readonly} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="cf-field">
                  <label htmlFor="sw-id">{t.fields.id}</label>
                  <input id="sw-id" type="text" maxLength={32} value={draft.id} disabled={readonly || !!own} aria-describedby="sw-id-hint" onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
                  <small id="sw-id-hint">{t.fields.idHint}</small>
                </div>
                <div className="cf-field">
                  <label htmlFor="sw-start">{t.fields.start}</label>
                  {readonly ? <output id="sw-start">{madridDate(draft.startsAt)}</output> : <DateField id="sw-start" value={day(draft.startsAt)} onChange={(v) => setDay('startsAt', v)} />}
                </div>
                <div className="cf-field">
                  <label htmlFor="sw-end">{t.fields.end}</label>
                  {readonly ? <output id="sw-end">{madridDate(draft.endsAt)}</output> : <DateField id="sw-end" value={day(draft.endsAt)} onChange={(v) => setDay('endsAt', v)} />}
                  <small>{t.lastDay(madridDate(new Date(Date.parse(draft.endsAt) - DAY).toISOString()))}</small>
                </div>
              </div>
              {readonly ? null : (
                <div className="ev-quick">
                  {latest ? (
                    <button type="button" className="lip pill small" onClick={() => set({ startsAt: latest.endsAt, endsAt: shiftDay(latest.endsAt, length) })}>
                      {t.afterPrevious}
                    </button>
                  ) : null}
                  {[4, 5, 6].map((w) => (
                    <button key={w} type="button" className="lip pill small" onClick={() => set({ endsAt: shiftDay(draft.startsAt, w * 7) })}>
                      {t.weeks(w)}
                    </button>
                  ))}
                  <b className="ev-duration">{t.days(length)}</b>
                </div>
              )}
            </>
          ) : null}
          {step === 'rules' ? (
            <>
              <div className="cf-grid">
                <NumField id="sw-layer" label={t.fields.layer} value={p.layer} disabled={readonly} onChange={(n) => setRules({ points: { ...p, layer: n } })} />
                <NumField id="sw-core" label={t.fields.core} value={p.core} disabled={readonly} onChange={(n) => setRules({ points: { ...p, core: n } })} />
                <NumField id="sw-extraction" label={t.fields.extraction} value={p.extraction} disabled={readonly} onChange={(n) => setRules({ points: { ...p, extraction: n } })} />
                <NumField id="sw-cap" label={t.fields.cap} value={draft.rules.capPerMinute} min={1} disabled={readonly} onChange={(n) => setRules({ capPerMinute: n })} />
                <NumField id="sw-top" label={t.fields.top} value={draft.rules.top} min={3} disabled={readonly} onChange={(n) => setRules({ top: n })} />
              </div>
              <div className="cf-grid">
                {t.tierNames.map((name, i) => (
                  <NumField key={name} id={`sw-tier-${i}`} label={t.tierField(name)} value={draft.rules.tiers[i] ?? 0} min={1} disabled={readonly} onChange={(n) => setRules({ tiers: draft.rules.tiers.map((x, j) => (j === i ? n : x)) })} />
                ))}
              </div>
              <div className="lip panel ev-total" aria-live="polite">
                <p>{t.example(example)}</p>
                {example > 0 ? <p>{t.exampleTier(t.tierNames[2]!, Math.ceil(gold / example))}</p> : null}
              </div>
            </>
          ) : null}
          {step === 'content' ? (
            <>
              <dl className="ev-facts">
                <div>
                  <dt>{t.facts.route}</dt>
                  <dd>{t.routeSummary(draft.route.steps.length, draft.route.steps.at(-1)?.at ?? 0)}</dd>
                </div>
                <div>
                  <dt>{t.facts.shop}</dt>
                  <dd>
                    {t.shopSummary(draft.route.shop.length)} <small>{draft.route.currency.name}</small>
                  </dd>
                </div>
                <div>
                  <dt>{t.facts.tiers}</dt>
                  <dd>{t.closingSummary(draft.route.closing.podiumSize)}</dd>
                </div>
                <div>
                  <dt>{t.facts.missions}</dt>
                  <dd>{t.missionsSummary(draft.missions.length)}</dd>
                </div>
                <div>
                  <dt>{t.facts.lab}</dt>
                  <dd>{t.labSummary(draft.lab.length)}</dd>
                </div>
              </dl>
              {readonly ? null : (
                <>
                  <p className="panel-note">{t.contentNote}</p>
                  <div className="ev-quick">
                    <span>{t.copyFrom}</span>
                    <Select id="sw-copy" value={copyFrom} options={list.filter((s) => s.id !== draft.id).map((s) => ({ value: s.id, label: s.name }))} onChange={setCopyFrom} aria-label={t.copyFrom} />
                    <button
                      type="button"
                      className="lip pill small"
                      disabled={!copyFrom}
                      onClick={() => {
                        const s = list.find((x) => x.id === copyFrom);
                        if (!s) return;
                        set({ route: structuredClone(s.route), missions: structuredClone(s.missions), lab: structuredClone(s.lab) });
                        setNote(t.copied(s.name));
                      }}
                    >
                      <Icon name="copy" />
                      <span>{t.copyButton}</span>
                    </button>
                    <label className="lip pill small">
                      <Icon name="down" />
                      <span>{t.importFile}</span>
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="sr-only"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const data = JSON.parse(await file.text()) as Partial<Draft> & { temporada?: Partial<Draft> };
                            const r = data.temporada ?? data;
                            if (!r.route && !r.missions && !r.lab && !r.rules) throw new Error('empty');
                            setDraft((d) => ({ ...d, ...(r.rules ? { rules: { ...d.rules, ...r.rules } } : {}), ...(r.route ? { route: parseConfig('seasonRoute', r.route) } : {}), ...(r.missions ? { missions: r.missions } : {}), ...(r.lab ? { lab: r.lab } : {}) }));
                            setNote(t.imported);
                          } catch {
                            setNote(t.importBad);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  {note ? (
                    <p className="panel-note" role="status">
                      {note}
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : null}
          {step === 'anomaly' ? (
            <div className="cf-grid">
              <div className="cf-field">
                <label htmlFor="sw-anomaly">{t.fields.anomaly}</label>
                <Select id="sw-anomaly" block disabled={readonly} value={draft.rules.anomaly ?? ''} options={[{ value: '', label: t.noAnomaly }, ...anomalies]} onChange={(v) => setRules({ anomaly: v || null })} />
              </div>
              <div className="cf-field">
                <label htmlFor="sw-finish">{t.fields.finish}</label>
                <Select id="sw-finish" block disabled={readonly} value={draft.rules.finish ?? ''} options={[{ value: '', label: t.noFinish }, ...SEASON_FINISHES.map((f) => ({ value: f, label: copy.finishes[f as keyof typeof copy.finishes] ?? f }))]} onChange={(v) => setRules({ finish: (v || null) as Draft['rules']['finish'] })} />
              </div>
              <NumField id="sw-chance" label={t.fields.finishChance} value={Math.round(draft.rules.finishChance * 1000) / 10} disabled={readonly || !draft.rules.finish} onChange={(n) => setRules({ finishChance: n / 100 })} />
            </div>
          ) : null}
          {step === 'review' ? (
            <section className="ev-as-player" aria-labelledby="sw-as-player">
              <h3 id="sw-as-player">{t.asPlayerTitle}</h3>
              {own ? (
                <>
                  <p className="panel-note">{t.asPlayerHint}</p>
                  <div className="ev-quick">
                    <AsPlayerLinks id={own.id} />
                  </div>
                </>
              ) : (
                <p className="panel-note">{t.asPlayerSaveFirst}</p>
              )}
            </section>
          ) : null}
          {step === 'review' ? (
            <dl className="ev-facts">
              <div>
                <dt>{t.fields.name}</dt>
                <dd>
                  {draft.name || '—'} <small>{draft.id}</small>
                </dd>
              </div>
              <div>
                <dt>{t.when}</dt>
                <dd>
                  {madridDate(draft.startsAt)} – {madridDate(draft.endsAt)} <small>{t.days(length)}</small>
                </dd>
              </div>
              <div>
                <dt>{t.facts.tiers}</dt>
                <dd>{draft.rules.tiers.map((n) => n.toLocaleString('es-ES')).join(', ')}</dd>
              </div>
              <div>
                <dt>{t.facts.anomaly}</dt>
                <dd>{draft.rules.anomaly ? (anomalies.find((a) => a.value === draft.rules.anomaly)?.label ?? draft.rules.anomaly) : t.noAnomaly}</dd>
              </div>
            </dl>
          ) : null}
          <div className="ev-nav">
            {idx > 0 ? (
              <button type="button" className="lip pill" onClick={() => setStep(STEPS[idx - 1]!)}>
                {copy.admin.events.back}
              </button>
            ) : (
              <span />
            )}
            {idx < STEPS.length - 1 ? (
              <button type="button" className="lip pill pill-solar" onClick={() => setStep(STEPS[idx + 1]!)}>
                {copy.admin.events.next}
              </button>
            ) : null}
          </div>
        </div>
        <aside className="lip panel cf-aside" aria-live="polite">
          <section aria-label={t.issuesTitle}>
            <h2>{t.issuesTitle}</h2>
            {step === 'review' && remote.isFetching ? <p className="panel-note">{t.checking}</p> : null}
            {issues.length === 0 ? (
              <p className="panel-note">{t.noIssues}</p>
            ) : (
              <ul className="admin-issues">
                {issues.map((i) => (
                  <li key={i.path + i.message}>
                    <button type="button" className="cf-link" onClick={() => setStep(stepOf(i))}>
                      {issueText(i)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {readonly ? null : (
            <>
              <form
                className="admin-publish"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reason.trim().length >= 3 && local.length === 0) doSave();
                }}
              >
                <div className="field">
                  <label htmlFor="sw-reason">{copy.admin.fields.reason}</label>
                  <div className="control">
                    <input id="sw-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                {save.error ? <p className="field-error">{errorText(save.error, copy.errors)}</p> : null}
                <button type="submit" className="lip pill" disabled={reason.trim().length < 3 || local.length > 0 || save.isPending}>
                  {t.saveDraft}
                </button>
              </form>
              {step === 'review' ? (
                <section aria-label={t.scheduleNow}>
                  <p className="panel-note">{t.scheduleHint}</p>
                  <PublishFields
                    busy={save.isPending || schedule.isPending}
                    disabled={!valid}
                    error={schedule.error ?? save.error}
                    label={t.scheduleNow}
                    onPublish={(r, password) => doSave((pw, why) => schedule.mutate({ id: draft.id, reason: why, password: pw }, { onSuccess: () => finished(t.done.scheduled(draft.name)) }), password, r)}
                  />
                </section>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/** /admin/temporadas/nueva (or ?desde=<id> for a copy) and /admin/temporadas/<id>. */
export function SeasonWizardScreen() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const list = useAdminSeasons();
  const editing = id && id !== 'nueva' ? id : undefined;
  const seasons = list.data?.seasons;
  const own = editing ? seasons?.find((s) => s.id === editing) : undefined;
  return (
    <section className="admin-page">
      <Link to="/admin/temporadas" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.sections.seasons}</span>
      </Link>
      <h1>{editing ? (own && own.state !== 'draft' ? t.viewTitle : t.editTitle) : t.createTitle}</h1>
      {list.error ? <p className="field-error">{errorText(list.error, copy.errors)}</p> : null}
      {seasons && editing && !own ? <p className="field-error">{t.notFound}</p> : null}
      {seasons && (!editing || own) ? <Wizard key={`${editing ?? 'nueva'}:${search.get('desde') ?? ''}`} list={seasons} now={Date.parse(list.data!.now)} id={editing} from={search.get('desde')} /> : null}
    </section>
  );
}
