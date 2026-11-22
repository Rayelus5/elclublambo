import {
  type AdminPopup,
  type BigGiftReason,
  mediaUrl,
  POPUP_KINDS,
  POPUP_MAX_DAYS,
  POPUP_MAX_QUESTIONS,
  POPUP_MAX_SHOWS,
  POPUP_PRIORITIES,
  POPUPS_PER_DAY,
  type PopupIssue,
  popupIssues,
  type PopupKind,
  type PopupQuestion,
  type PopupRecord,
} from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { usePublishPopup, useSavePopup, useValidatePopup } from '../../api/admin-popups';
import { ApiError } from '../../api/client';
import { useLiveContent } from '../../api/content';
import { useAdminMedia } from '../../api/news';
import { errorText, useMe } from '../../auth/useMe';
import { copy } from '../../copy/es';
import { useGiftCatalog } from '../../gifts/useGiftCatalog';
import { bigReasonText, type GiftCatalog } from '../../gifts/words';
import { DateField } from '../../ui/DateField';
import { Icon } from '../../ui/Icon';
import { Segmented } from '../../ui/Segmented';
import { useSettled } from '../../ui/useSettled';
import { BigNote } from '../BigNote';
import { AudienceFields, useAudienceReach } from '../communication/AudienceFields';
import { type AudienceValue, valueOfAudience } from '../communication/audience';
import { duration } from '../events/shared';
import { fromLocalInput, toLocalInput } from '../forms/format';
import { GiftLine, GiftsField } from '../GiftsField';
import { IMAGE_SIZES, ImageField } from '../ImageField';
import { LinkField } from '../LinkField';
import { PublishFields } from '../PublishFields';
import { Problems, TextRow, ToggleRow } from './fields';
import { PopupPreview } from './PopupPreview';
import { QuestionsEditor } from './QuestionsEditor';
import {
  applyTemplate,
  audienceWords,
  blocksSave,
  copyRecord,
  dates,
  freshRecord,
  issueText,
  KIND_ICON,
  nextHour,
  type Step,
  stepOf,
  stepsOf,
  t,
  TEMPLATE_ICON,
  TEMPLATES,
  tomorrow,
  viewOfRecord,
  withKind,
} from './shared';

// The wizard of «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5), after the tournaments' one: a campaign in six
// steps (a promotion skips its questions and its reward) — its kind and words (maybe from a template), its questions,
// its image and «Ver más», who sees it and when, its reward, and a review with the real popup as each player will see
// it — checked live by the server on every change (each problem counted on its step), then saved as a draft or saved
// and published with the admin's password (a superadmin's when the reward is past the mail's limits). Only the
// project's own widgets: DateField, NumberInput, Select, Segmented, Switch, Dialog and PublishFields.

const DAY = 86_400_000;
const BIG_WORDS = { title: t.bigTitle, you: t.bigYou, needs: t.bigNeeds };
const IMAGE = IMAGE_SIZES['16:9'];

/** The reasons of a 403 popup_needs_superadmin. */
const reasonsOf = (err: unknown): BigGiftReason[] => (err instanceof ApiError && Array.isArray(err.details.reasons) ? (err.details.reasons as BigGiftReason[]) : []);
/** The issues of a 400 popup_invalid. */
const issuesOf = (err: unknown): PopupIssue[] => (err instanceof ApiError && Array.isArray(err.details.issues) ? (err.details.issues as PopupIssue[]) : []);

/** The kinds as cards: what each is, in plain words. A radio group after the WAI-ARIA pattern. */
function KindPicker({ value, onChange }: { value: PopupKind; onChange: (k: PopupKind) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + POPUP_KINDS.length) % POPUP_KINDS.length;
    refs.current[n]?.focus();
    onChange(POPUP_KINDS[n]!);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? POPUP_KINDS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };
  return (
    <div className="apop-kinds" role="radiogroup" aria-label={t.kindsLabel}>
      {POPUP_KINDS.map((k, i) => (
        <button
          key={k}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={k === value}
          tabIndex={k === value ? 0 : -1}
          className={`apop-kind-card${k === value ? ' on' : ''}`}
          data-kind={k}
          onClick={() => go(i)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="apop-kind-icon" aria-hidden="true">
            <Icon name={KIND_ICON[k]} />
          </span>
          <b>{t.kinds[k]}</b>
          <span>{k === 'form' ? t.kindHints.form(POPUP_MAX_QUESTIONS) : t.kindHints[k]}</span>
        </button>
      ))}
    </div>
  );
}

