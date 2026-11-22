import {
  type AdminSeason,
  type AdminTournament,
  type MediaAsset,
  mediaUrl,
  TOURNAMENT_FEE_CURRENCIES,
  TOURNAMENT_MAX_DAYS,
  TOURNAMENT_METRICS,
  TOURNAMENT_MODES,
  type TournamentBigReason,
  type TournamentFilters,
  tournamentIssues,
  type TournamentIssue,
  type TournamentMetric,
  type TournamentRecord,
} from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { type CSSProperties, type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSaveTournament, useScheduleTournament, useValidateTournament } from '../../api/admin-tournaments';
import { ApiError } from '../../api/client';
import { useConfigKey } from '../../api/config';
import { useAdminMedia } from '../../api/news';
import { errorText, useMe } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { bigReasonText, type GiftCatalog } from '../../gifts/words';
import { DateField } from '../../ui/DateField';
import { Icon, type IconName } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { Switch } from '../../ui/Switch';
import { useSettled } from '../../ui/useSettled';
import { duration } from '../events/shared';
import { NumberInput } from '../forms/ConfigForm';
import { fromLocalInput, toLocalInput } from '../forms/format';
import { BigNote } from '../BigNote';
import { GiftsField } from '../GiftsField';
import { ImageField } from '../ImageField';
import { PublishFields } from '../PublishFields';
import { PlayerCard, PrizeTable } from './Preview';
import {
  BANNER,
  blocksSave,
  copyRecord,
  euros,
  feeWords,
  freshRecord,
  issueText,
  localMidnight,
  nextMonday,
  seasonFor,
  shortDay,
  slugFor,
  type Step,
  stepOf,
  STEPS,
  t,
  uniqueSlug,
} from './shared';

// The tournament wizard (plan «temporadas como fichas», part 5; GDD §13.3): a tournament in six steps — its words and
// images, its dates inside a season, how it is won and which runs count, who signs up and for what fee, its prizes by
// place with the mail's gift picker, and a review with the card and page as players will see them — checked live by
// the server on every change (each problem on its step), then saved as a draft or saved and scheduled (sign-up opens;
// it starts on its own). The fee and money prizes never go together; prizes past the mail's limits or with money need
// a superadmin. Only the project's own widgets: DateField, NumberInput, Select, Switch, Segmented, Dialog.

const DAY = 86_400_000;
/** Why scheduling needs a superadmin, in the tournaments' words. */
const BIG_WORDS = { title: t.bigTitle, you: t.bigYou, needs: t.bigNeeds, cash: t.bigCash };
const METRIC_ICON: Record<TournamentMetric, IconName> = { points: 'starOn', best_run: 'star', kills: 'target', runs: 'play', depth: 'down', cores: 'comet', extractions: 'exit', season_points: 'podium' };

/** The problems of a field (`path`) and of what is inside it, in words. */
function Problems({ issues, path, exact = false }: { issues: readonly TournamentIssue[]; path: string; exact?: boolean }) {
  const mine = issues.filter((i) => i.path === path || (!exact && i.path.startsWith(`${path}.`)));
  if (!mine.length) return null;
  return (
    <ul className="cf-problems">
      {mine.map((i) => (
        <li key={i.path + i.message}>{issueText(i)}</li>
      ))}
    </ul>
  );
}

/** A switch with its name and what it does, and the fields it opens when on. */
function ToggleRow({ label, hint, checked, disabled = false, onChange, children }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  const id = useId();
  return (
    <div className={`atn-toggle${checked ? ' on' : ''}${disabled ? ' off' : ''}`}>
      <div className="atn-toggle-head">
        <span id={`${id}-l`} className="atn-toggle-label">
          {label}
        </span>
        <Switch aria-labelledby={`${id}-l`} aria-describedby={`${id}-h`} checked={checked} disabled={disabled} onChange={onChange} />
      </div>
      <p id={`${id}-h`} className="cf-hint">
        {hint}
      </p>
      {checked && children ? <div className="cf-grid atn-toggle-body">{children}</div> : null}
    </div>
  );
}

