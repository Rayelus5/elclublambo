import { configIssues, configJsonSchema, type EventView, eventWarnings, type GameEvent, mergeDraft, TRAIT_KEYS } from '@galaxy/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { type ConfigKeyRow, useConfigKeys, usePublishBatch } from '../../api/config';
import { errorText } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { EventsList } from '../../missions/MissionsScreen';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { ConfigForm } from '../forms/ConfigForm';
import { humanDiff } from '../forms/humanDiff';
import { issuesByPath } from '../forms/issues';
import { emptyOf } from '../forms/schema';
import { PublishFields } from '../PublishFields';
import { type Banner, bannerFor, duration, eventSchema, pick, rewardText, scannerOf, t, totals, warningText } from './shared';

// The event wizard (polish phase 4): an event in five steps (its data and dates, its goals with their rewards, what a
// player takes home, its optional scanner, and a review with the player's view, «Qué cambia» and the warnings), then
// one publish of the event and its scanner together. Every step shows its own problems; any step can be visited.

type Step = 'data' | 'goals' | 'rewards' | 'scanner' | 'review';
const STEPS: Step[] = ['data', 'goals', 'rewards', 'scanner', 'review'];
const DAY = 86_400_000;

type Scanner = { on: boolean; name: string; trait: string; value: string };

const traitValues = (trait: string) => Object.entries((copy.traitValues as Record<string, Record<string, string>>)[trait] ?? {}).filter(([v]) => v !== 'none');

/** A new event: no name yet, starting at the next full hour for two days, with one empty goal. */
const fresh = (): GameEvent => emptyOf(eventSchema()) as GameEvent;

/** The draft to start from: the event edited, a copy of one (a week later), or a new one. */
function startFrom(list: GameEvent[], banners: Banner[], id: string | undefined, from: string | null): { event: GameEvent; scanner: Scanner; original: string | null } {
  const source = list.find((e) => e.id === (id ?? from));
  const base = source ? structuredClone(source) : fresh();
  const own = source ? scannerOf(source, banners) : undefined;
  const scanner: Scanner = own?.featured
    ? { on: true, name: own.name, trait: own.featured.trait, value: own.featured.value }
    : { on: false, name: '', trait: 'phenomenon', value: traitValues('phenomenon')[0]?.[0] ?? '' };
  if (id && source) return { event: base, scanner, original: source.id };
  if (source) {
    const shift = (iso: string) => new Date(Date.parse(iso) + 7 * DAY).toISOString();
    const taken = new Set(list.map((e) => e.id));
    let n = 2;
    while (taken.has(`${source.id.replace(/-\d+$/, '')}-${n}`)) n++;
    return { event: { ...base, id: `${source.id.replace(/-\d+$/, '')}-${n}`.slice(0, 32), name: `${base.name} (copia)`.slice(0, 40), startsAt: shift(base.startsAt), endsAt: shift(base.endsAt) }, scanner, original: null };
  }
  return { event: base, scanner, original: null };
}

