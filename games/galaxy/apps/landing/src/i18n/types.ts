// The landing's words (plan «galaxysurvivor.es», PR 4): one dictionary per language, the same shape for all, so a new
// language is a new file and a new entry in locales.ts. Inline links in long texts use [text](url).

export interface Stop {
  kicker: string;
  title: string;
  text: string;
}

export interface Dict {
  meta: { title: string; description: string; siteName: string; ogImageAlt: string; skip: string };
  nav: { label: string; items: { href: string; label: string }[]; menu: string };
  cta: { play: string; login: string; follow: string };
  hero: { h1: [string, string]; lead: string };
  clips: { lobby: string; horde: string; boss: string; extract: string; collection: string; coop: string };
  hangar: Stop & { points: string[] };
  run: Stop;
  levelUp: Stop & { cards: { tag: string; name: string; text: string }[] };
  boss: Stop & { name: string; health: string };
  extract: Stop;
  station: Stop & { rooms: string[] };
  scanner: Stop & { tiers: string[]; count: string; countText: string; cardTier: Record<'rare' | 'epic' | 'legendary' | 'uncommon' | 'mythic', string>; level: string };
  relics: Stop & { points: string[] };
  group: Stop & { server: string };
  community: Stop & { tiles: { title: string; text: string; alt: string }[] };
  lore: { kicker: string; title: string; who: string; lines: string[] };
  news: Stop & { version: (version: string, date: string) => string };
  faq: { kicker: string; title: string; items: { q: string; a: string }[] };
  final: { title: string; text: string; note: string };
  mobile: { badge: string; title: string; text: string; share: string; copy: string; copied: string; close: string; shareText: string };
  footer: { tagline: string; game: string; community: string; legal: string; news: string; faq: string; discord: string };
  notFound: { title: string; description: string; h1: string; text: string; back: string };
  /** The notice on the old address (pre.elclub.party/galaxy) once the game has moved. */
  moved: { title: string; text: string; button: string; note: string };
  legal: { home: string; crumbs: string; updated: (date: string) => string; pages: Record<LegalKey, LegalPage> };
}

export type LegalKey = 'avisoLegal' | 'privacidad' | 'cookies' | 'condiciones';

export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  /** The holder's identity: the trade name and contact always; holder, NIF and address filled by the server. */
  | { identity: { tradeName: string; holder: string; nif: string; address: string; contact: string } };

export interface LegalPage {
  title: string;
  description: string;
  h1: string;
  updated: string;
  intro: string;
  sections: { id?: string; title: string; blocks: LegalBlock[] }[];
}
