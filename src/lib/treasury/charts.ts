// Pure data shaping for the /dao charts (hand-rolled SVG in src/components/treasury/dao-charts.tsx).
import type { RankingEntry } from "@/lib/treasury/queries";

export interface DonutSlice {
  key: string;
  label: string;
  bps: number;
  color: string;
}

/**
 * Five members at most, plus the club fund and "Resto": beyond that a donut stops being readable (the ranking table has
 * every row).
 */
const MAX_MEMBERS = 5;
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
/** The club fund is not a person: it takes the neutral colour, and "Resto" the muted one when both are drawn. */
const CLUB_COLOR = "var(--chart-rest)";
const REST_COLOR = "var(--chart-rest)";
const REST_COLOR_WITH_CLUB = "var(--fg-muted)";

/**
 * Ranking (largest first, share in bps, floor-divided) -> donut slices summing to 10 000 bps. The club fund ("Fondo del
 * club") always keeps its own slice, wherever it ranks. The remainder of the floor division and every member past the
 * fifth go to "Resto". Hidden donors are told apart by rank ("#2 Anónimo").
 */
export function donutSlices(entries: readonly RankingEntry[]): DonutSlice[] {
  if (entries.length === 0) return [];
  const members = entries.filter((e) => !e.club).slice(0, MAX_MEMBERS);
  const club = entries.find((e) => e.club);
  // Ranking order, with the club placed where it ranks among the shown members (or after them).
  const shown = club ? [...members, club].sort((a, b) => a.rank - b.rank) : members;
  let color = 0;
  const slices: DonutSlice[] = shown.map((e) =>
    e.club
      ? { key: "club", label: "Fondo del club", bps: e.shareBps, color: CLUB_COLOR }
      : {
          key: `r${e.rank}`,
          label: e.memberId === null ? `#${e.rank} ${e.label}` : e.label,
          bps: e.shareBps,
          color: COLORS[color++]!,
        },
  );
  const rest = 10000 - slices.reduce((sum, s) => sum + s.bps, 0);
  return rest > 0 ? [...slices, { key: "rest", label: "Resto", bps: rest, color: club ? REST_COLOR_WITH_CLUB : REST_COLOR }] : slices;
}
