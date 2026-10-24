import { describe, expect, it } from "vitest";
import { ogContent } from "@/lib/public-giveaways/og";
import type { PublicGiveawayView } from "@/lib/public-giveaways/types";

const ID = "5b1f0c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
const HOST = "0x1234567890abcdef1234567890abcdef12345678";

function view(over: Partial<PublicGiveawayView> = {}): PublicGiveawayView {
  const prize = { id: "p", rank: 1, kind: "custom" as const, chainId: null, token: null, amount: null, label: "x", status: "pending" as const, unawardedReason: null, winnerPosition: null, winnerAddress: null, payoutTxHash: null, paidAt: null, deliveredAt: null };
  return {
    id: ID, title: "Summer raffle", description: null, hostName: null, hostAddress: HOST,
    closesAt: "2026-12-31T12:00:00.000Z", status: "open", targetRound: 1, seedCommit: "c", seedReveal: null,
    drandSignature: null, drandRandomness: null, entryCount: 3, minTxCount: 0, hasAllowlist: false,
    isHost: false, iEntered: false, drawnAt: null, cancelledAt: null, createdAt: "2026-10-01T00:00:00.000Z",
    entries: [], prizes: [prize, { ...prize, id: "q", rank: 2 }], ...over,
  };
}

describe("ogContent", () => {
  it("returns the English texts for en", () => {
    const c = ogContent(view(), "en");
    expect(c.title).toBe("Summer raffle");
    expect(c.prizes).toBe("2 prizes");
    expect(c.when).toContain("Dec");
    expect(c.status).toBe("Open");
    expect(c.url).toBe(`www.elclub.party/en/tools/giveaways/${ID}`);
    expect(c.alt).toContain("Summer raffle");
  });

  it("returns Spanish texts and the Spanish public path for es", () => {
    const c = ogContent(view({ prizes: view().prizes.slice(0, 1) }), "es");
    expect(c.prizes).toBe("1 premio");
    expect(c.url).toBe(`www.elclub.party/herramientas/sorteos/${ID}`);
  });

  it("announces winners once drawn", () => {
    expect(ogContent(view({ status: "drawn" }), "en").when).toBe("Winners announced");
    expect(ogContent(view({ status: "drawn" }), "es").when).toBe("Ganadores anunciados");
  });

  it("falls back to the generic tool card for null", () => {
    const en = ogContent(null, "en");
    const es = ogContent(null, "es");
    expect(en.title).not.toBe(es.title);
    expect(en.prizes).toBe("");
    expect(en.url).toBe("www.elclub.party/en/tools/giveaways");
    expect(es.url).toBe("www.elclub.party/herramientas/sorteos");
  });

  it("never includes the full host address", () => {
    const c = ogContent(view({ hostName: null }), "en");
    expect(JSON.stringify(c).toLowerCase()).not.toContain(HOST.toLowerCase());
  });
});
