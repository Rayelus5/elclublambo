import { z } from 'zod';
import { type MailAudience, mailAudienceSchema } from '../api/mail';
import { newsLinkSchema } from '../api/news';
import type { CosmeticsConfig } from '../cosmetics/catalog';
import type { MailLimits } from '../gifts/limits';
import { type BigGiftReason, bigGiftReasons, type GiftIssueCode, giftIssues, type GiftLive } from '../gifts/rules';
import { giftListSchema } from '../gifts/schema';

// «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A): popups an admin publishes that come up when a player opens
// the game, for everyone or for a list or a segment of players. Four kinds: a survey (one 1–5 or 0–10 scale, maybe
// about an enemy, a Core, a probe or a sector), a review (stars and maybe a text), a form (1 to 10 questions of any
// type, one per screen) and a promotion (a big image, a title, a text and «Ver más»). The first three may give a reward
// for answering; a promotion never does. Pure: the panel shows the same problems the server enforces.

/** The kinds of a campaign (Encuesta, Valoración, Formulario, Promoción [U]). */
export const POPUP_KINDS = ['survey', 'review', 'form', 'promotion'] as const;
export type PopupKind = (typeof POPUP_KINDS)[number];

/** What a campaign is at a moment (deduced from its dates; no job needed): see `popupState`. */
export const POPUP_STATES = ['draft', 'scheduled', 'live', 'ended'] as const;
export type PopupState = (typeof POPUP_STATES)[number];
/** What the server keeps: a draft or a published campaign (its dates and `endedAt` say the rest). */
export type PopupStoredState = 'draft' | 'published';

/** What a scale question can be about: drawn next to it with its sprite and its name. */
export const POPUP_SUBJECT_KINDS = ['enemy', 'boss', 'probe', 'sector'] as const;
export type PopupSubjectKind = (typeof POPUP_SUBJECT_KINDS)[number];

export const POPUP_SCALE_RANGES = ['1-5', '0-10'] as const;
export type PopupScaleRange = (typeof POPUP_SCALE_RANGES)[number];

/** Priorities: Baja, Normal, Alta. The highest is shown first. */
export const POPUP_PRIORITIES = [0, 1, 2] as const;

export const POPUP_MAX_QUESTIONS = 10;
/** The longest a campaign lasts. */
export const POPUP_MAX_DAYS = 90;
/** «Más tarde» brings it back in another session, this many shows at most [U]. */
export const POPUP_MAX_SHOWS = 3;
/** Popups a player sees in a Madrid day at most, over every campaign [U]. */
export const POPUPS_PER_DAY = 1;
/** An answer to a campaign shown right before its end still counts for this long after it. */
export const POPUP_ANSWER_GRACE_MS = 15 * 60_000;
/** A text question's placeholder when the admin writes none. */
export const POPUP_TEXT_PLACEHOLDER = 'Escribe aquí';

const DAY_MS = 86_400_000;

/** A question's or an option's id: short, lower case, unique in its campaign (or its question). */
export const popupItemIdSchema = z.string().regex(/^[a-z0-9]{1,12}$/);
const prompt = z.string().trim().min(1).max(120);

export const popupSubjectSchema = z.object({ kind: z.enum(POPUP_SUBJECT_KINDS), id: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();
export type PopupSubject = z.output<typeof popupSubjectSchema>;

export const popupOptionSchema = z.object({ id: popupItemIdSchema, label: z.string().trim().min(1).max(60) }).strict();
export type PopupOption = z.output<typeof popupOptionSchema>;

export const popupQuestionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('scale'),
      id: popupItemIdSchema,
      prompt,
      range: z.enum(POPUP_SCALE_RANGES),
      /** The words under each end («Nada probable», «Muy probable»). */
      low: z.string().trim().max(30).default(''),
      high: z.string().trim().max(30).default(''),
      subject: popupSubjectSchema.nullable().default(null),
    })
    .strict(),
  z.object({ type: z.literal('stars'), id: popupItemIdSchema, prompt }).strict(),
  z
    .object({
      type: z.literal('choice'),
      id: popupItemIdSchema,
      prompt,
      /** Several options at once (check boxes) or one (radio buttons). */
      multi: z.boolean().default(false),
      options: z.array(popupOptionSchema).min(2).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal('text'),
      id: popupItemIdSchema,
      prompt,
      placeholder: z.string().trim().max(60).default(POPUP_TEXT_PLACEHOLDER),
      required: z.boolean().default(false),
      maxLength: z.number().int().min(50).max(1000).default(500),
    })
    .strict(),
]);
export type PopupQuestionInput = z.input<typeof popupQuestionSchema>;
export type PopupQuestion = z.output<typeof popupQuestionSchema>;
export type PopupQuestionType = PopupQuestion['type'];

