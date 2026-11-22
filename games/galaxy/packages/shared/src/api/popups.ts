import { z } from 'zod';
import type { Wallet } from '../gacha/types';
import type { BigGiftReason } from '../gifts/rules';
import type { Gift, GrantedItem } from '../gifts/schema';
import { popupAnswersSchema } from '../popups/answers';
import { popupItemIdSchema, type PopupIssue, type PopupKind, type PopupQuestion, type PopupRecord, type PopupState, type PopupSubjectKind } from '../popups/record';
import type { PopupQuestionSummary } from '../popups/results';
import type { NewsLink } from './news';

// The API of «Encuestas y avisos» (GDD §16.5; plan 2026-11-22, part A). A player asks which popup to show (reading
// never spends a show), says it was shown, taps «Más tarde», closes a promotion (maybe through «Ver más») or sends their
// answers, which may pay a reward. Admins prepare campaigns as drafts, publish them with their password (a superadmin
// when the reward is big), take them back before anyone saw them, end them, and read the results. Admin writes carry
// a reason (and, for publishing and the actions, the password); the answer an `Idempotency-Key` header. Refusals are
// API codes (`{ error }`, text in the web's es.ts).

// ---------------------------------------------------------------------------------------------------------------------
// Players

/**
 * What a scale is about, as the popup draws it: its name and its sprite id, as `spriteDataUrl` and `SpriteLoop` take it
 * (a sector has none: its Core's, as the content editor's thumbnails).
 */
export interface PopupSubjectView {
  kind: PopupSubjectKind;
  id: string;
  name: string;
  sprite: string;
}

/** A question as the player sees it: a scale's subject resolved (null when it has none or it left the content). */
export type PopupQuestionView = Exclude<PopupQuestion, { type: 'scale' }> | (Omit<Extract<PopupQuestion, { type: 'scale' }>, 'subject'> & { subject: PopupSubjectView | null });

/** A campaign as the popup shows it. */
export interface PopupView {
  id: string;
  kind: PopupKind;
  title: string;
  body: string;
  /** The image's URL (`mediaUrl`), or null. */
  image: string | null;
  /** A promotion's «Ver más», or null. */
  link: NewsLink | null;
  questions: PopupQuestionView[];
  /** What answering gives this player (empty: nothing, or their account cannot take it). */
  reward: Gift[];
}

/** GET /galaxy/api/popups/next: the popup to show now, if any. */
export interface PopupNext {
  popup: PopupView | null;
}

/** Why an answer paid nothing although the campaign has a reward: who published it, the team, or a newer account. */
export type PopupRewardSkip = 'self' | 'staff' | 'newcomer';

/** POST /galaxy/api/popups/:id/answer: what each gift of the reward gave (null: no reward), and the wallet. */
export interface PopupAnswerResult {
  granted: GrantedItem[] | null;
  skipped: PopupRewardSkip | null;
  wallet: Wallet;
}

export const popupIdParamsSchema = z.object({ id: z.uuid() }).strict();
/** POST …/:id/seen: a promotion closed, through «Ver más» or not. */
export const popupSeenBodySchema = z.object({ clicked: z.boolean() }).strict();
/** POST …/:id/answer. */
export const popupAnswerBodySchema = z.object({ answers: popupAnswersSchema }).strict();

// ---------------------------------------------------------------------------------------------------------------------
// Admins

/** What players did with a campaign, over every account. */
export interface PopupTotals {
  /** Accounts it was shown to at least once. */
  seen: number;
  /** Accounts that answered it (survey, review, form). */
  answered: number;
  /** «Más tarde» taps. */
  later: number;
  /** Accounts that will not see it again without having answered or closed it (shown the most times). */
  exhausted: number;
  /** Answers whose reward was paid. */
  rewarded: number;
  /** Promotions: accounts that closed it, and of them, those that went through «Ver más». */
  closed: number;
  clicked: number;
}

/** A campaign as the panel shows it. */
export interface AdminPopup {
  id: string;
  /** Deduced from its dates (`popupState`). */
  state: PopupState;
  version: number;
  record: PopupRecord;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  /** Ended by an admin before its end (null: it ends, or ended, at its `endsAt`). */
  endedAt: string | null;
  endedBy: string | null;
  /** For the list's «N respuestas de M vistas» (a promotion: «Ver más» of M). */
  counts: Pick<PopupTotals, 'seen' | 'answered' | 'clicked'>;
  /** Why publishing it needs a superadmin (empty: any admin). */
  bigReasons: BigGiftReason[];
}

export interface AdminPopupList {
  popups: AdminPopup[];
  now: string;
}

/** GET /galaxy/api/admin/popups/:id/results: the totals and each question's summary, in the questions' order. */
export interface AdminPopupResults {
  popup: AdminPopup;
  totals: PopupTotals;
  questions: PopupQuestionSummary[];
}

/** Texts of a question are read this many at a time. */
export const POPUP_TEXTS_PAGE = 50;

/** GET …/:id/texts?question=&cursor=: a text question's answers, newest first, with who wrote each. */
export interface PopupTextsPage {
  question: string;
  texts: { username: string; text: string; at: string }[];
  /** All of them, over every page. */
  total: number;
  /** The next page's cursor (null: this was the last). */
  next: string | null;
}

const reason = z.string().trim().min(3).max(500);
const password = z.string().min(1).max(200);
const version = z.number().int().min(1);

/** POST /galaxy/api/admin/popups/validate: everything that would keep the record from being published now. */
export const popupValidateBodySchema = z.object({ record: z.unknown(), id: z.uuid().optional() }).strict();
export interface PopupValidation {
  ok: boolean;
  issues: PopupIssue[];
  /** Why publishing it would need a superadmin. */
  bigReasons: BigGiftReason[];
}
/** POST /galaxy/api/admin/popups (a new draft). */
export const popupCreateBodySchema = z.object({ record: z.unknown(), reason }).strict();
/** POST /galaxy/api/admin/popups/:id (a draft replaced whole, at the version the admin read). */
export const popupUpdateBodySchema = z.object({ record: z.unknown(), version, reason }).strict();
/** POST …/:id/delete (a draft). */
export const popupDeleteBodySchema = z.object({ reason }).strict();
/** POST …/:id/publish (at the version the admin reviewed). */
export const popupPublishBodySchema = z.object({ version, reason, password }).strict();
/** POST …/:id/unpublish (before it starts and while nobody saw it) and …/:id/end. */
export const popupActionBodySchema = z.object({ reason, password }).strict();
/** GET …/:id/texts. */
export const popupTextsQuerySchema = z.object({ question: popupItemIdSchema, cursor: z.string().max(80).optional() }).strict();
