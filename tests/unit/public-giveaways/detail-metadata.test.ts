// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

vi.mock("server-only", () => ({}));
const getPublicGiveaway = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/queries", () => ({
  getPublicGiveaway,
  isPublicGiveawayId: (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v),
}));
vi.mock("@/lib/public-giveaways/draw-on-view", () => ({ maybeDrawOnView: vi.fn() }));
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: vi.fn() }));
vi.mock("@/components/public-giveaways/giveaway-detail", () => ({ GiveawayDetail: () => null }));

import { generateMetadata } from "@/app/(public)/[lang]/tools/giveaways/[id]/page";

const ID = "11111111-1111-4111-8111-111111111111";
const meta = (lang: string) =>
  generateMetadata({ params: Promise.resolve({ lang, id: ID }), searchParams: Promise.resolve({}) } as never) as Promise<Metadata>;

beforeEach(() => getPublicGiveaway.mockReset());

describe("giveaway page metadata", () => {
  it("shares the giveaway's title and description in Open Graph", async () => {
    getPublicGiveaway.mockResolvedValue({ id: ID, title: "Sorteo de otoño", description: "Tres premios en USDC." });
    const m = await meta("es");
    expect(m.title).toBe("Sorteo de otoño");
    expect(m.openGraph).toMatchObject({ title: "Sorteo de otoño", description: "Tres premios en USDC." });
    expect(m.description).toBe("Tres premios en USDC.");
    expect(m.robots).toMatchObject({ index: false, follow: false });
  });

  it("without a description it uses the generic line with the title", async () => {
    getPublicGiveaway.mockResolvedValue({ id: ID, title: "Summer raffle", description: null });
    const m = await meta("en");
    expect(m.openGraph).toMatchObject({ title: "Summer raffle", description: "Summer raffle. Verifiable giveaway on ElClub." });
  });
});
