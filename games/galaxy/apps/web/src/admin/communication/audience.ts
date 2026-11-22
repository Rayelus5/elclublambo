import { type MailAudience, mailAudienceSchema } from '@galaxy/shared';
import { copy } from '../../copy/es';

// Who a message goes to (GDD §16.5; M6d-1), as the compose form describes it (and, since «Encuestas y avisos», the
// popups' wizard: admin/communication/AudienceFields).

const t = copy.admin.communication;

export type AudienceKind = 'all' | 'names' | 'segment';

/** The audience fields as typed: the kind and every field of every kind (switching keeps what was written). */
export interface AudienceValue {
  kind: AudienceKind;
  /** Names separated by commas, spaces or semicolons. */
  usernames: string;
  /** Digits only, '' for none. */
  minLevel: string;
  maxLevel: string;
  /** DateField values («2026-11-14»), '' for none. */
  joinedFrom: string;
  joinedTo: string;
}

/** Everyone, with nothing written. */
export const EMPTY_AUDIENCE: AudienceValue = { kind: 'all', usernames: '', minLevel: '', maxLevel: '', joinedFrom: '', joinedTo: '' };

/**
 * The audience the form describes, checked with the server's own schema: null while it is not complete (a list with no
 * names, a segment with nothing), with what to fix when it is wrong (so the form never just keeps counting).
 */
export function audienceOf(f: AudienceValue): { audience: MailAudience | null; problem?: string } {
  if (f.kind === 'all') return { audience: { kind: 'all' } };
  if (f.kind === 'names') {
    const usernames = [...new Set(f.usernames.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = usernames.filter((u) => !/^[a-z0-9_]{3,20}$/.test(u));
    if (bad.length) return { audience: null, problem: t.badNames(bad.join(', ')) };
    if (usernames.length === 0) return { audience: null };
    if (usernames.length > 200) return { audience: null, problem: t.usernamesHint };
    return { audience: { kind: 'segment', usernames } };
  }
  const num = (v: string) => (v ? Number(v) : undefined);
  const seg = { kind: 'segment' as const, minLevel: num(f.minLevel), maxLevel: num(f.maxLevel), joinedFrom: f.joinedFrom || undefined, joinedTo: f.joinedTo || undefined };
  const clean = Object.fromEntries(Object.entries(seg).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length <= 1) return { audience: null };
  const parsed = mailAudienceSchema.safeParse(clean);
  return parsed.success ? { audience: parsed.data } : { audience: null, problem: t.audienceInvalid };
}

/** A saved audience back in the fields: names alone are a list; levels or dates, a segment (its names, if any, kept). */
export function valueOfAudience(a: MailAudience): AudienceValue {
  if (a.kind === 'all') return EMPTY_AUDIENCE;
  const usernames = a.usernames?.join(', ') ?? '';
  const segment = a.minLevel !== undefined || a.maxLevel !== undefined || a.joinedFrom !== undefined || a.joinedTo !== undefined;
  return {
    kind: segment ? 'segment' : 'names',
    usernames,
    minLevel: a.minLevel === undefined ? '' : String(a.minLevel),
    maxLevel: a.maxLevel === undefined ? '' : String(a.maxLevel),
    joinedFrom: a.joinedFrom ?? '',
    joinedTo: a.joinedTo ?? '',
  };
}

export function audienceText(a: MailAudience): string {
  if (a.kind === 'all') return t.audienceAll;
  const keys = Object.keys(a).filter((k) => k !== 'kind');
  return keys.length === 1 && a.usernames ? t.audienceNames(a.usernames.length) : t.audienceSegment;
}
