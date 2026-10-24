import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const donationChains = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economy/club-safe", () => ({ donationChains }));
vi.mock("@/components/donations/donate-dialog", () => ({
  DonateTrigger: ({ chains, autoOpen }: { chains: number[]; autoOpen: boolean }) => <button data-chains={chains.join(",")} data-auto={String(autoOpen)}>Donar a ElClub.</button>,
}));

import { DonateButtonInner } from "@/components/donations/donate-button";

describe("DonateButton", () => {
  it("with no network where the Safe exists: a disabled button that says so", async () => {
    donationChains.mockResolvedValue([]);
    render((await DonateButtonInner({})) as ReactElement);
    expect(screen.getByRole("button", { name: "Donaciones aún no disponibles" })).toBeDisabled();
  });

  it("otherwise hands the networks and autoOpen to the trigger", async () => {
    donationChains.mockResolvedValue([84532]);
    render((await DonateButtonInner({ autoOpen: true })) as ReactElement);
    const b = screen.getByRole("button", { name: "Donar a ElClub." });
    expect(b).toHaveAttribute("data-chains", "84532");
    expect(b).toHaveAttribute("data-auto", "true");
  });
});