/** Whether a kind's questions have its shape: a survey, one scale; a review, stars and maybe a text; a form, 1 to 10. */
function shapeIssue(kind: PopupKind, questions: readonly PopupQuestion[]): string | null {
  const types = questions.map((q) => q.type).join(',');
  if (kind === 'survey') return types === 'scale' ? null : 'popup_survey_shape';
  if (kind === 'review') return types === 'stars' || types === 'stars,text' ? null : 'popup_review_shape';
  if (kind === 'form') return questions.length > 0 ? null : 'popup_form_empty';
  return questions.length === 0 ? null : 'popup_promotion_questions';
}

/** A campaign as an admin saves it (its id, state and version are the server's). */
export const popupRecordSchema = z
  .object({
    kind: z.enum(POPUP_KINDS),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().max(1200).default(''),
    /** Shown one per screen. */
    questions: z.array(popupQuestionSchema).max(POPUP_MAX_QUESTIONS).default([]),
    /** An image uploaded in Administración (galaxy.media_assets); a promotion needs one to be published. */
    imageMedia: z.uuid().nullable().default(null),
    /** A promotion's «Ver más»: a screen of the game or an https page (a new tab). */
    link: newsLinkSchema.nullable().default(null),
    /** Who sees it: the mail's audiences. Newcomers too, unless the admin sets join dates. */
    audience: mailAudienceSchema.default({ kind: 'all' }),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    priority: z.number().int().min(0).max(2).default(1),
    /** What answering gives (empty: nothing); only to accounts that existed when it was published [U]. */
    reward: giftListSchema(20).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const span = Date.parse(p.endsAt) - Date.parse(p.startsAt);
    if (span <= 0) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'popup_dates' });
    else if (span > POPUP_MAX_DAYS * DAY_MS) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'popup_too_long' });
    const shape = shapeIssue(p.kind, p.questions);
    if (shape) ctx.addIssue({ code: 'custom', path: ['questions'], message: shape });
    // A promotion is only looked at: nothing to answer, so nothing to pay [U].
    if (p.kind === 'promotion' && p.reward.length > 0) ctx.addIssue({ code: 'custom', path: ['reward'], message: 'popup_promotion_reward' });
    if (p.kind !== 'promotion' && p.link) ctx.addIssue({ code: 'custom', path: ['link'], message: 'popup_link_kind' });
    const ids = new Set<string>();
    p.questions.forEach((q, i) => {
      if (ids.has(q.id)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'id'], message: 'popup_question_duplicate' });
      ids.add(q.id);
      if (q.type !== 'choice') return;
      const options = new Set<string>();
      q.options.forEach((o, j) => {
        if (options.has(o.id)) ctx.addIssue({ code: 'custom', path: ['questions', i, 'options', j, 'id'], message: 'popup_option_duplicate' });
        options.add(o.id);
      });
    });
  });
export type PopupRecordInput = z.input<typeof popupRecordSchema>;
export type PopupRecord = z.output<typeof popupRecordSchema>;

/** The copy keys of a record's problems (their Spanish text lives in the web, `copy.popupIssues`). */
export const POPUP_ISSUE_CODES = [
  'popup_dates',
  'popup_too_long',
  'popup_survey_shape',
  'popup_review_shape',
  'popup_form_empty',
  'popup_promotion_questions',
  'popup_promotion_reward',
  'popup_link_kind',
  'popup_question_duplicate',
  'popup_option_duplicate',
  'popup_subject_unknown',
  'popup_media_unknown',
  'popup_gift_seasonal',
  'popup_gift_event',
  /** Only when publishing: a draft can be saved with them. */
  'popup_end_past',
  'popup_image_missing',
] as const;
export type PopupIssueCode = (typeof POPUP_ISSUE_CODES)[number] | `gift_${GiftIssueCode}`;

export interface PopupIssue {
  path: string;
  message: string;
}

