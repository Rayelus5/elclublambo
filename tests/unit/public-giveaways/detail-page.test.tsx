import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  enterPublicGiveawayAction: vi.fn(),
  leavePublicGiveawayAction: vi.fn(),
  cancelPublicGiveawayAction: vi.fn(),
  markPublicPrizeDeliveredAction: vi.fn(),
  markPublicPrizePaidAction: vi.fn(),
}));
vi.mock("@/lib/public-giveaways/actions", () => actions);
// AppKit only exists in the browser: a stub that exposes the `next` it was given.
vi.mock("@/components/public/public-connect-lazy", () => ({
  PublicConnectLazy: ({ next }: { next: string }) => <button type="button" data-next={next}>connect-stub</button>,
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: true, address: "0x1111111111111111111111111111111111111111" }) }));
vi.mock("@/lib/payments/use-send-transfer", () => ({ useSendTransfer: () => ({ send: vi.fn() }) }));
vi.mock("@/lib/payments/use-ensure-chain", () => ({ useEnsureChain: () => ({ ensure: vi.fn(), switching: false, failedFor: null }) }));

import { GiveawayDetail } from "@/components/public-giveaways/giveaway-detail";
import { getDictionary } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routes";
import type { PublicGiveawayView, PublicPrize } from "@/lib/public-giveaways/types";

const ID = "11111111-1111-4111-8111-111111111111";
const HOST = "0x1111111111111111111111111111111111111111";
const WINNER = "0x2222222222222222222222222222222222222222";
const es = getDictionary("es").giveaways;
const en = getDictionary("en").giveaways;

function prize(over: Partial<PublicPrize>): PublicPrize {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    rank: 1,
    kind: "crypto",
    chainId: 84532,
    token: "USDC",
    amount: "5000000",
    label: "5 USDC",
    status: "pending",
    unawardedReason: null,
    winnerPosition: null,
    winnerAddress: null,
    payoutTxHash: null,
    paidAt: null,
    deliveredAt: null,
    ...over,
  };
}

function view(over: Partial<PublicGiveawayView> = {}): PublicGiveawayView {
  return {
    id: ID,
    title: "Sorteo de otoño",
    description: null,
    hostName: null,
    hostAddress: HOST,
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    status: "open",
    targetRound: 1000,
    seedCommit: `0x${"ab".repeat(32)}`,
    seedReveal: null,
    drandSignature: null,
    drandRandomness: null,
    entryCount: 0,
    minTxCount: 0,
    hasAllowlist: false,
    isHost: false,
    iEntered: false,
    drawnAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    entries: [],
    prizes: [prize({})],
    ...over,
  };
}

type Props = Partial<Parameters<typeof GiveawayDetail>[0]>;
const setup = (p: Props = {}) =>
  render(<GiveawayDetail lang="es" view={view()} signedIn={false} viewerWallet={null} autoFocusJoin={false} {...p} />);

