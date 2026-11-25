import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: vi.fn() }));

import { Receipt } from "@/components/pay/receipt";
import { getDictionary } from "@/lib/i18n";

const en = getDictionary("en").pay.receipt;
const es = getDictionary("es").pay.receipt;
const FROM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const HASH = `0x${"ab".repeat(32)}` as const;
const ok = (final: boolean) => ({ status: "ok" as const, final, confirmations: final ? 12 : 1, token: "USDC" as const, from: FROM, to: TO, amount: 12_500_000n, blockTimestamp: 1_800_000_000 });
const base = { chain: 84532 as const, hash: HASH, recipient: null };

beforeEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
});

describe("Receipt", () => {
  it("not final shows Pending and never the verified claim", () => {
    render(<Receipt lang="en" {...base} result={ok(false)} />);
    expect(screen.getAllByText(en.pending).length).toBeGreaterThan(0);
    expect(screen.queryByText(en.verified)).toBeNull();
  });

  it("pending shows Pending and no verified claim", () => {
    render(<Receipt lang="es" {...base} result={{ status: "pending" }} />);
    expect(screen.getAllByText(es.pending).length).toBeGreaterThan(0);
    expect(screen.queryByText(es.verified)).toBeNull();
  });

  it("final shows the verified claim, amount, alias and explorer link", () => {
    render(<Receipt lang="en" {...base} recipient={{ alias: "ana", displayName: "Ana" }} result={ok(true)} />);
    expect(screen.getByText(en.verified)).toBeTruthy();
    expect(screen.getByText(/12\.5 USDC/)).toBeTruthy();
    expect(screen.getByText("@ana")).toBeTruthy();
    expect(screen.getByRole("link", { name: new RegExp(en.explorer) }).getAttribute("href")).toBe(`https://sepolia.basescan.org/tx/${HASH}`);
  });

  it("each error has its own text and no verified claim", () => {
    for (const code of ["tx_not_found", "tx_failed", "not_a_payment", "rpc_unavailable"] as const) {
      const { unmount } = render(<Receipt lang="en" {...base} result={{ status: "error", code }} />);
      expect(screen.getByRole("alert").textContent).toContain(en.errors[code]);
      expect(screen.queryByText(en.verified)).toBeNull();
      unmount();
    }
  });

  it("refreshes every 5 s while pending, not when final", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Receipt lang="en" {...base} result={ok(false)} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    refresh.mockReset();
    render(<Receipt lang="en" {...base} result={ok(true)} />);
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  // Each refresh re-renders the page on the server (a function run). A receipt left open on a transaction that never
  // finalizes refreshed every 5 s forever: now it slows down, rests while hidden and stops after 30 minutes.
  it("slows down after the first minute, to once a minute at most", () => {
    vi.useFakeTimers();
    render(<Receipt lang="en" {...base} result={ok(false)} />);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(12);
    for (const [ms, total] of [[10_000, 13], [20_000, 14], [40_000, 15], [60_000, 16], [60_000, 17]] as const) {
      vi.advanceTimersByTime(ms - 1);
      expect(refresh).toHaveBeenCalledTimes(total - 1);
      vi.advanceTimersByTime(1);
      expect(refresh).toHaveBeenCalledTimes(total);
    }
  });

  it("does not refresh while the tab is hidden, and refreshes at once when it comes back", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<Receipt lang="en" {...base} result={ok(false)} />);
    vi.advanceTimersByTime(30_000);
    expect(refresh).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("a quick back-and-forth between tabs does not refresh again before the current wait is over", () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const toggle = (state: "hidden" | "visible") => {
      visibility.mockReturnValue(state);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    render(<Receipt lang="en" {...base} result={ok(false)} />);
    vi.advanceTimersByTime(30_000);
    toggle("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) {
      toggle("hidden");
      toggle("visible");
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("stops after 30 minutes and offers «Check again», which checks and starts over", () => {
    vi.useFakeTimers();
    render(<Receipt lang="en" {...base} result={ok(false)} />);
    expect(screen.queryByRole("button", { name: en.checkAgain })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    const calls = refresh.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole("button", { name: en.checkAgain }));
    expect(refresh).toHaveBeenCalledTimes(calls + 1);
    expect(screen.queryByRole("button", { name: en.checkAgain })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).toHaveBeenCalledTimes(calls + 2);
  });

  it("says how long the page checks by itself, not a fixed interval", () => {
    expect(en.pendingText).not.toMatch(/\d+ seconds/);
    expect(es.pendingText).not.toMatch(/\d+ segundos/);
    expect(en.pendingText).toContain("half an hour");
    expect(es.pendingText).toContain("media hora");
  });

  it("tx_not_found and rpc_unavailable retry 3 times then stop; other errors never retry", () => {
    vi.useFakeTimers();
    for (const [code, calls] of [["tx_not_found", 3], ["rpc_unavailable", 3], ["tx_failed", 0], ["not_a_payment", 0]] as const) {
      refresh.mockReset();
      const { unmount } = render(<Receipt lang="en" {...base} result={{ status: "error", code }} />);
      vi.advanceTimersByTime(60_000);
      expect(refresh, code).toHaveBeenCalledTimes(calls);
      unmount();
    }
  });
});
