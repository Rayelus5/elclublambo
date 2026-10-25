import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const checkAllowanceAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/approvals/actions", () => ({ checkAllowanceAction }));
const revoke = vi.hoisted(() => vi.fn());
const revokeState = vi.hoisted(() => ({ switching: false }));
vi.mock("@/lib/approvals/use-revoke", () => ({ TX_REVERTED: "tx_reverted", useRevoke: () => ({ revoke, switching: revokeState.switching }) }));
const account = vi.hoisted(() => ({ isConnected: true, status: "connected" as string, address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const openAppKit = vi.hoisted(() => vi.fn());
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: openAppKit }) }));

import { ApprovalsList } from "@/components/approvals/approvals-list";
import { resetRevokeNotices, RevokeNotices } from "@/components/approvals/revoke-notices";
import type { ApprovalRow, ApprovalScan } from "@/lib/approvals/types";
import { getDictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";

const t = getDictionary("es").approvals;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const EOA = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const HASH = `0x${"cd".repeat(32)}` as const;

const permit2Row: ApprovalRow = {
  token: USDC,
  symbol: "USDC",
  decimals: 6,
  spender: PERMIT2,
  spenderLabel: "Permit2",
  spenderKind: "known",
  allowance: "12500000",
  unlimited: false,
};
const eoaRow: ApprovalRow = {
  token: WETH,
  symbol: "WETH",
  decimals: 18,
  spender: EOA,
  spenderLabel: null,
  spenderKind: "eoa",
  allowance: (2n ** 256n - 1n).toString(),
  unlimited: true,
};
const ok = (rows: ApprovalRow[], partial = false): ApprovalScan => ({ status: "ok", rows, partial });

function setup(scan: ApprovalScan, sessionWallet: string | null = null) {
  return render(
    <>
      <RevokeNotices lang="es" chainId={84532} owner={OWNER} />
      <ApprovalsList lang="es" chainId={84532} owner={OWNER} scan={scan} sessionWallet={sessionWallet as `0x${string}` | null} recheckDelayMs={0} />
    </>,
  );
}
const KEY = `elclub:revoke:84532:${OWNER}:${USDC}:${PERMIT2}`.toLowerCase();
const sentThen = (err: Error) =>
  revoke.mockImplementationOnce(async (_input: unknown, onSent?: (h: string) => void) => {
    onSent?.(HASH);
    throw err;
  });

const fills = (root: HTMLElement) => root.querySelectorAll(".bg-accent-fill").length;

beforeEach(() => {
  vi.clearAllMocks();
  account.isConnected = true;
  account.status = "connected";
  account.address = OWNER;
  revoke.mockResolvedValue(HASH);
  checkAllowanceAction.mockResolvedValue({ ok: true, row: null });
  revokeState.switching = false;
  window.localStorage.clear();
  resetRevokeNotices();
  vi.restoreAllMocks();
});

describe("ApprovalsList", () => {
  it("each row: the token linked to the explorer, the spender's label, the formatted amount and an outline «Retirar»", () => {
    const { container } = setup(ok([permit2Row]));
    const item = screen.getByRole("listitem");
    const tokenLink = within(item).getByRole("link", { name: /USDC/ });
    expect(tokenLink).toHaveAttribute("href", `https://sepolia.basescan.org/address/${USDC}`);
    // A 44 px target at every breakpoint.
    expect(tokenLink.className).toMatch(/(^| )min-h-11( |$)/);
    expect(tokenLink.className).not.toMatch(/:min-h-(0|auto)/);
    expect(within(item).getByText("Permit2")).toBeInTheDocument();
    expect(within(item).getByText("12,5")).toBeInTheDocument();
    const button = within(item).getByRole("button", { name: t.list.revoke });
    expect(button).toBeEnabled();
    expect(button.dataset.variant).toBe("outline");
    expect(fills(container)).toBe(0);
  });

  it("an unlimited allowance reads «Ilimitada»; a spender without code is flagged as a normal account", () => {
    setup(ok([eoaRow]));
    expect(screen.getByText("Ilimitada")).toBeInTheDocument();
    expect(t.list.unlimited).toBe("Ilimitada");
    expect(screen.getByText("Cuenta normal (no es un contrato)")).toBeInTheDocument();
    expect(t.list.eoa).toBe("Cuenta normal (no es un contrato)");
    expect(screen.getByText(t.list.eoaHint)).toBeInTheDocument();
  });

  it("an unknown contract is flagged «Desconocido»", () => {
    setup(ok([{ ...permit2Row, spender: OTHER, spenderLabel: null, spenderKind: "unknown_contract" }]));
    expect(screen.getByText(t.list.unknown)).toBeInTheDocument();
    expect(t.list.unknown).toBe("Desconocido");
  });

  it("Review Focus 2: another connected wallet sees everything, «Retirar» disabled with the reason, nothing signed", async () => {
    account.address = OTHER;
    setup(ok([permit2Row]));
    const reason = fill(t.list.reasons.wrong_wallet, { address: "0x7099…79C8" });
    expect(reason).toBe("Conecta la wallet 0x7099…79C8 para retirar permisos.");
    expect(screen.getByText(reason)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: t.list.revoke });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("no wallet: the reason and a «Conectar wallet» button that opens AppKit", async () => {
    account.isConnected = false;
    account.address = undefined;
    account.status = "disconnected";
    setup(ok([permit2Row]));
    expect(screen.getByRole("button", { name: t.list.revoke })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: t.list.connect }));
    expect(openAppKit).toHaveBeenCalled();
  });

  it("a SIWE session of another wallet: the session_mismatch text once, «Retirar» disabled", () => {
    setup(ok([permit2Row, eoaRow]), OTHER);
    expect(screen.getAllByText(fill(t.list.reasons.session_mismatch, { address: "0x7099…79C8" }))).toHaveLength(1);
    for (const b of screen.getAllByRole("button", { name: t.list.revoke })) expect(b).toBeDisabled();
  });

  it("ok and empty: «no tiene permisos activos en {red}»", () => {
    setup(ok([]));
    expect(screen.getByText("Esta dirección no tiene permisos activos en Base Sepolia.")).toBeInTheDocument();
  });

  it("partial: the partial-list notice", () => {
    setup(ok([permit2Row], true));
    expect(screen.getByText(t.list.partial)).toBeInTheDocument();
  });

  it("Review Focus 1: partial and empty never says «no tiene permisos»; the manual check is open instead", () => {
    setup(ok([], true));
    expect(screen.getByText(t.list.partial)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/no tiene permisos/);
    expect(screen.getByLabelText(t.manual.token)).toBeVisible();
  });

  it("Review Focus 1: unavailable shows the text and the open manual form, never «no tiene permisos»", () => {
    setup({ status: "unavailable", reason: "blocked" });
    expect(screen.getByText(t.list.unavailable)).toBeInTheDocument();
    expect(t.list.unavailable).toBe("No se pudo obtener la lista completa; pega un token y un spender para comprobarlo.");
    expect(screen.getByLabelText(t.manual.token)).toBeVisible();
    expect(screen.getByLabelText(t.manual.spender)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/no tiene permisos/);
  });

  it("revoke: signs for the owner, re-checks the pair, the row goes away with «Permiso retirado» and the tx link, then refresh", async () => {
    let resolveRevoke: (h: `0x${string}`) => void = () => {};
    revoke.mockImplementation((_input: unknown, onSent?: (h: string) => void) => {
      onSent?.(HASH);
      return new Promise((r) => (resolveRevoke = r));
    });
    const { container } = setup(ok([permit2Row, eoaRow]));
    const [first] = screen.getAllByRole("button", { name: t.list.revoke });
    await userEvent.click(first!);
    expect(revoke).toHaveBeenCalledWith({ chainId: 84532, token: USDC, spender: PERMIT2, account: OWNER }, expect.any(Function));
    // While it is in flight the row's button is the screen's only fill; the pending hash is stored.
    await waitFor(() => expect(fills(container)).toBe(1));
    expect(JSON.parse(window.localStorage.getItem(`elclub:revoke:84532:${OWNER}:${USDC}:${PERMIT2}`.toLowerCase())!).hash).toBe(HASH);
    resolveRevoke(HASH);
    await waitFor(() => expect(screen.getByText(t.list.revoked)).toBeInTheDocument());
    expect(checkAllowanceAction).toHaveBeenCalledWith({ chain: "base", owner: OWNER, token: USDC, spender: PERMIT2 });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("Permit2")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.list.viewTx })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
    expect(refresh).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(fills(container)).toBe(0);
  });

  it("the confirmation survives a refresh that already dropped the row", async () => {
    const view = setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    await waitFor(() => expect(screen.getByText(t.list.revoked)).toBeInTheDocument());
    view.rerender(
      <>
        <RevokeNotices lang="es" chainId={84532} owner={OWNER} />
        <ApprovalsList lang="es" chainId={84532} owner={OWNER} scan={ok([])} sessionWallet={null} recheckDelayMs={0} />
      </>,
    );
    expect(screen.getByText(t.list.revoked)).toBeInTheDocument();
  });

  it("the «Permiso retirado» notice sits above the list and outlives it (a refresh answered rate_limited drops the list)", async () => {
    const view = setup(ok([permit2Row, eoaRow]));
    await userEvent.click(screen.getAllByRole("button", { name: t.list.revoke })[0]!);
    const notice = await screen.findByText(t.list.revoked);
    expect(notice.compareDocumentPosition(screen.getByRole("list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.rerender(<RevokeNotices lang="es" chainId={84532} owner={OWNER} />);
    expect(screen.getByText(t.list.revoked)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t.list.viewTx })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
  });

  it("while the wallet switches network the busy row says so", async () => {
    revokeState.switching = true;
    revoke.mockImplementation(() => new Promise(() => {}));
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByRole("button", { name: t.list.switching })).toBeInTheDocument();
    expect(t.list.switching).toBe("Cambiando de red…");
  });

  it("a cancelled signature or a refused chain switch shows the dictionary text, never the raw error", async () => {
    revoke.mockRejectedValueOnce(Object.assign(new Error("User rejected the request. raw details"), { code: 4001 }));
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByText(t.list.cancelled)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/raw details/);
    revoke.mockRejectedValueOnce(new Error("chain_switch_failed"));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByText(t.list.switchFailed)).toBeInTheDocument();
    expect(checkAllowanceAction).not.toHaveBeenCalled();
  });

  it("still active right after a confirmed receipt: checks once more; still active keeps the row and the stored hash", async () => {
    revoke.mockImplementation(async (_input: unknown, onSent?: (h: string) => void) => {
      onSent?.(HASH);
      return HASH;
    });
    checkAllowanceAction.mockResolvedValue({ ok: true, row: permit2Row });
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByText(t.list.stillActive)).toBeInTheDocument();
    expect(checkAllowanceAction).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(screen.getByRole("button", { name: t.list.checkAgain })).toBeInTheDocument();
  });

  it("a lagging node: the second check sees 0 and the row goes", async () => {
    checkAllowanceAction.mockResolvedValueOnce({ ok: true, row: permit2Row }).mockResolvedValueOnce({ ok: true, row: null });
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByText(t.list.revoked)).toBeInTheDocument();
    expect(checkAllowanceAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("sent, then the tx reverted: the reverted text, the stored hash cleared, the row kept", async () => {
    sentThen(new Error("tx_reverted"));
    checkAllowanceAction.mockResolvedValue({ ok: true, row: permit2Row });
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByText(t.list.reverted)).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.list.checkAgain })).not.toBeInTheDocument();
  });

  it("sent, then the receipt wait threw: the pending text, the stored hash kept, «Comprobar de nuevo» offered", async () => {
    sentThen(new Error("timed out while waiting"));
    checkAllowanceAction.mockResolvedValue({ ok: true, row: permit2Row });
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.revoke }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t.list.pending);
    expect(document.body.textContent).not.toMatch(/timed out/);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).hash).toBe(HASH);
    expect(screen.getByRole("button", { name: t.list.checkAgain })).toBeInTheDocument();
    expect(checkAllowanceAction).toHaveBeenCalledTimes(1);
  });

  it("the give-up window is evaluated when acting: a hash that went stale while the page was open is dropped, not checked", async () => {
    const t0 = Date.now();
    window.localStorage.setItem(KEY, JSON.stringify({ hash: HASH, sentAt: t0 - 9 * 60_000 }));
    setup(ok([permit2Row]));
    const button = screen.getByRole("button", { name: t.list.checkAgain });
    vi.spyOn(Date, "now").mockReturnValue(t0 + 2 * 60_000);
    await userEvent.click(button);
    expect(checkAllowanceAction).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await waitFor(() => expect(screen.queryByRole("button", { name: t.list.checkAgain })).not.toBeInTheDocument());
  });

  it("a stored pending revoke (fresh) offers «Comprobar de nuevo», which re-checks without signing", async () => {
    window.localStorage.setItem(`elclub:revoke:84532:${OWNER}:${USDC}:${PERMIT2}`.toLowerCase(), JSON.stringify({ hash: HASH, sentAt: Date.now() }));
    setup(ok([permit2Row]));
    await userEvent.click(screen.getByRole("button", { name: t.list.checkAgain }));
    await waitFor(() => expect(screen.getByText(t.list.revoked)).toBeInTheDocument());
    expect(revoke).not.toHaveBeenCalled();
  });

  it("a pending revoke older than the give-up window is ignored", () => {
    window.localStorage.setItem(`elclub:revoke:84532:${OWNER}:${USDC}:${PERMIT2}`.toLowerCase(), JSON.stringify({ hash: HASH, sentAt: Date.now() - 11 * 60_000 }));
    setup(ok([permit2Row]));
    expect(screen.queryByRole("button", { name: t.list.checkAgain })).not.toBeInTheDocument();
  });

  it("amounts: cut to 6 decimals with «aprox.», and base units when decimals are unknown", () => {
    setup(ok([{ ...permit2Row, token: WETH, decimals: 18, allowance: "1234567891234567891" }, { ...permit2Row, spender: OTHER, decimals: null, allowance: "1500000" }]));
    expect(screen.getByText("1,234567 aprox.")).toBeInTheDocument();
    expect(screen.getByText("1.500.000 unidades")).toBeInTheDocument();
  });

  it("the manual check is always there, folded, below the list; a found pair joins the list", async () => {
    setup(ok([]));
    const summary = screen.getByText(t.manual.title);
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(summary);
    checkAllowanceAction.mockResolvedValue({ ok: true, row: permit2Row });
    await userEvent.type(screen.getByLabelText(t.manual.token), USDC);
    await userEvent.type(screen.getByLabelText(t.manual.spender), PERMIT2);
    await userEvent.click(screen.getByRole("button", { name: t.manual.submit }));
    expect(await screen.findByText("Permit2")).toBeInTheDocument();
    expect(checkAllowanceAction).toHaveBeenCalledWith({ chain: "base", owner: OWNER, token: USDC, spender: PERMIT2 });
  });

  it("the manual check: invalid input is caught locally; a zero allowance says there is none", async () => {
    setup({ status: "unavailable", reason: "timeout" });
    await userEvent.type(screen.getByLabelText(t.manual.token), "0x12");
    await userEvent.type(screen.getByLabelText(t.manual.spender), PERMIT2);
    await userEvent.click(screen.getByRole("button", { name: t.manual.submit }));
    expect(screen.getByText(t.manual.errors.invalid_input)).toBeInTheDocument();
    expect(checkAllowanceAction).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(t.manual.token));
    await userEvent.type(screen.getByLabelText(t.manual.token), USDC);
    await userEvent.click(screen.getByRole("button", { name: t.manual.submit }));
    expect(await screen.findByText(t.manual.none)).toBeInTheDocument();
  });
});
