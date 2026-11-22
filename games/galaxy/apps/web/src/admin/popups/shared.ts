import {
  type AdminPopup,
  type MailAudience,
  mediaUrl,
  POPUP_MAX_DAYS,
  type PopupIssue,
  type PopupKind,
  type PopupQuestion,
  type PopupQuestionView,
  type PopupRecord,
  type PopupState,
  type PopupSubject,
  type PopupSubjectView,
  type PopupView,
} from '@galaxy/shared';
import type { Content } from '@galaxy/sim';
import { copy } from '../../copy/es';
import { audienceText } from '../communication/audience';
import type { IconName } from '../../ui/Icon';

// What the panel's «Encuestas y avisos» shares (plan 2026-11-22, part A; GDD §16.5): the list's groups, the wizard's
// steps and which step each problem belongs to, a new record of each kind, the templates and a copy of a campaign, how
// dates read (Madrid time, as the seasons'), and the popup as the player will see it, built from the draft.

export const t = copy.admin.popups;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The list's groups, the ones that reach players first. */
export const GROUPS: readonly PopupState[] = ['live', 'scheduled', 'draft', 'ended'];

/** Each kind's icon (its colour lives in the CSS: survey Sky, review Solar, form Terminal, promotion UV). */
export const KIND_ICON: Record<PopupKind, IconName> = { survey: 'sliders', review: 'starOn', form: 'list', promotion: 'megaphone' };

export type Step = 'kind' | 'questions' | 'media' | 'audience' | 'reward' | 'review';
export const STEPS: readonly Step[] = ['kind', 'questions', 'media', 'audience', 'reward', 'review'];
/** The steps of `?paso=` in the address. */
export const PASOS: Record<string, Step> = { tipo: 'kind', preguntas: 'questions', imagen: 'media', publico: 'audience', premio: 'reward', revision: 'review' };

/** The steps a kind has: a promotion asks nothing and gives nothing. */
export const stepsOf = (kind: PopupKind): readonly Step[] => (kind === 'promotion' ? STEPS.filter((s) => s !== 'questions' && s !== 'reward') : STEPS);

/** Which step of the wizard a problem belongs to (by its path); one of a step the kind hides goes to the first. */
export function stepOf(issue: Pick<PopupIssue, 'path'>, kind: PopupKind): Step {
  const top = issue.path.split('.')[0] ?? '';
  const step: Step = ['kind', 'title', 'body'].includes(top)
    ? 'kind'
    : top === 'questions'
      ? 'questions'
      : top === 'imageMedia' || top === 'link'
        ? 'media'
        : ['audience', 'startsAt', 'endsAt', 'priority'].includes(top)
          ? 'audience'
          : top === 'reward'
            ? 'reward'
            : 'review';
  return stepsOf(kind).includes(step) ? step : 'kind';
}

/** A problem in words: its own text when it has one, a question's with its number, else the field's. */
export function issueText(issue: PopupIssue): string {
  const own = (copy.popupIssues as Record<string, string>)[issue.message] ?? t.localIssues[issue.message];
  const parts = issue.path.split('.');
  const q = parts[0] === 'questions' && parts[1] !== undefined && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
  if (q !== null) {
    const field = [...parts.slice(2)].reverse().find((p) => !/^\d+$/.test(p)) ?? '';
    return t.questionIssue(q + 1, own ?? t.questionIssues[field] ?? t.fieldIssue);
  }
  return own ?? t.fieldIssues[parts[0] ?? ''] ?? t.fieldIssue;
}

/** Problems that still let a draft be saved but not published (its end gone by, a promotion without its image…). */
const PUBLISH_ONLY = new Set(['popup_end_past', 'popup_image_missing', 'popup_reward_empty']);
export const blocksSave = (i: PopupIssue) => !PUBLISH_ONLY.has(i.message);

// ---------------------------------------------------------------------------------------------------------------------
// Dates

const whenFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** «23 nov, 18:00», Madrid time (the game's own). */
export const when = (iso: string) => whenFmt.format(new Date(iso));
/** «Del 23 nov, 18:00 al 30 nov, 18:00». */
export const dates = (from: string, to: string) => t.dates(when(from), when(to));

const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/** Who sees a campaign, in words: «Todas las cuentas», «12 cuentas», or a segment's conditions. */
export function audienceWords(a: MailAudience): { text: string; detail: string | null } {
  if (a.kind === 'all') return { text: t.audienceAll, detail: null };
  const day = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
  const levels =
    a.minLevel !== undefined && a.maxLevel !== undefined ? t.segment.levels(a.minLevel, a.maxLevel) : a.minLevel !== undefined ? t.segment.levelFrom(a.minLevel) : a.maxLevel !== undefined ? t.segment.levelTo(a.maxLevel) : null;
  const parts = [levels, a.joinedFrom ? t.segment.joinedFrom(day(a.joinedFrom)) : null, a.joinedTo ? t.segment.joinedTo(day(a.joinedTo)) : null].filter((x): x is string => !!x);
  return { text: audienceText(a), detail: parts.length ? parts.join(', ') : null };
}

/** The next full hour in the admin's own time. */
export function nextHour(now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(60, 0, 0);
  return d.toISOString();
}

/** The next midnight in the admin's own time. */
export function tomorrow(now = new Date()): string {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Records

/** A free id among `taken`: `q1`, `q2`… (questions) or `o1`, `o2`… (options). */
export function freeId(prefix: 'q' | 'o', taken: readonly string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** A question of a type with every field, as the editor holds it. */
export function freshQuestion(type: PopupQuestion['type'], id: string, prompt = ''): PopupQuestion {
  switch (type) {
    case 'scale':
      return { type, id, prompt, range: '1-5', low: '', high: '', subject: null };
    case 'stars':
      return { type, id, prompt };
    case 'choice':
      return { type, id, prompt, multi: false, options: [{ id: 'o1', label: '' }, { id: 'o2', label: '' }] };
    case 'text':
      return { type, id, prompt, placeholder: copy.popups.placeholder, required: false, maxLength: 500 };
  }
}

/** The questions a kind starts with: a survey's scale, a review's stars, a form's first question, a promotion none. */
export function questionsFor(kind: PopupKind): PopupQuestion[] {
  if (kind === 'survey') return [freshQuestion('scale', 'q1')];
  if (kind === 'review') return [freshQuestion('stars', 'q1')];
  if (kind === 'form') return [freshQuestion('choice', 'q1')];
  return [];
}

/** A record with every field, as the wizard edits it: from the next full hour, for a week, for everyone. */
export function freshRecord(kind: PopupKind = 'survey', now = new Date()): PopupRecord {
  const startsAt = nextHour(now);
  return {
    kind,
    title: '',
    body: '',
    questions: questionsFor(kind),
    imageMedia: null,
    link: null,
    audience: { kind: 'all' },
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 7 * DAY).toISOString(),
    priority: 1,
    reward: [],
  };
}

/**
 * The record as another kind: its questions in that kind's shape (the ones it had, when they fit), no link unless a
 * promotion and no reward if it is one. `kept`: what the kind had before switching away, to bring back.
 */
export function withKind(r: PopupRecord, kind: PopupKind, kept?: readonly PopupQuestion[]): PopupRecord {
  if (kind === r.kind) return r;
  const from = kept && kept.length > 0 ? [...kept] : r.questions;
  let questions: PopupQuestion[];
  if (kind === 'promotion') questions = [];
  else if (kind === 'survey') questions = [from.find((q) => q.type === 'scale') ?? freshQuestion('scale', 'q1')];
  else if (kind === 'review') {
    const stars = from.find((q) => q.type === 'stars') ?? freshQuestion('stars', 'q1');
    const text = from.find((q) => q.type === 'text');
    questions = text && text.id !== stars.id ? [stars, text] : [stars];
  } else questions = from.length > 0 ? from : questionsFor('form');
  return { ...r, kind, questions, link: kind === 'promotion' ? r.link : null, reward: kind === 'promotion' ? [] : r.reward };
}

/** The templates of the first step. */
export type TemplateId = 'nps' | 'enemy' | 'game' | 'promotion';
export const TEMPLATES: readonly TemplateId[] = ['nps', 'enemy', 'game', 'promotion'];
export const TEMPLATE_ICON: Record<TemplateId, IconName> = { nps: 'podium', enemy: 'target', game: 'starOn', promotion: 'megaphone' };

/** A template applied: its kind and questions; its title only where there was none. `enemy`: the first live enemy. */
export function applyTemplate(r: PopupRecord, id: TemplateId, enemy: string | null): PopupRecord {
  const w = t.templates[id];
  const title = r.title.trim() ? r.title : w.title;
  switch (id) {
    case 'nps': {
      const p = t.templates.nps;
      return { ...withKind(r, 'survey'), title, questions: [{ type: 'scale', id: 'q1', prompt: p.prompt, range: '0-10', low: p.low, high: p.high, subject: null }] };
    }
    case 'enemy': {
      const p = t.templates.enemy;
      return { ...withKind(r, 'survey'), title, questions: [{ type: 'scale', id: 'q1', prompt: p.prompt, range: '1-5', low: p.low, high: p.high, subject: enemy ? { kind: 'enemy', id: enemy } : null }] };
    }
    case 'game': {
      const p = t.templates.game;
      return {
        ...withKind(r, 'review'),
        title,
        questions: [
          { type: 'stars', id: 'q1', prompt: p.prompt },
          { ...(freshQuestion('text', 'q2', p.text) as Extract<PopupQuestion, { type: 'text' }>), required: false },
        ],
      };
    }
    case 'promotion':
      return { ...withKind(r, 'promotion'), title };
  }
}

/**
 * A copy of a campaign for a new one: «(copia)» after its title and the same length, at its dates when it has not
 * started yet, else from the next full hour.
 */
export function copyRecord(source: PopupRecord, now = new Date()): PopupRecord {
  const length = Math.min(POPUP_MAX_DAYS * DAY, Math.max(HOUR, Date.parse(source.endsAt) - Date.parse(source.startsAt)));
  const start = Date.parse(source.startsAt) > now.getTime() ? Date.parse(source.startsAt) : Date.parse(nextHour(now));
  return {
    ...structuredClone(source),
    title: t.copyOf(source.title).slice(0, 80),
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + length).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The popup as the player sees it

/** A scale's subject as the popup draws it (a sector with its Core's sprite), as the server builds it. */
export function subjectView(s: PopupSubject, content: Content): PopupSubjectView | null {
  let found: { name: string; sprite: string } | undefined;
  if (s.kind === 'enemy') found = content.enemies.find((e) => e.id === s.id);
  else if (s.kind === 'boss') found = content.bosses.find((b) => b.id === s.id);
  else if (s.kind === 'probe') found = content.probes.find((p) => p.id === s.id);
  else {
    const sector = content.sectors.find((x) => x.id === s.id);
    const boss = sector ? content.bosses.find((b) => b.id === sector.boss) : undefined;
    found = sector && boss ? { name: sector.name, sprite: boss.sprite } : undefined;
  }
  return found ? { kind: s.kind, id: s.id, name: found.name, sprite: found.sprite } : null;
}

/** The popup a player would get from this record now (an account that takes its reward). */
export function viewOfRecord(r: PopupRecord, content: Content, id = 'preview'): PopupView {
  const questions: PopupQuestionView[] = r.questions.map((q) => (q.type === 'scale' ? { ...q, subject: q.subject ? subjectView(q.subject, content) : null } : q));
  return {
    id,
    kind: r.kind,
    title: r.title.trim() || t.untitled,
    body: r.body.trim(),
    image: r.imageMedia ? mediaUrl(r.imageMedia) : null,
    link: r.kind === 'promotion' && r.link ? { ...r.link, label: r.link.label.trim() } : null,
    questions,
    reward: r.kind === 'promotion' ? [] : r.reward,
  };
}

/** Whether a scheduled campaign can still go back to draft: before its start and while nobody saw it. */
export const canUnpublish = (p: Pick<AdminPopup, 'state' | 'record' | 'counts'>, now: number) => p.state === 'scheduled' && Date.parse(p.record.startsAt) > now && p.counts.seen === 0;