function Wizard({ events, gacha, id, from }: { events: ConfigKeyRow; gacha: ConfigKeyRow; id: string | undefined; from: string | null }) {
  const navigate = useNavigate();
  const publish = usePublishBatch();
  // What the draft is made on: the versions live when editing began. A publish that fails (another admin published
  // meanwhile, a wrong password) never moves it, so a second try cannot overwrite what the other admin did.
  const [base, setBase] = useState(() => ({ events: { version: events.version, data: events.data }, gacha: { version: gacha.version, data: gacha.data } }));
  const list = (base.events.data.list as GameEvent[]) ?? [];
  const banners = (base.gacha.data.banners as Banner[]) ?? [];
  const [{ event: initial, scanner: initialScanner, original }] = useState(() => startFrom(list, banners, id, from));
  const [event, setEvent] = useState<GameEvent>(initial);
  const [scanner, setScanner] = useState<Scanner>(initialScanner);
  const moved = (events.version !== base.events.version || gacha.version !== base.gacha.version) && !publish.isPending;
  const reloadLive = () => {
    const live = { events: { version: events.version, data: events.data }, gacha: { version: gacha.version, data: gacha.data } };
    const fresh = startFrom((live.events.data.list as GameEvent[]) ?? [], (live.gacha.data.banners as Banner[]) ?? [], original ?? id, from);
    setBase(live);
    setEvent(fresh.event);
    setScanner(fresh.scanner);
    publish.reset();
  };
  const [step, setStep] = useState<Step>('data');
  const [autoIds] = useState(() => new Set<string>());
  const schema = eventSchema();

  // The lists as they would be published.
  const at = original ? list.findIndex((e) => e.id === original) : list.length;
  const nextList = original ? list.map((e, i) => (i === at ? event : e)) : [...list, event];
  const oldBanner = original ? scannerOf({ id: original }, banners) : undefined;
  const fields = { name: scanner.name || t.scannerDefault(event.name), trait: scanner.trait, value: scanner.value };
  // An existing scanner keeps its id, pity group (players' pity lives there) and place; only what the wizard edits
  // changes, and it opens and closes with the event.
  const nextBanners = !scanner.on
    ? banners.filter((b) => b !== oldBanner)
    : oldBanner
      ? banners.map((b) => (b === oldBanner ? { ...b, name: fields.name, featured: { trait: fields.trait, value: fields.value }, startsAt: event.startsAt, endsAt: event.endsAt } : b))
      : [...banners, bannerFor(event, fields)];
  const bannersChanged = JSON.stringify(nextBanners) !== JSON.stringify(banners);
  const eventsChanged = JSON.stringify(nextList) !== JSON.stringify(list);

  const eventIssues = configIssues('events', mergeDraft('events', base.events.data, { list: nextList }));
  const prefix = `list.${at}`;
  const mine = eventIssues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`)).map((i) => ({ ...i, path: i.path === prefix ? '' : i.path.slice(prefix.length + 1) }));
  const others = eventIssues.filter((i) => !(i.path === prefix || i.path.startsWith(`${prefix}.`)));
  const gachaIssues = bannersChanged ? configIssues('gacha', mergeDraft('gacha', base.gacha.data, { banners: nextBanners })) : [];
  const byStep: Record<Step, number> = {
    data: mine.filter((i) => !i.path.startsWith('goals')).length + others.length,
    goals: mine.filter((i) => i.path.startsWith('goals')).length,
    rewards: 0,
    scanner: gachaIssues.length,
    review: 0,
  };
  const valid = eventIssues.length === 0 && gachaIssues.length === 0;
  const names = { ...Object.fromEntries(nextList.map((e) => [e.id, e.name])) };
  const warnings = eventWarnings(nextList, nextBanners).filter((w) => ('event' in w ? w.event === event.id : w.banner === event.id));
  const changes = [
    ...(eventsChanged ? humanDiff('events', configJsonSchema('events'), base.events.data, { ...base.events.data, list: nextList }) : []),
    ...(bannersChanged ? humanDiff('gacha', configJsonSchema('gacha'), base.gacha.data, { ...base.gacha.data, banners: nextBanners }) : []),
  ];
  const issues = issuesByPath(mine);
  const setDates = (startsAt: string, days: number) => {
    // A cleared start counts from now.
    const from = Number.isNaN(Date.parse(startsAt)) ? Date.now() : Date.parse(startsAt);
    setEvent({ ...event, startsAt: new Date(from).toISOString(), endsAt: new Date(from + days * DAY).toISOString() });
  };
  const days = Math.max(1, Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / DAY) || 7);
  const now = new Date();
  now.setSeconds(0, 0);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const preview: EventView = {
    id: event.id,
    name: event.name || t.untitled,
    description: event.description,
    endsAt: event.endsAt,
    period: `e:${event.id}`,
    inClan: true,
    goals: event.goals.map((g) => ({ id: g.id, name: g.name, stat: g.stat, target: g.target, scope: g.scope ?? 'personal', reward: g.reward, progress: 0, claimed: false })),
  };
  const personal = totals(event.goals, 'personal');
  const clan = totals(event.goals, 'clan');
  const idx = STEPS.indexOf(step);

  return (
    <>
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
              {others.length ? (
                <ul className="cf-problems" role="alert">
                  {others.map((i) => (
                    <li key={i.path + i.message}>{i.message}</li>
                  ))}
                </ul>
              ) : null}
              <ConfigForm
                cfgKey="events"
                prefix="list[]"
                schema={pick(schema, ['name', 'id', 'description', 'startsAt', 'endsAt'])}
                value={event}
                onChange={(v) => setEvent(v as GameEvent)}
                issues={issues}
                options={{}}
                autoIds={autoIds}
                live={base.events.data}
              />
              <div className="ev-quick">
                <span>{t.quickStart}</span>
                <button type="button" className="lip pill small" onClick={() => setDates(now.toISOString(), days)}>
                  {t.startNow}
                </button>
                <button type="button" className="lip pill small" onClick={() => setDates(midnight.toISOString(), days)}>
                  {t.startTomorrow}
                </button>
                <span>{t.quickLength}</span>
                {[3, 7, 14].map((d) => (
                  <button key={d} type="button" className="lip pill small" onClick={() => setDates(event.startsAt, d)}>
                    {t.days(d)}
                  </button>
                ))}
                <b className="ev-duration">{duration(event.startsAt, event.endsAt)}</b>
              </div>
            </>
          ) : null}
          {step === 'goals' ? (
            <ConfigForm cfgKey="events" prefix="list[]" schema={pick(schema, ['goals'])} value={event} onChange={(v) => setEvent(v as GameEvent)} issues={issues} options={{}} autoIds={autoIds} live={base.events.data} />
          ) : null}
          {step === 'rewards' ? (
            <div className="ev-rewards">
              <div className="lip panel ev-total">
                <h3>{t.perPlayer}</h3>
                <p>{rewardText(personal)}</p>
              </div>
              {event.goals.some((g) => g.scope === 'clan') ? (
                <div className="lip panel ev-total">
                  <h3>{t.perClanMember}</h3>
                  <p>{rewardText(clan)}</p>
                </div>
              ) : null}
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t.goal}</th>
                    <th scope="col">{t.forWho}</th>
                    <th scope="col">{t.reward}</th>
                  </tr>
                </thead>
                <tbody>
                  {event.goals.map((g, i) => (
                    <tr key={`${g.id}-${i}`}>
                      <th scope="row">{g.name || t.untitled}</th>
                      <td>{g.scope === 'clan' ? t.clan : t.personal}</td>
                      <td>{rewardText(g.reward ?? {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {event.goals.length === 0 ? <p className="panel-note">{t.noGoals}</p> : null}
            </div>
          ) : null}
          {step === 'scanner' ? (
            <div className="ev-scanner">
              <label className="ev-toggle">
                <button type="button" role="switch" aria-checked={scanner.on} className={`admin-switch${scanner.on ? ' on' : ''}`} onClick={() => setScanner({ ...scanner, on: !scanner.on })} aria-label={t.scannerOn}>
                  <span aria-hidden="true" />
                </button>
                <span>{t.scannerOn}</span>
              </label>
              <p className="panel-note">{t.scannerHint}</p>
              {scanner.on ? (
                <div className="cf-grid">
                  <div className="cf-field">
                    <label htmlFor="ev-sc-name">{t.scannerName}</label>
                    <input id="ev-sc-name" type="text" maxLength={60} value={scanner.name} placeholder={t.scannerDefault(event.name)} onChange={(e) => setScanner({ ...scanner, name: e.target.value })} />
                  </div>
                  <div className="cf-field">
                    <label htmlFor="ev-sc-trait">{t.scannerTrait}</label>
                    <Select
                      id="ev-sc-trait"
                      block
                      value={scanner.trait}
                      options={TRAIT_KEYS.map((k) => ({ value: k, label: copy.traitNames[k] ?? k }))}
                      onChange={(trait) => setScanner({ ...scanner, trait, value: traitValues(trait)[0]?.[0] ?? '' })}
                    />
                  </div>
                  <div className="cf-field">
                    <label htmlFor="ev-sc-value">{t.scannerValue}</label>
                    <Select
                      id="ev-sc-value"
                      block
                      value={scanner.value}
                      options={traitValues(scanner.trait).map(([value, label]) => ({ value, label }))}
                      onChange={(value) => setScanner({ ...scanner, value })}
                    />
                  </div>
                </div>
              ) : null}
              {gachaIssues.length ? (
                <ul className="cf-problems" role="alert">
                  {gachaIssues.map((i) => (
                    <li key={i.path + i.message}>{i.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {step === 'review' ? (
            <div className="ev-review">
              <section aria-label={t.preview}>
                <h3>{t.preview}</h3>
                <div className="ev-preview">
                  <EventsList events={[preview]} pending onClaim={() => undefined} />
                </div>
              </section>
            </div>
          ) : null}
          <div className="ev-nav">
            {idx > 0 ? (
              <button type="button" className="lip pill" onClick={() => setStep(STEPS[idx - 1]!)}>
                {t.back}
              </button>
            ) : (
              <span />
            )}
            {idx < STEPS.length - 1 ? (
              <button type="button" className="lip pill pill-solar" onClick={() => setStep(STEPS[idx + 1]!)}>
                {t.next}
              </button>
            ) : null}
          </div>
        </div>
        <aside className="lip panel cf-aside" aria-live="polite">
          {warnings.length ? (
            <section aria-label={t.warningsTitle}>
              <h2>{t.warningsTitle}</h2>
              <ul className="ev-warnings">
                {warnings.map((w) => (
                  <li key={w.code}>
                    <Icon name="alert" />
                    <span>{warningText(w, names)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {valid ? (
            <section aria-label={copy.admin.config.changesTitle}>
              <h2>{copy.admin.config.changesTitle}</h2>
              {changes.length ? (
                <ul className="admin-changes">
                  {changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="panel-note">{copy.admin.config.noChanges}</p>
              )}
            </section>
          ) : (
            <section aria-label={copy.admin.config.issuesTitle}>
              <h2>{copy.admin.config.issuesTitle}</h2>
              <ul className="admin-issues">
                {STEPS.filter((s) => byStep[s]).map((s) => (
                  <li key={s}>
                    <button type="button" className="cf-link" onClick={() => setStep(s)}>
                      {t.problemsIn(t.steps[s], byStep[s])}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {moved ? (
            <div className="admin-moved" role="status">
              <p>{t.moved(events.version !== base.events.version ? events.version : gacha.version)}</p>
              <button type="button" className="lip pill small" onClick={reloadLive}>
                {t.reloadLive}
              </button>
            </div>
          ) : null}
          <PublishFields
            busy={publish.isPending}
            disabled={!valid || changes.length === 0}
            error={publish.error}
            label={original ? t.saveChanges : t.publishEvent}
            onPublish={(reason, password) =>
              publish.mutate(
                {
                  items: [
                    ...(eventsChanged ? [{ key: 'events' as const, data: { list: nextList }, baseVersion: base.events.version }] : []),
                    ...(bannersChanged ? [{ key: 'gacha' as const, data: { banners: nextBanners }, baseVersion: base.gacha.version }] : []),
                  ],
                  reason,
                  password,
                },
                { onSuccess: () => navigate('/admin/eventos', { state: { published: event.name } }) },
              )
            }
          />
        </aside>
      </div>
    </>
  );
}

/** /admin/eventos/nuevo (or ?desde=<id> for a copy) and /admin/eventos/<id>. */
export function EventWizardScreen() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const keys = useConfigKeys();
  const events = keys.data?.find((k) => k.key === 'events');
  const gacha = keys.data?.find((k) => k.key === 'gacha');
  const editing = id && id !== 'nuevo' ? id : undefined;
  const exists = editing ? ((events?.data.list as GameEvent[] | undefined) ?? []).some((e) => e.id === editing) : true;
  return (
    <section className="admin-page">
      <Link to="/admin/eventos" className="lip pill small">
        <Icon name="back" />
        <span>{copy.admin.sections.events}</span>
      </Link>
      <h1>{editing ? t.editTitle : t.createTitle}</h1>
      {keys.error ? <p className="field-error">{errorText(keys.error, copy.errors)}</p> : null}
      {events && gacha && !exists ? <p className="field-error">{t.notFound}</p> : null}
      {events && gacha && exists ? <Wizard key={`${editing ?? 'nuevo'}:${search.get('desde') ?? ''}`} events={events} gacha={gacha} id={editing} from={search.get('desde')} /> : null}
    </section>
  );
}