/** A day and time in the admin's own time. */
function DateRow({ label, value, onChange, issues, path }: { label: string; value: string; onChange: (iso: string) => void; issues: readonly PopupIssue[]; path: string }) {
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

/** Everything about a campaign at a glance (the review step, and a scheduled campaign's page). */
export function PopupFacts({ record, reach, catalog }: { record: PopupRecord; reach?: number; catalog: GiftCatalog | null }) {
  const r = record;
  const who = audienceWords(r.audience);
  return (
    <dl className="ev-facts apop-facts">
      <div>
        <dt>{t.facts.kind}</dt>
        <dd>
          <span className="apop-kind" data-kind={r.kind}>
            <Icon name={KIND_ICON[r.kind]} />
            {t.kinds[r.kind]}
          </span>
          {r.kind !== 'promotion' ? <small>{t.questionsCount(r.questions.length)}</small> : null}
        </dd>
      </div>
      <div>
        <dt>{t.facts.when}</dt>
        <dd>
          <span>{dates(r.startsAt, r.endsAt)}</span>
          <small>{duration(r.startsAt, r.endsAt)}</small>
        </dd>
      </div>
      <div>
        <dt>{t.facts.audience}</dt>
        <dd>
          <span>{who.text}</span>
          {who.detail ? <small>{who.detail}</small> : null}
          {reach !== undefined ? <small>{t.reach(reach)}</small> : null}
        </dd>
      </div>
      <div>
        <dt>{t.facts.priority}</dt>
        <dd>{t.priorities[r.priority]}</dd>
      </div>
      <div>
        <dt>{t.facts.image}</dt>
        <dd>{r.imageMedia ? <img className="apop-facts-thumb" src={mediaUrl(r.imageMedia)} alt="" draggable={false} /> : t.noImage}</dd>
      </div>
      {r.kind === 'promotion' ? (
        <div>
          <dt>{t.facts.link}</dt>
          <dd>{r.link ? r.link.label || t.facts.link : t.noLink}</dd>
        </div>
      ) : (
        <div className="apop-facts-wide">
          <dt>{t.facts.reward}</dt>
          <dd>{r.reward.length && catalog ? <GiftLine gifts={r.reward} catalog={catalog} /> : t.noReward}</dd>
        </div>
      )}
    </dl>
  );
}

interface WizardProps {
  /** The draft being edited, or null for a new one. */
  own: AdminPopup | null;
  /** The campaign a new one copies, or null. */
  source: AdminPopup | null;
  initial: Step;
}

export function PopupWizard({ own, source, initial }: WizardProps) {
  const navigate = useNavigate();
  const superadmin = !!useMe().data?.roles.includes('superadmin');
  const { catalog } = useGiftCatalog();
  const content = useLiveContent();
  const media = useAdminMedia();
  const save = useSavePopup();
  const publish = usePublishPopup();
  const [draft, setDraft] = useState<PopupRecord>(() => (own ? structuredClone(own.record) : source ? copyRecord(source.record) : freshRecord()));
  const [audience, setAudience] = useState<AudienceValue>(() => valueOfAudience(draft.audience));
  // The reward's gifts stay in the draft while it is switched off (switching it on again brings them back).
  const [rewardOn, setRewardOn] = useState(draft.reward.length > 0);
  // Each kind's questions, kept while trying another kind.
  const kept = useRef<Partial<Record<PopupKind, PopupQuestion[]>>>({});
  // Where the draft is saved (a first save creates it; a failed publish after it must not create another).
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(own ? { id: own.id, version: own.version } : null);
  const [step, setStep] = useState<Step>(initial);
  const [reason, setReason] = useState('');
  const [via, setVia] = useState<'draft' | 'publish'>('draft');

  const reach = useAudienceReach(audience);
  const promo = draft.kind === 'promotion';
  const withReward = !promo && rewardOn;
  const record: PopupRecord = { ...draft, audience: reach.audience ?? draft.audience, reward: withReward ? draft.reward : [] };
  const json = JSON.stringify(record);
  const settled = useSettled(json, 400);
  const remote = useValidatePopup(useMemo(() => JSON.parse(settled) as unknown, [settled]), saved?.id ?? null, true);
  const checked = settled === json && !!remote.data && !remote.isPlaceholderData && !remote.isFetching;
  const local = useMemo(() => popupIssues(JSON.parse(json)), [json]);
  // What only the wizard knows: an audience still being written, a reward switched on with nothing in it.
  const wizardIssues: PopupIssue[] = [
    ...(reach.audience ? [] : [{ path: 'audience', message: 'popup_audience_incomplete' }]),
    ...(withReward && draft.reward.length === 0 ? [{ path: 'reward', message: 'popup_reward_empty' }] : []),
  ];
  const issues = [...wizardIssues, ...(checked ? remote.data!.issues : local)];
  const big = remote.data?.bigReasons ?? [];
  const blocking = issues.filter(blocksSave);
  const steps = stepsOf(draft.kind);
  const at = steps.includes(step) ? step : 'kind';
  const byStep = Object.fromEntries(steps.map((s) => [s, issues.filter((i) => stepOf(i, draft.kind) === s).length])) as Record<Step, number>;
  const canPublish = checked && remote.data!.ok && wizardIssues.length === 0 && !(big.length > 0 && !superadmin);
  const idx = steps.indexOf(at);

  const set = (patch: Partial<PopupRecord>) => setDraft((d) => ({ ...d, ...patch }));
  const setKind = (kind: PopupKind) => {
    kept.current[draft.kind] = draft.questions;
    setDraft(withKind(draft, kind, kept.current[kind]));
  };
  const length = Date.parse(draft.endsAt) - Date.parse(draft.startsAt);
  const startAt = (iso: string) => set({ startsAt: iso, endsAt: new Date(Date.parse(iso) + (length > 0 ? length : 7 * DAY)).toISOString() });

  const finished = (text: string) => navigate('/admin/encuestas', { state: { done: text } });
  const title = draft.title.trim() || t.untitled;
  const doSave = (why: string, then?: (s: AdminPopup) => void) =>
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
  const publishError = via === 'publish' ? (publish.error ?? save.error) : null;

  return (
    <>
      <ol className="ev-steps" aria-label={t.stepsLabel}>
        {steps.map((s, i) => (
          <li key={s}>
            <button type="button" aria-current={s === at ? 'step' : undefined} className={`ev-step${s === at ? ' on' : ''}${i < idx ? ' done' : ''}`} onClick={() => setStep(s)}>
              <span className="ev-step-n">{byStep[s] ? <Icon name="alert" /> : i + 1}</span>
              <span>{t.steps[s]}</span>
              {byStep[s] ? <span className="sr-only">{t.problemsIn(t.steps[s], byStep[s])}</span> : null}
            </button>
          </li>
        ))}
      </ol>
      <div className="ev-wizard">
        <div className="ev-step-body">
          <h2>{t.steps[at]}</h2>
          <p className="panel-note">
            {at === 'questions' ? (draft.kind === 'form' ? t.stepHints.questions.form(POPUP_MAX_QUESTIONS) : draft.kind === 'promotion' ? '' : t.stepHints.questions[draft.kind]) : t.stepHints[at]}
          </p>

          {at === 'kind' ? (
            <>
              <KindPicker value={draft.kind} onChange={setKind} />
              <Problems issues={issues} path="kind" />
              <Templates onPick={(id) => setDraft(applyTemplate(draft, id, content.enemies[0]?.id ?? null))} />
              <div className="cf-grid">
                <TextRow label={t.fields.title} value={draft.title} max={80} wide hint={t.fields.titleHint[draft.kind]} issues={issues} path="title" onChange={(title) => set({ title })} />
                <TextRow label={t.fields.body} value={draft.body} max={1200} wide multiline hint={t.fields.bodyHint[draft.kind]} issues={issues} path="body" onChange={(body) => set({ body })} />
              </div>
            </>
          ) : null}

          {at === 'questions' && !promo ? <QuestionsEditor kind={draft.kind as Exclude<PopupKind, 'promotion'>} questions={draft.questions} issues={issues} content={content} onChange={(questions) => set({ questions })} /> : null}

          {at === 'media' ? (
            <>
              <div className="apop-media">
                <div>
                  <ImageField
                    label={t.fields.image}
                    hint={t.fields.imageHint(IMAGE.width, IMAGE.height)}
                    value={draft.imageMedia}
                    assets={media.data?.assets ?? []}
                    aspect="16:9"
                    offHint={t.fields.imageOff}
                    onChange={(imageMedia) => set({ imageMedia })}
                  />
                  <Problems issues={issues} path="imageMedia" />
                </div>
                <div>
                  {promo ? (
                    <>
                      <LinkField legend={t.fields.link} value={draft.link} onChange={(link) => set({ link })} />
                      <Problems issues={issues} path="link" />
                    </>
                  ) : (
                    <p className="apop-note">
                      <Icon name="info" />
                      <span>{t.fields.linkOnlyPromotion}</span>
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {at === 'audience' ? (
            <AudienceStep record={draft} audience={audience} reach={reach} issues={issues} withReward={withReward} onAudience={setAudience} set={set} startAt={startAt} />
          ) : null}

          {at === 'reward' && !promo ? (
            <>
              <ToggleRow label={t.rewardSwitch} hint={rewardOn ? t.rewardOn : t.rewardOff} checked={rewardOn} onChange={setRewardOn}>
                <div className="apop-reward">
                  <span className="cf-absent-label">{t.giftsLabel}</span>
                  {catalog ? <GiftsField gifts={draft.reward} catalog={catalog} title={t.giftsTitle} onChange={(reward) => set({ reward })} /> : null}
                  <ul className="apop-rules">
                    <li>{t.rewardRules}</li>
                    <li>{t.rewardLasting}</li>
                  </ul>
                </div>
              </ToggleRow>
              <Problems issues={issues} path="reward" />
              <BigNote reasons={big} superadmin={superadmin} catalog={catalog} words={BIG_WORDS} />
            </>
          ) : null}

          {at === 'review' ? <PopupFacts record={record} reach={reach.recipients} catalog={catalog} /> : null}

          <div className="ev-nav">
            {idx > 0 ? (
              <button type="button" className="lip pill" onClick={() => setStep(steps[idx - 1]!)}>
                {copy.admin.events.back}
              </button>
            ) : (
              <span />
            )}
            {idx < steps.length - 1 ? (
              <button type="button" className="lip pill pill-solar" onClick={() => setStep(steps[idx + 1]!)}>
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
                    <button type="button" className="cf-link" onClick={() => setStep(stepOf(i, draft.kind))}>
                      {issueText(i)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {issues.length > 0 && blocking.length === 0 ? <p className="panel-note">{t.publishOnlyDraftIssues}</p> : null}
          </section>
          <form
            className="admin-publish"
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
              <label htmlFor="pw-reason">{copy.admin.fields.reason}</label>
              <div className="control">
                <input id="pw-reason" type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
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
          {at === 'review' ? (
            <section aria-label={t.publishNow} className="apop-publish">
              <h2>{t.publishTitle}</h2>
              <p className="panel-note">{t.publishHint}</p>
              <BigNote reasons={big} superadmin={superadmin} catalog={catalog} words={BIG_WORDS} />
              <PublishFields
                busy={save.isPending || publish.isPending}
                disabled={!canPublish}
                error={null}
                label={t.publishNow}
                onPublish={(why, password) => {
                  setVia('publish');
                  publish.reset();
                  doSave(why, (s) => publish.mutate({ id: s.id, version: s.version, reason: why, password }, { onSuccess: () => finished(t.done.published(title)) }));
                }}
              />
              {publishError ? (
                <div className="field-error" role="alert">
                  <p>{errorText(publishError, copy.errors)}</p>
                  {reasonsOf(publishError).length ? (
                    <ul>
                      {reasonsOf(publishError).map((r) => (
                        <li key={r}>{catalog ? bigReasonText(r, catalog) : r}</li>
                      ))}
                    </ul>
                  ) : null}
                  {issuesOf(publishError).length ? (
                    <ul>
                      {issuesOf(publishError).map((i) => (
                        <li key={i.path + i.message}>{issueText(i)}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
        {at === 'review' ? <ReviewPreview json={json} content={content} /> : null}
      </div>
    </>
  );
}

/** The templates: a kind and its questions ready, from a click. */
function Templates({ onPick }: { onPick: (id: (typeof TEMPLATES)[number]) => void }) {
  const id = useId();
  return (
    <section className="apop-templates" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{t.templatesTitle}</h3>
      <p className="cf-hint">{t.templatesHint}</p>
      <ul>
        {TEMPLATES.map((x) => (
          <li key={x}>
            <button type="button" className="apop-template" onClick={() => onPick(x)}>
              <Icon name={TEMPLATE_ICON[x]} />
              <span>
                <b>{t.templates[x].name}</b>
                <small>{t.templates[x].hint}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AudienceStep({
  record,
  audience,
  reach,
  issues,
  withReward,
  onAudience,
  set,
  startAt,
}: {
  record: PopupRecord;
  audience: AudienceValue;
  reach: ReturnType<typeof useAudienceReach>;
  issues: readonly PopupIssue[];
  withReward: boolean;
  onAudience: (v: AudienceValue) => void;
  set: (p: Partial<PopupRecord>) => void;
  startAt: (iso: string) => void;
}) {
  const id = useId();
  return (
    <>
      <fieldset className="cf-group apop-audience">
        <legend>{t.facts.audience}</legend>
        <AudienceFields value={audience} onChange={onAudience} reach={reach} segmentHint={t.segmentHint} />
        <Problems issues={issues} path="audience" />
        <ul className="apop-rules">
          <li>{t.newcomers}</li>
          {withReward ? <li className="warn">{t.newcomersReward}</li> : null}
        </ul>
      </fieldset>
      <fieldset className="cf-group">
        <legend>{t.facts.when}</legend>
        <div className="cf-grid">
          <DateRow label={t.fields.start} value={record.startsAt} onChange={(iso) => set({ startsAt: iso })} issues={issues} path="startsAt" />
          <DateRow label={t.fields.end} value={record.endsAt} onChange={(iso) => set({ endsAt: iso })} issues={issues} path="endsAt" />
        </div>
        <div className="ev-quick">
          <span>{t.quick}</span>
          <button type="button" className="lip pill small" onClick={() => startAt(nextHour())}>
            {t.startNow}
          </button>
          <button type="button" className="lip pill small" onClick={() => startAt(tomorrow())}>
            {t.startTomorrow}
          </button>
          <span>{t.quickLength}</span>
          {[1, 3, 7, 14, 30].map((d) => (
            <button key={d} type="button" className="lip pill small" onClick={() => set({ endsAt: new Date(Date.parse(record.startsAt) + d * DAY).toISOString() })}>
              {t.days(d)}
            </button>
          ))}
          <b className="ev-duration">{duration(record.startsAt, record.endsAt)}</b>
        </div>
        <p className="cf-hint">{t.maxDays(POPUP_MAX_DAYS)}</p>
      </fieldset>
      <div className="cf-field">
        <span id={`${id}-p`} className="cf-absent-label">
          {t.fields.priority}
        </span>
        <Segmented<string>
          aria-labelledby={`${id}-p`}
          aria-describedby={`${id}-ph`}
          value={String(record.priority)}
          options={POPUP_PRIORITIES.map((p) => ({ value: String(p), label: t.priorities[p]! }))}
          onChange={(v) => set({ priority: Number(v) })}
        />
        <small id={`${id}-ph`} className="cf-hint">
          {t.priorityHint}. {t.rhythm(POPUPS_PER_DAY, POPUP_MAX_SHOWS)}
        </small>
      </div>
    </>
  );
}

/** The review's popup as the player will see it, the wizard's whole width (under the steps and the aside). */
function ReviewPreview({ json, content }: { json: string; content: Content }) {
  // The record as text: the popup is built again only when something in it changed.
  const view = useMemo(() => viewOfRecord(JSON.parse(json) as PopupRecord, content), [json, content]);
  return (
    <div className="apop-review-row">
      <PopupPreview view={view} />
    </div>
  );
}