/** A number with its label (and unit), in the config forms' own control. */
function NumberField({ label, value, unit, onChange, hint }: { label: string; value: number; unit?: 'hours' | 'eur'; onChange: (n: number) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="cf-field">
      <label htmlFor={id}>{label}</label>
      <NumberInput id={id} value={value} info={{ label, unit }} onChange={(v) => onChange(v ?? 0)} />
      {hint ? <small className="cf-hint">{hint}</small> : null}
    </div>
  );
}

/** The measures as cards: what each counts, in plain words, with an example. A radio group after the WAI-ARIA pattern. */
function MetricPicker({ value, onChange }: { value: TournamentMetric; onChange: (m: TournamentMetric) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + TOURNAMENT_METRICS.length) % TOURNAMENT_METRICS.length;
    refs.current[n]?.focus();
    onChange(TOURNAMENT_METRICS[n]!);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TOURNAMENT_METRICS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div className="atn-metrics" role="radiogroup" aria-label={t.metricsLabel}>
      {TOURNAMENT_METRICS.map((m, i) => {
        const words = t.metrics[m];
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={m === value}
            tabIndex={m === value ? 0 : -1}
            className={`atn-metric${m === value ? ' on' : ''}`}
            onClick={() => go(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="atn-metric-icon" aria-hidden="true">
              <Icon name={METRIC_ICON[m]} />
            </span>
            <b>{words.name}</b>
            <span>{words.explain}</span>
            <small>
              <em>{t.example}</em> {words.example}
            </small>
          </button>
        );
      })}
    </div>
  );
}

/** Which season the dates fall in, drawn as the tournament's stretch inside the season's. */
function SeasonFit({ season, record }: { season: AdminSeason | null; record: TournamentRecord }) {
  if (!season)
    return (
      <div className="ev-warnings atn-season-none" role="status">
        <p>
          <Icon name="alert" />
          <span>{t.noSeason}</span>
        </p>
        <Link to="/admin/temporadas" className="lip pill small">
          <Icon name="podium" />
          <span>{t.seasonsLink}</span>
        </Link>
      </div>
    );
  const s0 = Date.parse(season.startsAt);
  const span = Math.max(1, Date.parse(season.endsAt) - s0);
  const at = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - s0) / span) * 100));
  const from = at(record.startsAt);
  const to = Math.max(from + 0.8, at(record.endsAt));
  const outside = Date.parse(record.endsAt) > Date.parse(season.endsAt);
  const vars = { '--tn-from': `${from}%`, '--tn-to': `${Math.min(100, to)}%` } as CSSProperties;
  return (
    <div className="lip panel atn-season">
      <p className="atn-season-name">
        <Icon name="podium" />
        <span>{t.seasonIn(season.name, shortDay(season.startsAt), shortDay(new Date(Date.parse(season.endsAt) - 1).toISOString()))}</span>
      </p>
      <div className={`atn-timeline${outside ? ' bad' : ''}`} role="img" aria-label={t.timelineLabel} style={vars}>
        <span className="atn-timeline-run" />
      </div>
      {season.state === 'draft' ? <p className="cf-hint atn-warn">{t.seasonDraft}</p> : null}
    </div>
  );
}