beforeEach(() => {
  refresh.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe("GiveawayDetail · JoinPanel (Review Focus 2)", () => {
  it("without a session offers to connect with next = this giveaway's public URL + ?join=1", () => {
    setup();
    const connect = screen.getByRole("button", { name: "connect-stub" });
    const next = connect.getAttribute("data-next") ?? "";
    expect(next.endsWith("?join=1")).toBe(true);
    expect(next).toBe(`${localizedPath("es", "giveaway", { id: ID })}?join=1`);
    expect(screen.queryByRole("button", { name: es.detail.join.join })).toBeNull();
    expect(screen.getByText(es.detail.join.addressNotice)).toBeInTheDocument();
  });

  it("the English page sends back to the English URL", () => {
    setup({ lang: "en" });
    const next = screen.getByRole("button", { name: "connect-stub" }).getAttribute("data-next");
    expect(next).toBe(`/en/tools/giveaways/${ID}?join=1`);
    expect(screen.getByText(en.detail.join.addressNotice)).toBeInTheDocument();
  });

  it("back with a session and ?join=1: «Participar» is focused and one click joins", async () => {
    setup({ signedIn: true, autoFocusJoin: true });
    const join = screen.getByRole("button", { name: es.detail.join.join });
    await waitFor(() => expect(join).toHaveFocus());
    await userEvent.click(join);
    expect(actions.enterPublicGiveawayAction).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("without ?join=1 the button is not focused", () => {
    setup({ signedIn: true });
    expect(screen.getByRole("button", { name: es.detail.join.join })).not.toHaveFocus();
  });

  it("shows min_tx_not_met with its text", async () => {
    actions.enterPublicGiveawayAction.mockResolvedValue({ ok: false, error: "min_tx_not_met" });
    setup({ signedIn: true, view: view({ minTxCount: 5 }) });
    expect(screen.getByText(es.detail.join.reqMinTx.replace("{n}", "5"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: es.detail.join.join }));
    expect(await screen.findByText(es.errors.min_tx_not_met)).toBeInTheDocument();
  });

  it("shows not_allowed with its text", async () => {
    actions.enterPublicGiveawayAction.mockResolvedValue({ ok: false, error: "not_allowed" });
    setup({ signedIn: true, view: view({ hasAllowlist: true }) });
    await userEvent.click(screen.getByRole("button", { name: es.detail.join.join }));
    expect(await screen.findByText(es.errors.not_allowed)).toBeInTheDocument();
  });

  it("entered: «Estás dentro» and «Salir»", async () => {
    setup({ signedIn: true, view: view({ iEntered: true }) });
    expect(screen.getByText(es.detail.join.entered)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: es.detail.join.leave }));
    expect(actions.leavePublicGiveawayAction).toHaveBeenCalledWith(ID);
  });
});

describe("GiveawayDetail · prizes and host panel", () => {
  const prizes = [
    prize({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", rank: 1, status: "awarded", winnerPosition: 3, winnerAddress: WINNER }),
    prize({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", rank: 2, status: "paid", winnerPosition: 1, winnerAddress: WINNER, payoutTxHash: `0x${"cd".repeat(32)}` }),
    prize({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003", rank: 3, kind: "custom", chainId: null, token: null, amount: null, label: "Camiseta", status: "awarded", winnerPosition: 2, winnerAddress: WINNER }),
    prize({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000004", rank: 4, status: "unawarded", unawardedReason: "not_enough_entries" }),
  ];
  const drawn = view({
    status: "drawn",
    closesAt: new Date(Date.now() - 3600_000).toISOString(),
    seedReveal: `0x${"01".repeat(32)}`,
    drandSignature: "ab".repeat(48),
    drandRandomness: "cd".repeat(32),
    entryCount: 3,
    entries: [1, 2, 3].map((n) => ({ position: n, walletAddress: n === 1 ? WINNER : `0x${String(n).repeat(40)}` })),
    prizes,
  });

  it("the host sees «Pagar ahora» only for the awarded USDC prize, and «Marcar entregado» for the custom one", () => {
    setup({ signedIn: true, view: { ...drawn, isHost: true } });
    const host = screen.getByRole("region", { name: es.detail.host.title });
    expect(within(host).getAllByRole("button", { name: es.detail.host.payNow })).toHaveLength(1);
    expect(within(host).getAllByRole("button", { name: es.detail.host.markDelivered })).toHaveLength(1);
    expect(within(host).getByText(getDictionary("es").common.noCustody, { exact: false })).toBeInTheDocument();
  });

  it("a visitor sees no host panel and no pay button", () => {
    setup({ signedIn: true, view: drawn });
    expect(screen.queryByRole("region", { name: es.detail.host.title })).toBeNull();
    expect(screen.queryByRole("button", { name: es.detail.host.payNow })).toBeNull();
  });

  it("prize states: winner position with short address, paid with explorer link, unawarded", () => {
    setup({ view: drawn });
    const list = screen.getByRole("list", { name: es.detail.prizes.listLabel });
    expect(within(list).getAllByText(es.detail.prizes.winner.replace("{n}", "3"), { exact: false }).length).toBeGreaterThan(0);
    expect(within(list).getAllByText("0x2222…2222").length).toBeGreaterThan(0);
    const link = within(list).getByRole("link", { name: new RegExp(es.detail.prizes.viewTx) });
    expect(link).toHaveAttribute("href", expect.stringContaining(`0x${"cd".repeat(32)}`));
    expect(within(list).getByText(es.detail.prizes.unawarded)).toBeInTheDocument();
  });

  it("once drawn: verification data, the verifier and the JSON download", () => {
    setup({ view: drawn });
    expect(screen.getByText(drawn.seedCommit)).toBeInTheDocument();
    expect(screen.getByText(drawn.drandSignature as string)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: es.detail.verifier.check })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: es.detail.verify.download })).toHaveAttribute(
      "href",
      `${localizedPath("es", "giveaway", { id: ID })}/entries`,
    );
  });

  it("participants are numbered after the close and abbreviated", () => {
    setup({ view: drawn, viewerWallet: WINNER });
    const list = screen.getByRole("list", { name: es.detail.entries.listLabel });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("0x2222…2222");
    expect(rows[0]).toHaveTextContent(es.detail.entries.you);
  });

  it("the open giveaway's host can cancel it", async () => {
    setup({ signedIn: true, view: view({ isHost: true }) });
    await userEvent.click(screen.getByRole("button", { name: es.detail.host.cancel }));
    await userEvent.click(screen.getByRole("button", { name: es.detail.host.cancelYes }));
    expect(actions.cancelPublicGiveawayAction).toHaveBeenCalledWith(ID);
  });
});