/** What a record is checked against; each part absent is not checked. */
export type PopupContext = {
  /** The live content's ids of each kind of subject. */
  subjects?: Readonly<Record<PopupSubjectKind, readonly string[]>>;
  /** The uploaded images known (the record's own, when it exists). */
  media?: readonly string[];
  /** What is live for the reward (cosmetics, probes, galaxies that can be made). */
  gifts?: GiftLive;
} & (
  | {
      /** Publishing: its end must still be ahead and a promotion needs its image. */
      forPublish: true;
      now: Date;
    }
  | { forPublish?: false; now?: Date }
);

/**
 * Everything that keeps a record from being saved (or, `forPublish`, published), as `{ path, message }` (copy keys).
 * A reward is paid whenever the player answers, even after the season or an event is over, so nothing that ends with
 * them can be one (the tournaments' rule).
 */
export function popupIssues(input: unknown, ctx: PopupContext = {}): PopupIssue[] {
  const parsed = popupRecordSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
  const p = parsed.data;
  const out: PopupIssue[] = [];
  if (ctx.subjects) {
    const subjects = ctx.subjects;
    p.questions.forEach((q, i) => {
      if (q.type === 'scale' && q.subject && !subjects[q.subject.kind].includes(q.subject.id)) out.push({ path: `questions.${i}.subject`, message: 'popup_subject_unknown' });
    });
  }
  if (ctx.media && p.imageMedia && !ctx.media.includes(p.imageMedia)) out.push({ path: 'imageMedia', message: 'popup_media_unknown' });
  p.reward.forEach((g, i) => {
    if (g.kind === 'seasonPoints' || (g.kind === 'currency' && g.currency.startsWith('season:'))) out.push({ path: `reward.${i}`, message: 'popup_gift_seasonal' });
    else if (g.kind === 'currency' && g.currency.startsWith('signal:')) out.push({ path: `reward.${i}`, message: 'popup_gift_event' });
  });
  if (ctx.gifts) {
    // Seasonal and event gifts are refused above; the rest as the mail checks them.
    for (const issue of giftIssues(p.reward, ctx.gifts)) if (issue.code !== 'season_closed' && issue.code !== 'event_closed') out.push({ path: `reward.${issue.index}`, message: `gift_${issue.code}` });
  }
  if (ctx.forPublish) {
    if (Date.parse(p.endsAt) <= ctx.now.getTime()) out.push({ path: 'endsAt', message: 'popup_end_past' });
    if (p.kind === 'promotion' && !p.imageMedia) out.push({ path: 'imageMedia', message: 'popup_image_missing' });
  }
  return out;
}

/** What a campaign's state is deduced from. */
export interface PopupStateRow {
  state: PopupStoredState;
  startsAt: string;
  endsAt: string;
  /** When an admin ended it early (null: it ends at its `endsAt`). */
  endedAt: string | null;
}

/**
 * A campaign's state at `now`: a draft; published, scheduled until it starts, live from its start (included) to its
 * end (excluded), and ended after, or once an admin ended it.
 */
export function popupState(row: PopupStateRow, now: Date): PopupState {
  if (row.state === 'draft') return 'draft';
  const t = now.getTime();
  if (row.endedAt !== null || t >= Date.parse(row.endsAt)) return 'ended';
  return t < Date.parse(row.startsAt) ? 'scheduled' : 'live';
}

/**
 * How many players a campaign's reward may reach, for the mail's limits: its list of names, or anyone (an audience for
 * everyone or a segment grows while it is live).
 */
export function popupRecipients(audience: MailAudience): number {
  return audience.kind === 'segment' && audience.usernames !== undefined ? audience.usernames.length : Number.MAX_SAFE_INTEGER;
}

/**
 * Why publishing a campaign needs a superadmin: its reward past the mail's limits (for a superadmin) to as many players
 * as it may reach (`recipients`, when the server counted them; otherwise `popupRecipients`). Empty: any admin.
 */
export function popupBigReasons(p: Pick<PopupRecord, 'reward' | 'audience'>, limits: MailLimits, cosmetics: CosmeticsConfig, recipients = popupRecipients(p.audience)): BigGiftReason[] {
  return p.reward.length > 0 ? bigGiftReasons(p.reward, recipients, limits, cosmetics) : [];
}
