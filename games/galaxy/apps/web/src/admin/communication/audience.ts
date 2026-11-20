import { type MailAudience, mailAudienceSchema } from '@galaxy/shared';
import { copy } from '../../copy/es';

// Who a message goes to (GDD §16.5; M6d-1), as the compose form describes it.

const t = copy.admin.communication;

export type AudienceKind = 'all' | 'names' | 'segment';

/**
 * The audience the form describes, checked with the server's own schema: null while it is not complete (a list with no
 * names, a segment with nothing), with what to fix when it is wrong (so the form never just keeps counting).
 */
export function audienceOf(kind: AudienceKind, f: Record<string, string>): { audience: MailAudience | null; problem?: string } {
  if (kind === 'all') return { audience: { kind: 'all' } };
  if (kind === 'names') {
    const usernames = [...new Set((f['usernames'] ?? '').toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = usernames.filter((u) => !/^[a-z0-9_]{3,20}$/.test(u));
    if (bad.length) return { audience: null, problem: t.badNames(bad.join(', ')) };
    if (usernames.length === 0) return { audience: null };
    if (usernames.length > 200) return { audience: null, problem: t.usernamesHint };
    return { audience: { kind: 'segment', usernames } };
  }
  const num = (k: string) => (f[k] ? Number(f[k]) : undefined);
  const seg = { kind: 'segment' as const, minLevel: num('minLevel'), maxLevel: num('maxLevel'), joinedFrom: f['joinedFrom'] || undefined, joinedTo: f['joinedTo'] || undefined };
  const clean = Object.fromEntries(Object.entries(seg).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length <= 1) return { audience: null };
  const parsed = mailAudienceSchema.safeParse(clean);
  return parsed.success ? { audience: parsed.data } : { audience: null, problem: t.audienceInvalid };
}

export function audienceText(a: MailAudience): string {
  if (a.kind === 'all') return t.audienceAll;
  const keys = Object.keys(a).filter((k) => k !== 'kind');
  return keys.length === 1 && a.usernames ? t.audienceNames(a.usernames.length) : t.audienceSegment;
}
