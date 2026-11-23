import type { TournamentCard, TournamentDetail, TournamentList, TournamentMe, TournamentRankRow } from '@galaxy/shared';

// Tournaments as the server sends them (plan «temporadas como fichas», part 5), for the web tests: a card, a page, my
// place, a ranking row and the list of the three tabs, each with sensible defaults to change field by field.

const DAY = 86_400_000;
export const at = (ms: number) => new Date(Date.now() + ms).toISOString();
export { DAY };

export const me = (over: Partial<TournamentMe> = {}): TournamentMe => ({
  status: 'joined',
  joinedAt: at(-DAY / 2),
  rank: 5,
  score: 1240,
  runs: 4,
  eligible: true,
  rewards: null,
  claimed: false,
  refunded: false,
  reason: null,
  ...over,
});

export const card = (over: Partial<TournamentCard> = {}): TournamentCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'copa-de-hielo',
  title: 'Copa de hielo',
  summary: 'Baja tan hondo como puedas en la Nebulosa',
  seasonId: 'season-2',
  state: 'running',
  startsAt: at(-DAY),
  // Half a minute over, so «Termina en 3 d 5 h» still reads so when the test looks.
  endsAt: at(3 * DAY + 5 * 3_600_000 + 30_000),
  resultsAt: null,
  banner: null,
  exclusive: true,
  metric: 'points',
  filters: { sector: null, probe: null, mode: 'any', minLevel: null },
  entry: null,
  prizes: [
    { from: 1, to: 1, gifts: [{ kind: 'currency', currency: 'coins', amount: 5000 }, { kind: 'cosmetic', piece: 'title', id: 'Campeón de hielo' }], cash: null },
    { from: 2, to: 3, gifts: [{ kind: 'currency', currency: 'dust', amount: 800 }], cash: null },
    { from: 4, to: 10, gifts: [{ kind: 'currency', currency: 'signal', amount: 2 }], cash: null },
  ],
  participation: null,
  entrants: 42,
  maxEntrants: null,
  me: null,
  join: { open: true, block: null },
  exclusiveWith: null,
  ...over,
});

export const row = (rank: number, username: string, score: number, over: Partial<TournamentRankRow> = {}): TournamentRankRow => ({
  rank,
  username,
  avatar: null,
  frame: null,
  score,
  eligible: true,
  place: rank <= 10 ? rank : null,
  me: false,
  ...over,
});

export const page = (over: Partial<TournamentDetail> = {}): TournamentDetail => ({
  ...card(),
  rules: 'Vale cualquier sonda.\nLas partidas en grupo también cuentan.',
  details: null,
  choiceState: null,
  reviewHours: 24,
  ranking: [row(1, 'vega', 4200), row(2, 'deneb', 3100), row(3, 'altair', 2800), row(4, 'rigel', 1900)],
  total: 4,
  mine: null,
  myRuns: [],
  review: null,
  ...over,
});

export const list = (over: Partial<TournamentList> = {}): TournamentList => ({ running: [], upcoming: [], finished: [], now: new Date().toISOString(), ...over });
