import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import fixture from "../../fixtures/giveaway-draw.json";

const fetchBeacon = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/drand", async (orig) => ({ ...(await orig<typeof import("@/lib/giveaways/drand")>()), fetchBeacon }));

import { GiveawayVerifier } from "@/components/giveaways/giveaway-verifier";
import { giveawayCommit } from "@/lib/giveaways/draw";

const SEED = fixture.seedHex as Hex;
const props = {
  commit: giveawayCommit(SEED),
  seedReveal: SEED,
  targetRound: String(fixture.round),
  // round 1000 is the first quicknet round after this close
  closesAt: new Date((1692803367 + 2994) * 1000).toISOString(),
  drandRandomness: fixture.randomness,
  entryCount: fixture.entryCount,
  winnerPositions: fixture.expectedWinners,
};

const ok = () => screen.queryAllByRole("img", { name: "Correcto" });
const bad = () => screen.queryAllByRole("img", { name: "No coincide" });

beforeEach(() => fetchBeacon.mockReset());

describe("GiveawayVerifier", () => {
  it("drand unavailable: the exact copy and no ✗ (Review Focus 5)", async () => {
    fetchBeacon.mockResolvedValue({ status: "unavailable" });
    render(<GiveawayVerifier {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    expect(await screen.findByText("No se pudo descargar la ronda. Inténtalo más tarde.")).toBeInTheDocument();
    expect(bad()).toHaveLength(0);
    expect(screen.queryByText(/inválid/i)).toBeNull();
    expect(fetchBeacon).toHaveBeenCalledWith(BigInt(fixture.round));
  });

  it("everything right: 3 ✓ (real BLS check of quicknet round 1000)", async () => {
    fetchBeacon.mockResolvedValue({ status: "ok", signature: fixture.signature, randomness: fixture.randomness });
    render(<GiveawayVerifier {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText(/Los ganadores coinciden/);
    expect(ok()).toHaveLength(3);
    expect(bad()).toHaveLength(0);
  });

  it("winners that do not match the draw: ✗ on that step only", async () => {
    fetchBeacon.mockResolvedValue({ status: "ok", signature: fixture.signature, randomness: fixture.randomness });
    render(<GiveawayVerifier {...props} winnerPositions={[1, 2, 3]} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText(/no coinciden/);
    expect(ok()).toHaveLength(2);
    expect(bad()).toHaveLength(1);
  });

  it("a round that is not the first after the close: ✗ on the drand step", async () => {
    fetchBeacon.mockResolvedValue({ status: "ok", signature: fixture.signature, randomness: fixture.randomness });
    render(<GiveawayVerifier {...props} closesAt={new Date((1692803367 + 3000) * 1000).toISOString()} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    expect(await screen.findByText("No es la primera ronda de drand después del cierre.")).toBeInTheDocument();
    expect(bad()).toHaveLength(1);
  });

  it("a seed that does not give the published commit: ✗ on the first step", async () => {
    fetchBeacon.mockResolvedValue({ status: "ok", signature: fixture.signature, randomness: fixture.randomness });
    render(<GiveawayVerifier {...props} commit={`0x${"00".repeat(32)}`} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText(/no da la huella/);
    expect(bad()).toHaveLength(1);
  });
});

describe("GiveawayVerifier · unexpected failure", () => {
  it("logs it and shows the retry copy, never a ✗", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // The failure comes from reading the answer, not from the mock itself: vitest reports an error thrown by a mock
    // implementation as a test failure even when the caller catches it.
    fetchBeacon.mockResolvedValue({
      get status(): string {
        throw new Error("boom");
      },
    });
    render(<GiveawayVerifier {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    expect(await screen.findByText("No se pudo descargar la ronda. Inténtalo más tarde.")).toBeInTheDocument();
    expect(bad()).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("[giveaways] verifier failed", expect.any(Error));
    log.mockRestore();
  });
});
