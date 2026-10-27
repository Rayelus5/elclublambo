import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const markPublicPrizePaidAction = vi.hoisted(() => vi.fn());
const getPublicPrizeStatusAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/actions", () => ({ markPublicPrizePaidAction, getPublicPrizeStatusAction }));
const account = vi.hoisted(() => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));

import { HostPanel } from "@/components/public-giveaways/host-panel";
import { isDefinitiveFailure, PastePaymentForm, PayPrizeButton } from "@/components/public-giveaways/pay-prize-button";
import { getDictionary } from "@/lib/i18n";

const PRIZE = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const HOST = "0x1111111111111111111111111111111111111111";
const WINNER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"ab".repeat(32)}` as const;
const d = getDictionary("es").giveaways;

const setup = () =>
  render(
    <PayPrizeButton
      prizeId={PRIZE}
      chainId={84532}
      winnerAddress={WINNER}
      hostAddress={HOST}
      amount="5000000"
      t={d.detail.host}
      errors={d.errors}
      retryDelayMs={0}
    />,
  );

beforeEach(() => {
  refresh.mockReset();
  markPublicPrizePaidAction.mockReset().mockResolvedValue({ ok: true, status: "paid" });
  getPublicPrizeStatusAction.mockReset().mockResolvedValue({ ok: true, status: "awarded" });
  send.mockReset().mockResolvedValue(HASH);
  ensure.mockReset().mockResolvedValue(true);
  account.address = HOST;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("PayPrizeButton", () => {
  it("switches network, sends the prize's amount to the winner and records the returned hash", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    await waitFor(() => expect(markPublicPrizePaidAction).toHaveBeenCalledWith(PRIZE, HASH));
    expect(ensure).toHaveBeenCalledWith(84532);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ chain: 84532, token: "USDC", to: WINNER, amount: 5_000_000n }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("a tx_mismatch shows its text", async () => {
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_mismatch" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.errors.tx_mismatch)).toBeInTheDocument();
  });

  it("retries while the transaction is pending", async () => {
    markPublicPrizePaidAction
      .mockResolvedValueOnce({ ok: false, error: "pending" })
      .mockResolvedValueOnce({ ok: false, error: "pending" })
      .mockResolvedValue({ ok: true, status: "paid" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(markPublicPrizePaidAction).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("still pending after the retries: pending text and «Comprobar de nuevo» without paying again", async () => {
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "pending" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    const again = await screen.findByRole("button", { name: d.detail.host.checkAgain });
    expect(screen.getByText(d.detail.host.pendingLong)).toBeInTheDocument();
    expect(markPublicPrizePaidAction).toHaveBeenCalledTimes(6);
    markPublicPrizePaidAction.mockResolvedValue({ ok: true, status: "paid" });
    await userEvent.click(again);
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
    expect(markPublicPrizePaidAction).toHaveBeenLastCalledWith(PRIZE, HASH);
  });

  it("a failed network switch never opens the wallet", async () => {
    ensure.mockResolvedValue(false);
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.switchFailed)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("another wallet connected: asks for the organizer's address and never sends", async () => {
    account.address = WINNER;
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.useHostWallet.replace("{address}", "0x1111…1111"))).toBeInTheDocument();
    expect(ensure).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("a rejected signature says so and records nothing", async () => {
    send.mockRejectedValue(Object.assign(new Error("rejected"), { name: "UserRejectedRequestError" }));
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.sendCancelled)).toBeInTheDocument();
    expect(markPublicPrizePaidAction).not.toHaveBeenCalled();
  });
});

describe("PayPrizeButton · double-payment guard across reloads", () => {
  const KEY = `elclub:pg-pay:${PRIZE}`;

  it("a reload during the pending window resumes on the stored hash: no «Pagar ahora»", async () => {
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "pending" });
    const first = setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    await screen.findByRole("button", { name: d.detail.host.checkAgain });
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toMatchObject({ hash: HASH, sentAt: expect.any(Number) });
    first.unmount();

    setup();
    expect(await screen.findByRole("button", { name: d.detail.host.checkAgain })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: d.detail.host.payNow })).toBeNull();
    markPublicPrizePaidAction.mockResolvedValue({ ok: true, status: "already" });
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.checkAgain }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(markPublicPrizePaidAction).toHaveBeenLastCalledWith(PRIZE, HASH);
    expect(send).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe(`paid:${HASH}`);
  });

  it("once paid it keeps a terminal marker, never an empty slot", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBe(`paid:${HASH}`);
  });

  it("a hash stored by another tab after this one loaded: «Pagar ahora» checks it instead of sending", async () => {
    setup();
    const pay = screen.getByRole("button", { name: d.detail.host.payNow });
    window.localStorage.setItem(KEY, JSON.stringify({ hash: HASH, sentAt: Date.now() }));
    await userEvent.click(pay);
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(markPublicPrizePaidAction).toHaveBeenCalledWith(PRIZE, HASH);
  });

  it("two tabs: the second tab, loaded before the first one paid, never sends again (terminal marker)", async () => {
    const tabA = setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    tabA.unmount();
    // Tab B: stale page that still shows the prize awarded.
    setup();
    expect(screen.queryByRole("button", { name: d.detail.host.payNow })).toBeNull();
    expect(screen.getByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a marker written by another tab while this one is open hides «Pagar ahora»", async () => {
    setup();
    screen.getByRole("button", { name: d.detail.host.payNow });
    act(() => {
      window.localStorage.setItem(KEY, `paid:${HASH}`);
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: d.detail.host.payNow })).toBeNull();
  });

  it("another device already paid (fresh status not awarded): aborts before the wallet and refreshes", async () => {
    getPublicPrizeStatusAction.mockResolvedValue({ ok: true, status: "paid" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.stalePrize)).toBeInTheDocument();
    expect(getPublicPrizeStatusAction).toHaveBeenCalledWith(PRIZE);
    expect(send).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it("the fresh status cannot be read: aborts without sending", async () => {
    getPublicPrizeStatusAction.mockResolvedValue({ ok: false, error: "unknown" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.errors.unknown)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it("storage that throws does not break paying", async () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
    expect(markPublicPrizePaidAction).toHaveBeenCalledWith(PRIZE, HASH);
  });
});

describe("PayPrizeButton · stuck hash (definitive failures)", () => {
  const KEY = `elclub:pg-pay:${PRIZE}`;

  it("isDefinitiveFailure: failed, mismatch and reused hashes, or not found after 10 minutes", () => {
    const now = 1_000_000_000;
    for (const code of ["tx_failed", "tx_mismatch", "tx_already_used"]) expect(isDefinitiveFailure(code, now, now)).toBe(true);
    expect(isDefinitiveFailure("tx_not_found", now - 9 * 60_000, now)).toBe(false);
    expect(isDefinitiveFailure("tx_not_found", now - 10 * 60_000, now)).toBe(true);
    for (const code of ["pending", "rpc_unavailable", "tx_too_old", "rate_limited", "unknown"]) expect(isDefinitiveFailure(code, 0, now)).toBe(false);
  });

  it.each(["tx_failed", "tx_mismatch", "tx_already_used"] as const)(
    "%s clears the stored hash and offers «Descartar y volver a pagar» with a warning",
    async (code) => {
      markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: code });
      setup();
      await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
      const discard = await screen.findByRole("button", { name: d.detail.host.discardRetry });
      expect(screen.getByText(d.errors[code])).toBeInTheDocument();
      expect(screen.getByText(d.detail.host.discardWarning)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: d.detail.host.checkAgain })).toBeNull();
      expect(window.localStorage.getItem(KEY)).toBeNull();
      await userEvent.click(discard);
      expect(screen.getByRole("button", { name: d.detail.host.payNow })).toBeInTheDocument();
    },
  );

  it("tx_not_found shortly after sending keeps only «Comprobar de nuevo»", async () => {
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_not_found" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    expect(await screen.findByRole("button", { name: d.detail.host.checkAgain })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: d.detail.host.discardRetry })).toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("tx_not_found ten minutes after sending is definitive", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ hash: HASH, sentAt: Date.now() - 11 * 60_000 }));
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_not_found" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.checkAgain }));
    expect(await screen.findByRole("button", { name: d.detail.host.discardRetry })).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it.each(["pending", "rpc_unavailable"])("%s keeps only «Comprobar de nuevo»", async (code) => {
    window.localStorage.setItem(KEY, JSON.stringify({ hash: HASH, sentAt: Date.now() - 60 * 60_000 }));
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: code });
    setup();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.checkAgain }));
    expect(await screen.findByRole("button", { name: d.detail.host.checkAgain })).toBeEnabled();
    expect(screen.queryByRole("button", { name: d.detail.host.discardRetry })).toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("the host panel hides «Ya lo pagué» while a hash waits and shows it again after a definitive failure", async () => {
    // tx_not_found right after sending is not final (and does not wait for the pending retries).
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_not_found" });
    render(
      <HostPanel
        lang="es"
        id="bbbbbbbb-bbbb-4bbb-8bbb-000000000001"
        status="drawn"
        closesAt="2026-01-01T00:00:00.000Z"
        hostAddress={HOST}
        prizes={[
          {
            id: PRIZE,
            rank: 1,
            kind: "crypto",
            chainId: 84532,
            token: "USDC",
            amount: "5000000",
            label: "",
            status: "awarded",
            unawardedReason: null,
            winnerPosition: 1,
            winnerAddress: WINNER,
            payoutTxHash: null,
            paidAt: null,
            deliveredAt: null,
          },
        ]}
        t={d.detail.host}
        errors={d.errors}
        noCustody="ElClub. no custodia fondos."
      />,
    );
    expect(screen.getByRole("button", { name: d.detail.host.alreadyPaid })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.payNow }));
    await screen.findByRole("button", { name: d.detail.host.checkAgain });
    expect(screen.queryByRole("button", { name: d.detail.host.alreadyPaid })).toBeNull();
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_failed" });
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.checkAgain }));
    await screen.findByRole("button", { name: d.detail.host.discardRetry });
    expect(screen.getByRole("button", { name: d.detail.host.alreadyPaid })).toBeInTheDocument();
  });
});

describe("PastePaymentForm («Ya lo pagué»)", () => {
  const paste = () => render(<PastePaymentForm prizeId={PRIZE} t={d.detail.host} errors={d.errors} />);

  it("rejects a malformed hash next to the field without calling the server", async () => {
    paste();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.alreadyPaid }));
    await userEvent.type(screen.getByLabelText(d.detail.host.txHash), "0x123");
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.submitHash }));
    expect(await screen.findByText(d.detail.host.errTxHash)).toBeInTheDocument();
    expect(screen.getByLabelText(d.detail.host.txHash)).toHaveAttribute("aria-invalid", "true");
    expect(markPublicPrizePaidAction).not.toHaveBeenCalled();
  });

  it("verifies a pasted hash", async () => {
    paste();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.alreadyPaid }));
    await userEvent.type(screen.getByLabelText(d.detail.host.txHash), HASH);
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.submitHash }));
    await waitFor(() => expect(markPublicPrizePaidAction).toHaveBeenCalledWith(PRIZE, HASH));
    expect(await screen.findByText(d.detail.host.paidOk)).toBeInTheDocument();
  });

  it("shows the server's code text", async () => {
    markPublicPrizePaidAction.mockResolvedValue({ ok: false, error: "tx_too_old" });
    paste();
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.alreadyPaid }));
    await userEvent.type(screen.getByLabelText(d.detail.host.txHash), HASH);
    await userEvent.click(screen.getByRole("button", { name: d.detail.host.submitHash }));
    expect(await screen.findByText(d.errors.tx_too_old)).toBeInTheDocument();
  });
});
