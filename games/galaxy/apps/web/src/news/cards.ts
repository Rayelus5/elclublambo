import { type NewsKind, type NewsLink, type NewsPost, type NewsSection, versionLabel } from '@galaxy/shared';
import { useBoosts } from '../api/boosts';
import { useMissions } from '../api/missions';
import { useReleaseNotes } from '../api/notes';
import { useLeaderboard } from '../api/social';
import { copy } from '../copy/es';
import { groupBoosts } from '../hub/News';
import { newestVersion } from '../notes/NotesScreen';
import { imageUrl } from './gallery';

// A card of the news board as the players see it (the owner, 2026-11-14). A custom card says what the admin wrote; an
// auto card says what the game has now: the latest patch notes, the events on, the season (and its anomaly), the
// multipliers, the Discord. An auto card with nothing to say (no event, no multiplier) is not shown. Each card has a
// key of what it says, so the board knows what is new to this browser.

const t = copy.news.board;
const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const until = (iso: string) => t.until(day.format(new Date(iso)).replace(',', ''), time.format(new Date(iso)));

export interface BoardCard {
  id: string;
  kind: NewsKind;
  section: NewsSection;
  featured: boolean;
  title: string;
  body: string;
  /** Short lines under the text (the multipliers, when an event ends). */
  lines: string[];
  /** A small tag on the image («v1.25», «Evento»). */
  badge: string | null;
  image: string | null;
  /** Where the card leads: inside the game (a path) or out (a URL, in a new tab). */
  href: string | null;
  external: boolean;
  cta: string;
  /** What it says, for «Nueva» (it changes when what it says changes). */
  seenKey: string;
}

function target(link: NewsLink | null): Pick<BoardCard, 'href' | 'external' | 'cta'> {
  if (!link) return { href: null, external: false, cta: '' };
  return link.kind === 'url' ? { href: link.href, external: true, cta: link.label } : { href: link.to, external: false, cta: link.label };
}

/** The live data the auto cards need (read once for all of them). */
export function useAutoData() {
  const notes = useReleaseNotes().data?.notes ?? [];
  const events = useMissions().data?.events ?? [];
  const season = useLeaderboard('general').data?.season ?? null;
  const boosts = useBoosts().data;
  return { notes, events, season, boosts };
}
export type AutoData = ReturnType<typeof useAutoData>;

/** A card as the players see it (null: an auto card with nothing to say now). */
export function boardCard(p: Pick<NewsPost, 'id' | 'kind' | 'section' | 'featured' | 'title' | 'body' | 'image' | 'link' | 'updatedAt'>, data: AutoData): BoardCard | null {
  const base = { id: p.id, kind: p.kind, section: p.section, featured: p.featured, image: imageUrl(p.image), ...target(p.link) };
  switch (p.kind) {
    case 'custom':
      return { ...base, title: p.title, body: p.body, lines: [], badge: null, seenKey: `p:${p.id}:${p.updatedAt}` };
    case 'auto:patch': {
      const v = newestVersion(data.notes);
      const note = data.notes.find((n) => n.version === v);
      if (!note) return null;
      // Straight to that version's notes.
      const href = base.href === '/notas-de-version' || !base.href ? `/notas-de-version?version=${note.version}` : base.href;
      return { ...base, href, external: base.external && href === base.href, cta: base.cta || t.readNotes, title: note.title, body: note.summary, lines: [], badge: versionLabel(note.version), seenKey: `a:patch:${note.version}` };
    }
    case 'auto:events': {
      const [first, ...more] = data.events;
      if (!first) return null;
      const lines = [until(first.endsAt), ...(more.length > 0 ? [t.moreEvents(more.length)] : [])];
      return { ...base, title: first.name, body: first.description, lines, badge: t.eventBadge, seenKey: `a:events:${data.events.map((e) => e.id).join(',')}` };
    }
    case 'auto:season': {
      const s = data.season;
      if (!s) return null;
      const anomaly = data.boosts?.anomaly ?? null;
      const lines = [t.seasonEnds(shortDay.format(new Date(s.endsAt))), ...(anomaly ? [t.anomaly(anomaly.name)] : [])];
      return { ...base, title: s.name, body: anomaly?.description ?? t.seasonBody, lines, badge: t.seasonBadge, seenKey: `a:season:${s.id}:${anomaly?.id ?? ''}` };
    }
    case 'auto:boosts': {
      const groups = groupBoosts(data.boosts?.boosts ?? []);
      if (groups.length === 0) return null;
      const lines = groups.map((g) => `${g.name}: ${g.items.map((b) => copy.news.rate(b.currency, b.factor)).join(', ')}. ${until(g.endsAt)}`);
      return { ...base, title: t.boostsTitle, body: t.boostsBody, lines, badge: t.boostsBadge, seenKey: `a:boosts:${groups.flatMap((g) => g.items.map((b) => b.id)).join(',')}` };
    }
    case 'auto:discord':
      return { ...base, title: t.discordTitle, body: t.discordBody, lines: [], badge: null, seenKey: 'a:discord' };
    default:
      return null;
  }
}