/** Everything about a tournament at a glance, and the card and page as players will see them. */
export function TournamentSummary({ record, season, catalog, entrants = 0, state = 'scheduled' }: { record: TournamentRecord; season: AdminSeason | null; catalog: GiftCatalog | null; entrants?: number; state?: 'scheduled' | 'running' }) {
  const r = record;
  const [now] = useState(() => Date.now());
  const signUp = [r.exclusive ? t.exclusiveMark : null, r.entry ? `${t.facts.entry} ${feeWords(r.entry)}` : t.free, r.filters.minLevel ? t.card.level(r.filters.minLevel) : null, r.maxEntrants ? t.capSummary(r.maxEntrants) : t.noCap].filter(Boolean);
  return (
    <div className="atn-summary">
      <dl className="ev-facts atn-facts">
        <div>
          <dt>{t.facts.season}</dt>
          <dd>{season ? season.name : t.noSeason}</dd>
        </div>
        <div>
          <dt>{t.facts.when}</dt>
          <dd>
            <span>{t.card.dates(shortDay(r.startsAt), shortDay(r.endsAt))}</span>
            <small>{duration(r.startsAt, r.endsAt)}</small>
          </dd>
        </div>
        <div>
          <dt>{t.facts.metric}</dt>
          <dd>
            <span>{t.metrics[r.metric].name}</span>
            <small>{t.modes[r.filters.mode]}</small>
          </dd>
        </div>
        <div>
          <dt>{t.steps.entry}</dt>
          <dd>{signUp.join(', ')}</dd>
        </div>
        <div>
          <dt>{t.facts.prizes}</dt>
          <dd>
            <span>{r.prizes.length ? t.rangesSummary(r.prizes.length, r.prizes.at(-1)!.to) : t.noPrizes}</span>
            {r.prizes.some((p) => p.cash) ? <small className="atn-money">{t.withCash}</small> : null}
            {r.participation ? <small>{t.withParticipation}</small> : null}
          </dd>
        </div>
        <div>
          <dt>{t.facts.review}</dt>
          <dd>{t.reviewHours(r.reviewHours)}</dd>
        </div>
      </dl>
      <section className="atn-preview" aria-label={t.preview}>
        <h3>{t.preview}</h3>
        <div className="atn-preview-grid">
          <PlayerCard record={r} state={state} entrants={entrants} catalog={catalog} now={now} />
          <div className="atn-preview-page">
            {r.detailsMedia ? <img className="atn-details-img" src={mediaUrl(r.detailsMedia)} alt="" draggable={false} /> : null}
            <h4>{t.prizeTable}</h4>
            {catalog ? <PrizeTable record={r} catalog={catalog} /> : null}
            {r.rules ? (
              <>
                <h4>{t.rulesTitle}</h4>
                <p className="atn-rules">{r.rules}</p>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

/** The reasons of a 403 tournament_needs_superadmin. */
const reasonsOf = (err: unknown): TournamentBigReason[] => (err instanceof ApiError && Array.isArray(err.details.reasons) ? (err.details.reasons as TournamentBigReason[]) : []);

interface WizardProps {
  seasons: readonly AdminSeason[];
  /** The addresses taken by the other tournaments. */
  taken: ReadonlySet<string>;
  /** The draft being edited, or null for a new one. */
  own: AdminTournament | null;
  /** The tournament a new one copies, or null. */
  source: AdminTournament | null;
  initial: Step;
}

export function TournamentWizard({ seasons, taken, own, source, initial }: WizardProps) {
  const navigate = useNavigate();
  const superadmin = !!useMe().data?.roles.includes('superadmin');
  const { catalog } = useGiftCatalog();
  // `content` never comes in the keys' list (too big): its own query, like the season wizard's.
  const content = useConfigKey('content');
  const media = useAdminMedia();
  const save = useSaveTournament();
  const schedule = useScheduleTournament();
  const [draft, setDraft] = useState<TournamentRecord>(() => (own ? structuredClone(own.record) : source ? copyRecord(source.record, taken, seasons) : freshRecord(seasons)));
  // A new tournament's address follows its title until written by hand; a copy's and a saved one's stay.
  const [slugTouched, setSlugTouched] = useState(!!own || !!source);
  // Where the draft is saved (a first save creates it; a failed schedule after it must not create another).
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(own ? { id: own.id, version: own.version } : null);
  const [step, setStep] = useState<Step>(initial);
  const [reason, setReason] = useState('');
  const [via, setVia] = useState<'draft' | 'schedule'>('draft');

  const season = seasonFor(seasons, draft.startsAt);
  const record: TournamentRecord = { ...draft, seasonId: season?.id ?? '' };
  const json = JSON.stringify(record);
  const settled = useSettled(json, 400);
  const remote = useValidateTournament(useMemo(() => JSON.parse(settled) as unknown, [settled]), saved?.id ?? null, true);
  const checked = settled === json && !!remote.data && !remote.isPlaceholderData && !remote.isFetching;
  const local = useMemo(() => tournamentIssues(JSON.parse(json)), [json]);
  const issues = checked ? remote.data!.issues : local;
  const big = remote.data?.bigReasons ?? [];
  const blocking = issues.filter(blocksSave);
  const byStep = Object.fromEntries(STEPS.map((s) => [s, issues.filter((i) => stepOf(i) === s).length])) as Record<Step, number>;
  const canSchedule = checked && remote.data!.ok && !(big.length > 0 && !superadmin);
  const idx = STEPS.indexOf(step);

  const set = (patch: Partial<TournamentRecord>) => setDraft((d) => ({ ...d, ...patch }));
  const setFilters = (patch: Partial<TournamentFilters>) => setDraft((d) => ({ ...d, filters: { ...d.filters, ...patch } }));
  const setPrize = (i: number, patch: Partial<TournamentRecord['prizes'][number]>) => setDraft((d) => ({ ...d, prizes: d.prizes.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));
  const length = Date.parse(draft.endsAt) - Date.parse(draft.startsAt);
  const startAt = (iso: string) => set({ startsAt: iso, endsAt: new Date(Date.parse(iso) + (length > 0 ? length : 7 * DAY)).toISOString() });

  const data = (content.data?.data as { sectors?: { id: string; name: string; season?: boolean }[]; probes?: { id: string; name: string }[] } | undefined) ?? DEFAULT_CONTENT;
  const sectors = (data.sectors ?? []).map((s) => ({ value: s.id, label: s.name }));
  const probes = (data.probes ?? []).map((p) => ({ value: p.id, label: p.name }));
  const assets = media.data?.assets ?? [];
  const anyCash = draft.prizes.some((p) => p.cash);

  const finished = (text: string) => navigate('/admin/torneos', { state: { done: text } });
  const title = draft.title.trim() || t.card.untitled;
  const doSave = (why: string, then?: (s: AdminTournament) => void) =>
    save.mutate(
      { id: saved?.id ?? null, version: saved?.version ?? null, record, reason: why },
      {
        onSuccess: (s) => {
          setSaved({ id: s.id, version: s.version });
          if (then) then(s);
          else finished(t.done.saved(title));
        },
      },
    );
  const scheduleError = via === 'schedule' ? (schedule.error ?? save.error) : null;

  return (
    <>
      <ol className="ev-steps" aria-label={t.stepsLabel}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" aria-current={s === step ? 'step' : undefined} className={`ev-step${s === step ? ' on' : ''}${i < idx ? ' done' : ''}`} onClick={() => setStep(s)}>
              <span className="ev-step-n">{byStep[s] ? <Icon name="alert" /> : i + 1}</span>
              <span>{t.steps[s]}</span>
              {byStep[s] ? <span className="sr-only">{t.problemsIn(t.steps[s], byStep[s])}</span> : null}
            </button>
          </li>
        ))}
      </ol>
      <div className="ev-wizard">
        <div className="ev-step-body">
          <h2>{t.steps[step]}</h2>
          <p className="panel-note">{step === 'dates' ? t.stepHints.dates(TOURNAMENT_MAX_DAYS) : t.stepHints[step]}</p>

          {step === 'data' ? <DataStep record={draft} issues={issues} assets={assets} set={set} onTitle={(v) => set({ title: v, ...(slugTouched ? {} : { slug: uniqueSlug(slugFor(v), taken) }) })} onSlug={(v) => { setSlugTouched(true); set({ slug: v }); }} /> : null}

          {step === 'dates' ? (
            <>
              <div className="cf-grid">
                <DateRow label={t.fields.start} value={draft.startsAt} onChange={(iso) => set({ startsAt: iso })} issues={issues} path="startsAt" />
                <DateRow label={t.fields.end} value={draft.endsAt} onChange={(iso) => set({ endsAt: iso })} issues={issues} path="endsAt" />
              </div>
              <div className="ev-quick">
                <span>{t.quick}</span>
                <button type="button" className="lip pill small" onClick={() => startAt(localMidnight(1))}>
                  {t.startTomorrow}
                </button>
                <button type="button" className="lip pill small" onClick={() => startAt(nextMonday())}>
                  {t.startMonday}
                </button>
                <span>{t.quickLength}</span>
                {[3, 7, 14, TOURNAMENT_MAX_DAYS].map((d) => (
                  <button key={d} type="button" className="lip pill small" onClick={() => set({ endsAt: new Date(Date.parse(draft.startsAt) + d * DAY).toISOString() })}>
                    {t.days(d)}
                  </button>
                ))}
                <b className="ev-duration">{duration(draft.startsAt, draft.endsAt)}</b>
              </div>
              <SeasonFit season={season} record={draft} />
              <Problems issues={issues} path="seasonId" />
            </>
          ) : null}

          {step === 'metric' ? (
            <>
              <MetricPicker value={draft.metric} onChange={(metric) => set({ metric })} />
              <Problems issues={issues} path="metric" />
              <fieldset className="cf-group">
                <legend>{t.filtersTitle}</legend>
                <div className="cf-grid">
                  <SelectRow label={t.fields.sector} value={draft.filters.sector ?? ''} options={[{ value: '', label: t.fields.anySector }, ...sectors]} onChange={(v) => setFilters({ sector: v || null })} issues={issues} path="filters.sector" />
                  <SelectRow label={t.fields.probe} value={draft.filters.probe ?? ''} options={[{ value: '', label: t.fields.anyProbe }, ...probes]} onChange={(v) => setFilters({ probe: v || null })} issues={issues} path="filters.probe" />
                  <ModeRow value={draft.filters.mode} onChange={(mode) => setFilters({ mode })} />
                </div>
              </fieldset>
            </>
          ) : null}

          {step === 'entry' ? (
            <div className="atn-toggles">
              <ToggleRow label={t.fields.exclusive} hint={draft.exclusive ? t.exclusiveOn : t.exclusiveOff} checked={draft.exclusive} onChange={(exclusive) => set({ exclusive })} />
              <ToggleRow label={t.fields.fee} hint={anyCash ? t.feeBlocked : t.feeHint} checked={!!draft.entry} disabled={anyCash && !draft.entry} onChange={(on) => set({ entry: on ? { currency: 'coins', amount: 100 } : null })}>
                {draft.entry ? (
                  <>
                    <SelectRow
                      label={t.fields.feeCurrency}
                      value={draft.entry.currency}
                      options={TOURNAMENT_FEE_CURRENCIES.map((c) => ({ value: c, label: copy.gifts.currency[c] }))}
                      onChange={(currency) => set({ entry: { ...draft.entry!, currency: currency as (typeof TOURNAMENT_FEE_CURRENCIES)[number] } })}
                      issues={issues}
                      path="entry.currency"
                    />
                    <NumberField label={t.fields.feeAmount} value={draft.entry.amount} onChange={(amount) => set({ entry: { ...draft.entry!, amount } })} hint={feeWords(draft.entry)} />
                  </>
                ) : null}
              </ToggleRow>
              <Problems issues={issues} path="entry" />
              <ToggleRow label={t.fields.minLevel} hint={t.minLevelHint} checked={draft.filters.minLevel !== null} onChange={(on) => setFilters({ minLevel: on ? 10 : null })}>
                <NumberField label={t.fields.minLevelValue} value={draft.filters.minLevel ?? 0} onChange={(minLevel) => setFilters({ minLevel })} />
              </ToggleRow>
              <Problems issues={issues} path="filters.minLevel" />
              <ToggleRow label={t.fields.cap} hint={draft.maxEntrants === null ? t.noCap : t.capHint} checked={draft.maxEntrants !== null} onChange={(on) => set({ maxEntrants: on ? 100 : null })}>
                <NumberField label={t.fields.capValue} value={draft.maxEntrants ?? 0} onChange={(maxEntrants) => set({ maxEntrants })} />
              </ToggleRow>
              <Problems issues={issues} path="maxEntrants" />
            </div>
          ) : null}

          {step === 'prizes' ? (
            <>
              <section className="atn-ranges" aria-label={t.rangesTitle}>
                <h3>{t.rangesTitle}</h3>
                <p className="cf-hint">{t.rangesHint}</p>
                <Problems issues={issues} path="prizes" exact />
                {draft.prizes.length === 0 ? (
                  <div className="atn-ranges-empty">
                    <Icon name="trophy" />
                    <p>{t.noRanges}</p>
                    <button type="button" className="lip pill small pill-solar" onClick={() => set({ prizes: [{ from: 1, to: 1, gifts: [], cash: null }] })}>
                      <Icon name="plus" />
                      <span>{t.firstRange}</span>
                    </button>
                  </div>
                ) : (
                  <ol className="atn-range-list">
                    {draft.prizes.map((p, i) => {
                      const places = t.places(p.from, p.to);
                      const bad = issues.some((x) => x.path === `prizes.${i}` || x.path.startsWith(`prizes.${i}.`));
                      return (
                        <li key={i} className={`atn-range${bad ? ' bad' : ''}`}>
                          <div className="atn-range-head">
                            <b className="atn-place" data-place={Math.min(p.from, 4)}>
                              {places}
                            </b>
                            <button type="button" className="cf-icon-btn danger" aria-label={t.removeRange(places)} onClick={() => set({ prizes: draft.prizes.filter((_, k) => k !== i) })}>
                              <Icon name="trash" />
                            </button>
                          </div>
                          <div className="atn-range-grid">
                            <NumberField label={t.rangeFrom} value={p.from} onChange={(from) => setPrize(i, { from })} />
                            <NumberField label={t.rangeTo} value={p.to} onChange={(to) => setPrize(i, { to })} />
                            <div className="atn-range-gifts">
                              <span className="cf-absent-label">{t.giftsLabel}</span>
                              {catalog ? <GiftsField gifts={p.gifts} catalog={catalog} title={t.giftsTitle(places)} onChange={(gifts) => setPrize(i, { gifts })} /> : null}
                            </div>
                            <CashRow places={places} cash={p.cash} blocked={!!draft.entry} onChange={(cash) => setPrize(i, { cash })} />
                          </div>
                          <Problems issues={issues} path={`prizes.${i}`} />
                        </li>
                      );
                    })}
                  </ol>
                )}
                {draft.prizes.length > 0 ? (
                  <button
                    type="button"
                    className="lip pill small cf-add"
                    disabled={draft.prizes.length >= 20}
                    onClick={() => {
                      const from = (draft.prizes.at(-1)?.to ?? 0) + 1;
                      set({ prizes: [...draft.prizes, { from, to: from, gifts: [], cash: null }] });
                    }}
                  >
                    <Icon name="plus" />
                    <span>{t.addRange}</span>
                  </button>
                ) : null}
              </section>
              <ToggleRow label={t.fields.participation} hint={t.participationHint} checked={!!draft.participation} onChange={(on) => set({ participation: on ? { minRuns: 3, gifts: [] } : null })}>
                {draft.participation ? (
                  <>
                    <NumberField label={t.fields.minRuns} value={draft.participation.minRuns} onChange={(minRuns) => set({ participation: { ...draft.participation!, minRuns } })} />
                    <div className="atn-range-gifts">
                      <span className="cf-absent-label">{t.giftsLabel}</span>
                      {catalog ? <GiftsField gifts={draft.participation.gifts} catalog={catalog} title={t.participationGiftsTitle} onChange={(gifts) => set({ participation: { ...draft.participation!, gifts } })} /> : null}
                    </div>
                  </>
                ) : null}
              </ToggleRow>
              <Problems issues={issues} path="participation" />
              <div className="cf-grid">
                <NumberField label={t.fields.reviewHours} value={draft.reviewHours} unit="hours" hint={t.reviewHoursHint} onChange={(reviewHours) => set({ reviewHours })} />
              </div>
              <Problems issues={issues} path="reviewHours" />
              <BigNote reasons={big} superadmin={superadmin} catalog={catalog} words={BIG_WORDS} />
            </>
          ) : null}

          {step === 'review' ? <TournamentSummary record={record} season={season} catalog={catalog} /> : null}

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
            {!checked ? <p className="panel-note">{t.checking}</p> : null}
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
            {issues.length > 0 && blocking.length === 0 ? <p className="panel-note">{t.scheduleOnlyDraftIssues}</p> : null}
          </section>
          <form
            className="admin-publish atn-draft-form"
            aria-label={t.draftTitle}
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 3 || blocking.length > 0 || save.isPending) return;
              setVia('draft');
              doSave(reason.trim());
            }}
          >
            <h2>{t.draftTitle}</h2>
            <div className="field">
              <label htmlFor="tw-reason">{copy.admin.fields.reason}</label>
              <div className="control">
                <input id="tw-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            {via === 'draft' && save.error ? (
              <p className="field-error" role="alert">
                {errorText(save.error, copy.errors)}
              </p>
            ) : null}
            <button type="submit" className="lip pill" disabled={reason.trim().length < 3 || blocking.length > 0 || save.isPending}>
              {t.saveDraft}
            </button>
          </form>
          {step === 'review' ? (
            <section aria-label={t.scheduleNow} className="atn-schedule">
              <h2>{t.scheduleTitle}</h2>
              <p className="panel-note">{t.scheduleHint}</p>
              <BigNote reasons={big} superadmin={superadmin} catalog={catalog} words={BIG_WORDS} />
              <PublishFields
                busy={save.isPending || schedule.isPending}
                disabled={!canSchedule}
                error={null}
                label={t.scheduleNow}
                onPublish={(why, password) => {
                  setVia('schedule');
                  schedule.reset();
                  doSave(why, (s) => schedule.mutate({ id: s.id, version: s.version, reason: why, password }, { onSuccess: () => finished(t.done.scheduled(title)) }));
                }}
              />
              {scheduleError ? (
                <div className="field-error" role="alert">
                  <p>{errorText(scheduleError, copy.errors)}</p>
                  {reasonsOf(scheduleError).length ? (
                    <ul>
                      {reasonsOf(scheduleError).map((r) => (
                        <li key={r}>{r === 'cash' ? t.bigCash : catalog ? bigReasonText(r, catalog) : r}</li>
                      ))}
                    </ul>
                  ) : null}
                  {scheduleError instanceof ApiError && Array.isArray(scheduleError.details.issues) ? (
                    <ul>
                      {(scheduleError.details.issues as TournamentIssue[]).map((i) => (
                        <li key={i.path + i.message}>{issueText(i)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function DataStep({ record, issues, assets, set, onTitle, onSlug }: { record: TournamentRecord; issues: readonly TournamentIssue[]; assets: readonly MediaAsset[]; set: (p: Partial<TournamentRecord>) => void; onTitle: (v: string) => void; onSlug: (v: string) => void }) {
  return (
    <>
      <div className="cf-grid">
        <div className="cf-field">
          <label htmlFor="tw-title">{t.fields.title}</label>
          <input id="tw-title" type="text" maxLength={60} value={record.title} aria-invalid={issues.some((i) => i.path === 'title') || undefined} onChange={(e) => onTitle(e.target.value)} />
          <Problems issues={issues} path="title" />
        </div>
        <div className="cf-field">
          <label htmlFor="tw-slug">{t.fields.slug}</label>
          <input
            id="tw-slug"
            type="text"
            maxLength={48}
            spellCheck={false}
            value={record.slug}
            aria-describedby="tw-slug-hint"
            aria-invalid={issues.some((i) => i.path === 'slug') || undefined}
            onChange={(e) => onSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
          />
          <small id="tw-slug-hint" className="cf-hint">
            {t.fields.slugHint(record.slug)}
          </small>
          <Problems issues={issues} path="slug" />
        </div>
        <div className="cf-field atn-wide">
          <label htmlFor="tw-summary">{t.fields.summary}</label>
          <input id="tw-summary" type="text" maxLength={200} value={record.summary} onChange={(e) => set({ summary: e.target.value })} />
          <small className="cf-hint">{t.fields.summaryHint}</small>
          <Problems issues={issues} path="summary" />
        </div>
        <div className="cf-field atn-wide">
          <label htmlFor="tw-rules">{t.fields.rules}</label>
          <textarea id="tw-rules" rows={6} maxLength={4000} value={record.rules} onChange={(e) => set({ rules: e.target.value })} />
          <small className="cf-hint">{t.fields.rulesHint}</small>
          <Problems issues={issues} path="rules" />
        </div>
      </div>
      <h3 className="atn-subhead">{t.imagesTitle}</h3>
      <div className="atn-images">
        <div>
          <ImageField label={t.fields.banner} hint={t.fields.bannerHint(BANNER.width, BANNER.height)} value={record.bannerMedia} assets={assets} aspect="8:3" offHint={t.fields.bannerOff} onChange={(bannerMedia) => set({ bannerMedia })} />
          <Problems issues={issues} path="bannerMedia" />
        </div>
        <div>
          <ImageField label={t.fields.details} hint={t.fields.detailsHint} value={record.detailsMedia} assets={assets} aspect="16:9" onChange={(detailsMedia) => set({ detailsMedia })} />
          <Problems issues={issues} path="detailsMedia" />
        </div>
      </div>
    </>
  );
}

function DateRow({ label, value, onChange, issues, path }: { label: string; value: string; onChange: (iso: string) => void; issues: readonly TournamentIssue[]; path: string }) {
  const id = useId();
  return (
    <div className="cf-field">
      <label htmlFor={id}>{label}</label>
      <DateField
        id={id}
        time
        value={toLocalInput(value)}
        aria-invalid={issues.some((i) => i.path === path)}
        onChange={(v) => {
          const iso = fromLocalInput(v);
          if (iso) onChange(iso);
        }}
      />
      <Problems issues={issues} path={path} />
    </div>
  );
}

function SelectRow({ label, value, options, onChange, issues, path }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; issues: readonly TournamentIssue[]; path: string }) {
  const id = useId();
  return (
    <div className="cf-field">
      <label id={`${id}-l`} htmlFor={id}>
        {label}
      </label>
      <Select id={id} size="sm" block aria-labelledby={`${id}-l`} value={value} options={options} onChange={onChange} />
      <Problems issues={issues} path={path} />
    </div>
  );
}

function ModeRow({ value, onChange }: { value: TournamentFilters['mode']; onChange: (m: TournamentFilters['mode']) => void }) {
  const id = useId();
  return (
    <div className="cf-field atn-wide">
      <span id={`${id}-l`} className="cf-absent-label">
        {t.fields.mode}
      </span>
      <Segmented<TournamentFilters['mode']> aria-labelledby={`${id}-l`} value={value} options={TOURNAMENT_MODES.map((m) => ({ value: m, label: t.modes[m] }))} onChange={onChange} />
      <small className="cf-hint">{t.modeHints[value]}</small>
    </div>
  );
}

function CashRow({ places, cash, blocked, onChange }: { places: string; cash: TournamentRecord['prizes'][number]['cash']; blocked: boolean; onChange: (c: TournamentRecord['prizes'][number]['cash']) => void }) {
  const id = useId();
  return (
    <div className={`atn-cash-row${cash ? ' on' : ''}`}>
      <div className="atn-toggle-head">
        <span id={`${id}-l`} className="atn-toggle-label">
          <Icon name="coin" />
          <span>{t.cashLabel}</span>
        </span>
        <Switch aria-label={`${t.cashLabel} ${places}`} aria-describedby={`${id}-h`} checked={!!cash} disabled={blocked && !cash} onChange={(on) => onChange(on ? { amountEur: 50, note: '' } : null)} />
      </div>
      <p id={`${id}-h`} className="cf-hint">
        {blocked && !cash ? t.cashBlocked : t.cashHint}
      </p>
      {cash ? (
        <div className="cf-grid">
          <NumberField label={t.cashAmount} value={cash.amountEur} unit="eur" hint={euros(cash.amountEur)} onChange={(amountEur) => onChange({ ...cash, amountEur })} />
          <div className="cf-field">
            <label htmlFor={`${id}-n`}>{t.cashNote}</label>
            <input id={`${id}-n`} type="text" maxLength={200} value={cash.note} onChange={(e) => onChange({ ...cash, note: e.target.value })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
