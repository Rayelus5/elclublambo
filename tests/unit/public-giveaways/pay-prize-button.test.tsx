import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const markPublicPrizePaidAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/actions", () => ({ markPublicPrizePaidAction }));
const account = vi.hoisted(() => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send }) }));
const ensure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure, switching: false, failedFor: null }) }));

import { PastePaymentForm, PayPrizeButton } from "@/components/public-giveaways/pay-prize-button";
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
  send.mockReset().mockResolvedValue(HASH);
  ensure.mockReset().mockResolvedValue(true);
  account.address = HOST;
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
