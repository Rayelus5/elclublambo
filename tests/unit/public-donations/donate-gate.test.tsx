import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const after = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: session }));
const reverifyPublicIntentsFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/confirm", () => ({ reverifyPublicIntentsFor }));
vi.mock("@/lib/donations/public-queries", () => ({ getMyPublicDonations: async () => ({ totalUsd6: 0n, donations: [] }) }));
vi.mock("@/lib/economy/club-safe", () => ({ donationChainsStatus: async () => ({ chains: [84532], networkError: false }) }));
vi.mock("@/components/public-donations/public-donate-panel-lazy", () => ({
  PublicDonatePanelLazy: (p: { session: unknown }) => <div data-testid="panel" data-session={JSON.stringify(p.session)} />,
}));

import { DonateGate } from "@/components/public-donations/donate-gate";
import { resetRecheckThrottle } from "@/lib/payments/recheck-throttle";

const WALLET = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  resetRecheckThrottle();
});

describe("DonateGate", () => {
  it("a signed-in non-member gets their pending public donations re-verified after the response", async () => {
    session.mockResolvedValue({ userId: "u1", wallet: WALLET, isMember: false });
    render(await DonateGate({ lang: "es" }));
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(after).toHaveBeenCalledTimes(1);
    expect(reverifyPublicIntentsFor).not.toHaveBeenCalled();
    await after.mock.calls[0]![0]();
    expect(reverifyPublicIntentsFor).toHaveBeenCalledWith("u1");
  });

  it("at most once per throttle window per user", async () => {
    session.mockResolvedValue({ userId: "u1", wallet: WALLET, isMember: false });
    await DonateGate({ lang: "es" });
    await DonateGate({ lang: "es" });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("no re-verification without a session or for a member", async () => {
    session.mockResolvedValue(null);
    await DonateGate({ lang: "es" });
    session.mockResolvedValue({ userId: "u2", wallet: WALLET, isMember: true });
    await DonateGate({ lang: "en" });
    expect(after).not.toHaveBeenCalled();
  });
});
