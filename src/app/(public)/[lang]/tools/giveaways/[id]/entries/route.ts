import { getPublicGiveaway } from "@/lib/public-giveaways/queries";

// Live data (no "use cache"): with cacheComponents a route handler that reads at request time is dynamic.
const VISIBLE = new Set(["closed", "drawn", "void"]);

/** The ordered participant list for verification (P2-R13): only once the giveaway is closed. */
export async function GET(_req: Request, ctx: { params: Promise<{ lang: string; id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let g;
  try {
    g = await getPublicGiveaway(id, null);
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!g || !VISIBLE.has(g.status)) return Response.json({ error: "not_found" }, { status: 404 });
  const entries = g.entries
    .filter((e) => e.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((e) => ({ position: e.position as number, address: e.walletAddress }));
  return Response.json(
    { giveawayId: g.id, targetRound: g.targetRound, entries },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
