import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ isConnected: true, status: "connected" as string, address: undefined as string | undefined }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
const openAppKit = vi.hoisted(() => vi.fn());
vi.mock("@reown/appkit/react", () => ({ useAppKit: () => ({ open: openAppKit }) }));
const balances = vi.hoisted(() => ({ value: {} as Record<string, bigint | null> }));
vi.mock("@/lib/payments/balances", () => ({ useAssetBalances: () => balances.value }));
type Hook = {
  mode: "atomic" | "sequential" | "checking";
  send: ReturnType<typeof vi.fn>;
  rows: unknown[];
  runKey: string | null;
  running: boolean;
  switching: boolean;
  error: string | null;
  storageOk: boolean;
  runs: number;
  sendOneByOne: ReturnType<typeof vi.fn>;
};
const hook = vi.hoisted(() => ({ value: {} as Hook }));
vi.mock("@/lib/multisend/use-multisend", () => ({ useMultisend: () => hook.value }));
const idle = vi.hoisted(() => ({ value: "idle" as "idle" | "pending" | "unknown" | "checking", args: [] as unknown[] }));
vi.mock("@/lib/multisend/wallet-idle", () => ({
  useWalletIdle: (...args: unknown[]) => {
    idle.args = args;
    return idle.value;
  },
}));

import { MultisendForm } from "@/components/multisend/multisend-form";
import { encodeLines } from "@/lib/multisend/fragment";
import { listKey, parseRecipients } from "@/lib/multisend/parse";
import { progressKey, recordAttempt, recordConfirmed, saveProgress, type RowState } from "@/lib/multisend/progress";
import { lockKey, walletRunKey } from "@/lib/multisend/run-lock";
import { getDictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";

const es = getDictionary("es");
const t = es.multisend;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const A = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const B = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const C = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const LIST = `${A},10\n${B},12,5\n${C};7.5`;
const HASH = `0x${"ab".repeat(32)}` as const;
const HASH2 = `0x${"cd".repeat(32)}` as const;
const D = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

function setup(opts: { lang?: "es" | "en"; session?: string | null; text?: string } = {}) {
  const user = userEvent.setup();
  const view = render(<MultisendForm lang={opts.lang ?? "es"} chains={[84532, 421614]} sessionWallet={(opts.session ?? null) as `0x${string}` | null} />);
  return { user, ...view };
}
async function paste(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = screen.getByRole("textbox", { name: t.form.label });
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
}
const sendButton = () => screen.getByRole("button", { name: t.form.send });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.location.hash = "";
  idle.value = "idle";
  account.isConnected = true;
  account.status = "connected";
  account.address = OWNER;
  balances.value = { "USDC:84532": 100_000_000n, "ETH:84532": 10n ** 17n, "USDC:421614": 0n, "ETH:421614": 0n };
  hook.value = { mode: "sequential", send: vi.fn(async () => {}), rows: [], runKey: null, running: false, switching: false, error: null, storageOk: true, runs: 0, sendOneByOne: vi.fn() };
});
afterEach(() => {
  window.location.hash = "";
});

describe("MultisendForm", () => {
  it("shows noCustody, the network chips (Base first) and an empty form whose «Enviar» waits for lines", () => {
    const { container } = setup();
    expect(screen.getByText(es.common.noCustody)).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringContaining("Base Sepolia"), expect.stringContaining("Arbitrum Sepolia")]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(sendButton()).toBeDisabled();
    expect(container.querySelectorAll(".bg-accent-fill")).toHaveLength(1);
  });

  it("previews each line, with the issue next to its line and «Enviar» disabled while any line is wrong", async () => {
    const { user } = setup();
    await paste(user, `${A},10\n${B},1.1234567\n0x${"0".repeat(40)},1`);
    const preview = screen.getByRole("list", { name: t.form.preview });
    expect(within(preview).getByText(t.form.issues.too_many_decimals)).toBeInTheDocument();
    expect(within(preview).getByText(t.form.issues.zero_address)).toBeInTheDocument();
    expect(within(preview).getByText(fill(t.form.line, { n: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t.form.fixErrors)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("duplicates are merged with a notice; the summary shows total, recipients and balance", async () => {
    const { user } = setup();
    await paste(user, `${A},10\n${A.toLowerCase()},2,5`);
    expect(screen.getByText(fill(t.form.merged, { lines: "1, 2" }))).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: t.form.summary });
    expect(within(summary).getByText("12,5 USDC")).toBeInTheDocument();
    expect(within(summary).getByText("1")).toBeInTheDocument();
    expect(within(summary).getByText("100 USDC")).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  it("Review Focus 2: a connected wallet other than the session's sees the reason and «Enviar» disabled; nothing is signed", async () => {
    account.address = OTHER;
    const { user } = setup({ session: OWNER });
    await paste(user, LIST);
    const reason = fill(t.form.reasons.wrong_wallet, { address: "0x7099…79C8" });
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute("aria-describedby", expect.stringContaining(screen.getByText(reason).id));
    await user.click(sendButton());
    expect(hook.value.send).not.toHaveBeenCalled();
  });

  it("not connected: the reason and «Conectar wallet»", async () => {
    account.isConnected = false;
    account.address = undefined;
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText(t.form.reasons.not_connected)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.form.connect }));
    expect(openAppKit).toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it("a total above the balance: «Saldo insuficiente» and «Enviar» disabled", async () => {
    balances.value = { ...balances.value, "USDC:84532": 20_000_000n };
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText("Saldo insuficiente: tienes 20 USDC")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("no ETH for gas on the chain: the notice and «Enviar» disabled", async () => {
    balances.value = { ...balances.value, "ETH:84532": 0n };
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText(fill(t.form.noGas, { network: "Base Sepolia" }))).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it("«Enviar» opens the confirmation and signs nothing until «Confirmar y firmar»", async () => {
    const { user } = setup();
    await paste(user, LIST);
    await user.click(sendButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 30 USDC a 3 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    expect(hook.value.send).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.back }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(hook.value.send).not.toHaveBeenCalled();
    await user.click(sendButton());
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: t.confirm.confirm }));
    const { recipients } = parseRecipients(LIST, 84532);
    expect(hook.value.send).toHaveBeenCalledTimes(1);
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, listKey(84532, recipients), new Set(recipients.map((r) => r.id)), new Set());
  });

  it("Esc closes the confirmation without signing", async () => {
    const { user } = setup();
    await paste(user, LIST);
    await user.click(sendButton());
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(hook.value.send).not.toHaveBeenCalled();
  });

  it("#envio= preloads the textarea", () => {
    window.location.hash = encodeLines(LIST);
    setup();
    expect(screen.getByRole("textbox", { name: t.form.label })).toHaveValue(LIST);
  });

  it("in atomic mode: «Tu wallet lo enviará en una sola operación.»", async () => {
    hook.value.mode = "atomic";
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText("Tu wallet lo enviará en una sola operación.")).toBeInTheDocument();
  });

  it("Review Focus 4 + C2: saved progress shows each row with its hash; «Continuar» confirms only what will be signed and lists what is re-checked", async () => {
    const text = `${LIST}\n${D},3`;
    const { recipients } = parseRecipients(text, 84532);
    const key = listKey(84532, recipients);
    const st = (i: number, extra: Partial<RowState> & { status: RowState["status"] }): RowState => ({
      id: recipients[i]!.id,
      to: recipients[i]!.to,
      amount: recipients[i]!.amount.toString(),
      ...extra,
    });
    // Stored in another order: progress is keyed by line identity (C3).
    saveProgress(OWNER, 84532, key, [
      st(3, { hash: HASH2, attempt: { at: Date.now() }, status: "sent" }),
      st(1, { status: "todo", attempt: { at: Date.now() } }),
      st(0, { hash: HASH, status: "confirmed" }),
      st(2, { status: "todo" }),
    ]);
    const { user } = setup();
    await paste(user, text);
    const progress = screen.getByRole("list", { name: t.progress.title });
    const link = within(progress).getByRole("link", { name: fill(t.progress.viewTx, { n: 1 }) });
    expect(link).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
    expect(within(progress).getByText(t.progress.status.confirmed)).toBeInTheDocument();
    expect(within(progress).getAllByText(t.progress.status.todo)).toHaveLength(2);
    expect(within(progress).getByText(t.progress.status.sent)).toBeInTheDocument();
    // Finding 9: an identical transfer made outside the tool also counts.
    expect(screen.getByText(t.progress.scanNote)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.form.send })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.form.continue }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 20 USDC a 2 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    expect(within(dialog).getByText(t.confirm.checksOne)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.confirm }));
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, key, new Set([recipients[1]!.id, recipients[2]!.id]), new Set());
  });

  it("C2: with only lines to re-check, «Comprobar» re-checks without a confirmation (nothing can be signed)", async () => {
    const { recipients } = parseRecipients(LIST, 84532);
    const key = listKey(84532, recipients);
    saveProgress(
      OWNER,
      84532,
      key,
      recipients.map((r, i) => ({ id: r.id, to: r.to, amount: r.amount.toString(), hash: i === 0 ? HASH : HASH2, attempt: { at: Date.now() }, status: i === 0 ? "sent" : "confirmed" })),
    );
    const { user } = setup();
    await paste(user, LIST);
    await user.click(screen.getByRole("button", { name: t.form.check }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, key, new Set(), new Set());
  });

  function seed(states: Array<Partial<RowState> & { status: RowState["status"] }>) {
    const { recipients } = parseRecipients(LIST, 84532);
    const key = listKey(84532, recipients);
    const stored = states.map((extra, i) => ({ id: recipients[i]!.id, to: recipients[i]!.to, amount: recipients[i]!.amount.toString(), ...extra }));
    saveProgress(OWNER, 84532, key, stored);
    return { recipients, key, stored };
  }
  const stale = () => ({ at: Date.now() - 11 * 60_000, block: "900" });

  it("C1: a line the chain does not show (not_found) has its link and is left out until «Comprobé que no se envió» is ticked", async () => {
    const { recipients, key } = seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
    const { user } = setup();
    await paste(user, LIST);
    const progress = screen.getByRole("list", { name: t.progress.title });
    expect(within(progress).getByText(t.progress.status.not_found)).toBeInTheDocument();
    expect(within(progress).getByRole("link", { name: fill(t.progress.viewTx, { n: 1 }) })).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
    const release = within(progress).getByRole("checkbox", { name: t.progress.release });
    expect(release).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: t.form.continue }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 7,5 USDC a 1 dirección en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    expect(within(dialog).getByText(t.confirm.checksOne)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.back }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    await user.click(release);
    await user.click(screen.getByRole("button", { name: t.form.continue }));
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 17,5 USDC a 2 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.confirm }));
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, key, new Set([recipients[2]!.id]), new Set([recipients[0]!.id]));
  });

  it("C1: unconfirmed and scan_failed lines cannot be ticked; scan_failed offers «Reintentar comprobación», which only re-checks", async () => {
    const { recipients, key } = seed([{ attempt: { at: Date.now() }, status: "unconfirmed" }, { hash: HASH2, attempt: stale(), status: "scan_failed" }, { hash: HASH, status: "confirmed" }]);
    const { user } = setup();
    await paste(user, LIST);
    const progress = screen.getByRole("list", { name: t.progress.title });
    expect(within(progress).getByText(t.progress.status.unconfirmed)).toBeInTheDocument();
    expect(within(progress).getByText(t.progress.status.scan_failed)).toBeInTheDocument();
    expect(within(progress).queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(within(progress).getByRole("button", { name: t.progress.retryCheck }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, key, new Set(), new Set());
  });

  it("finding 6: a tick is cleared after a run, so a stale tick never signs again", async () => {
    const { key, stored } = seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "confirmed" }]);
    const { user, rerender } = setup();
    await paste(user, LIST);
    await user.click(screen.getByRole("checkbox", { name: t.progress.release }));
    expect(screen.getByRole("checkbox", { name: t.progress.release })).toBeChecked();
    // A run ends (the line was sent again, and is not_found again later).
    hook.value = { ...hook.value, runs: 1, runKey: progressKey(OWNER, 84532, key), rows: [{ ...stored[0]!, hash: HASH2 }, stored[1]!, stored[2]!] };
    rerender(<MultisendForm lang="es" chains={[84532, 421614]} sessionWallet={null} />);
    expect(screen.getByRole("checkbox", { name: t.progress.release })).not.toBeChecked();
    expect(screen.getByRole("button", { name: t.form.check })).toBeInTheDocument();
  });

  it("finding 6: a tick is cleared when the line changes state, even without a new run", async () => {
    const { key, stored } = seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "confirmed" }]);
    const { user, rerender } = setup();
    await paste(user, LIST);
    await user.click(screen.getByRole("checkbox", { name: t.progress.release }));
    hook.value = { ...hook.value, runKey: progressKey(OWNER, 84532, key), rows: [{ ...stored[0]!, attempt: { at: Date.now() - 20 * 60_000, block: "1" }, updated: Date.now() }, stored[1]!, stored[2]!] };
    rerender(<MultisendForm lang="es" chains={[84532, 421614]} sessionWallet={null} />);
    expect(screen.getByRole("checkbox", { name: t.progress.release })).not.toBeChecked();
  });

  it("no storage: a visible notice says the progress will not survive a reload", async () => {
    hook.value.storageOk = false;
    setup();
    expect(screen.getByText(t.form.storageOff)).toBeInTheDocument();
  });

  it("no storage detected at load: the same notice", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setup();
    expect(screen.getByText(t.form.storageOff)).toBeInTheDocument();
    spy.mockRestore();
  });

  it("finding 12: an unknown balance does not block but the confirmation warns about it", async () => {
    balances.value = { ...balances.value, "USDC:84532": null };
    const { user } = setup();
    await paste(user, LIST);
    await user.click(sendButton());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(fill(t.confirm.balanceUnknown, { total: "30" }))).toBeInTheDocument();
  });

  it("C3: a line confirmed in the last 24 h warns and blocks «Enviar» until «Enviarlo otra vez» is ticked", async () => {
    recordConfirmed({ chain: 84532, to: A as `0x${string}`, amount: "10000000", hash: HASH }, Date.now());
    recordConfirmed({ chain: 421614, to: B as `0x${string}`, amount: "12500000", hash: HASH2 }, Date.now());
    const { user } = setup();
    await paste(user, LIST);
    const preview = screen.getByRole("list", { name: t.form.preview });
    expect(within(preview).getByText(fill(t.form.repeat, { amount: "10" }))).toBeInTheDocument();
    expect(within(preview).getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(t.form.repeatBlock)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await user.click(within(preview).getByRole("checkbox", { name: t.form.repeatAccept }));
    expect(sendButton()).toBeEnabled();
    expect(screen.queryByText(t.form.repeatBlock)).not.toBeInTheDocument();
  });

  it("C3: the list's own confirmed lines are not flagged as repeats", async () => {
    const { recipients } = parseRecipients(LIST, 84532);
    const key = listKey(84532, recipients);
    saveProgress(
      OWNER,
      84532,
      key,
      recipients.map((r, i) => ({ id: r.id, to: r.to, amount: r.amount.toString(), status: i === 0 ? "confirmed" : "todo", ...(i === 0 ? { hash: HASH } : {}) })),
    );
    recordConfirmed({ chain: 84532, to: A as `0x${string}`, amount: "10000000", hash: HASH }, Date.now());
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.queryByText(fill(t.form.repeat, { amount: "10" }))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.form.continue })).toBeEnabled();
  });

  it("an atomic failure shows its error and offers «Enviar una a una» without retrying by itself", async () => {
    hook.value.mode = "atomic";
    hook.value.error = "atomic_failed";
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText(t.progress.errors.atomic_failed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.progress.oneByOne }));
    expect(hook.value.sendOneByOne).toHaveBeenCalled();
    expect(hook.value.send).not.toHaveBeenCalled();
  });

  it("EN has no Spanish strings", async () => {
    const en = getDictionary("en").multisend;
    const { user, container } = setup({ lang: "en" });
    const box = screen.getByRole("textbox", { name: en.form.label });
    await user.click(box);
    await user.paste(LIST);
    expect(screen.getByRole("button", { name: en.form.send })).toBeEnabled();
    expect(screen.getByText(getDictionary("en").common.noCustody)).toBeInTheDocument();
    const text = container.textContent ?? "";
    for (const word of ["Enviar", "Destinatarios", "Saldo", "Resumen", "Línea", "Red", "custodia"]) expect(text).not.toContain(word);
    await user.click(screen.getByRole("button", { name: en.form.send }));
    expect(await screen.findByText("You are about to send 30 USDC to 3 addresses on Base Sepolia. Every transfer is final.")).toBeInTheDocument();
  });

  it("R1: with a pending tx in the wallet, a not_found line cannot be ticked, with the reason", async () => {
    seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
    idle.value = "pending";
    const { user } = setup();
    await paste(user, LIST);
    expect(idle.args).toEqual([84532, OWNER, true]);
    expect(screen.getByRole("checkbox", { name: t.progress.release })).toBeDisabled();
    expect(screen.getByText(t.progress.walletPending)).toBeInTheDocument();
    expect(t.progress.walletPending).toBe("Hay una transacción pendiente en tu wallet; espera a que se confirme o se cancele");
  });

  it("R1: when the wallet's nonces cannot be read (or are being read), the tick is disabled too", async () => {
    seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
    idle.value = "unknown";
    const { user, rerender } = setup();
    await paste(user, LIST);
    expect(screen.getByRole("checkbox", { name: t.progress.release })).toBeDisabled();
    expect(screen.getByText(t.progress.walletUnknown)).toBeInTheDocument();
    idle.value = "checking";
    rerender(<MultisendForm lang="es" chains={[84532, 421614]} sessionWallet={null} />);
    expect(screen.getByRole("checkbox", { name: t.progress.release })).toBeDisabled();
  });

  it("R1: a tick given while idle does not count once a tx is pending", async () => {
    const { recipients } = seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
    const { user, rerender } = setup();
    await paste(user, LIST);
    await user.click(screen.getByRole("checkbox", { name: t.progress.release }));
    idle.value = "pending";
    rerender(<MultisendForm lang="es" chains={[84532, 421614]} sessionWallet={null} />);
    await user.click(screen.getByRole("button", { name: t.form.continue }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 7,5 USDC a 1 dirección en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.confirm }));
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, expect.any(String), new Set([recipients[2]!.id]), new Set());
  });

  it("R5: while another tab holds the lock on this list, it says so and nothing can start", async () => {
    window.localStorage.setItem(lockKey(walletRunKey(OWNER, 84532)), JSON.stringify({ tab: "other-tab", beat: Date.now() }));
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText(t.form.locked)).toBeInTheDocument();
    expect(t.form.locked).toBe("Otra pestaña está enviando con esta wallet");
    expect(sendButton()).toBeDisabled();
  });

  it("R5: a stale lock (> 30 s) does not block", async () => {
    window.localStorage.setItem(lockKey(walletRunKey(OWNER, 84532)), JSON.stringify({ tab: "other-tab", beat: Date.now() - 31_000 }));
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.queryByText(t.form.locked)).not.toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  describe("fix round 4", () => {
  it("NEW-4: a line attempted from another list in the last 24 h shows as «Sin confirmar» and is only re-checked, never signed", async () => {
    recordAttempt({ chain: 84532, from: OWNER, to: A as `0x${string}`, amount: "10000000", block: "900" }, Date.now());
    const { recipients } = parseRecipients(LIST, 84532);
    const { user } = setup();
    await paste(user, LIST);
    const progress = screen.getByRole("list", { name: t.progress.title });
    expect(within(progress).getByText(t.progress.status.unconfirmed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.form.continue }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 20 USDC a 2 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    expect(within(dialog).getByText(t.confirm.checksOne)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.confirm }));
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, listKey(84532, recipients), new Set([recipients[1]!.id, recipients[2]!.id]), new Set());
  });

  it("NEW-4: another wallet's attempt is not inherited", async () => {
    recordAttempt({ chain: 84532, from: OTHER, to: A as `0x${string}`, amount: "10000000", block: "900" }, Date.now());
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.queryByRole("list", { name: t.progress.title })).not.toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });

  it("minor: a not_found line without a link says how to check it instead of pointing at a link", async () => {
    seed([{ attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
    const { user } = setup();
    await paste(user, LIST);
    expect(screen.getByText(t.progress.releaseHintNoLink)).toBeInTheDocument();
    expect(screen.queryByText(t.progress.releaseHint)).not.toBeInTheDocument();
  });

  it("minor: the no-storage notice also warns about other tabs", () => {
    hook.value.storageOk = false;
    setup();
    expect(t.form.storageOff).toMatch(/otra pestaña/);
    expect(getDictionary("en").multisend.form.storageOff).toMatch(/another tab/);
  });
});

  describe("fix round 5", () => {
    it("NEW-5: another tab running any list of this wallet shows the notice and nothing can start", async () => {
      window.localStorage.setItem(lockKey(walletRunKey(OWNER, 84532)), JSON.stringify({ tab: "other-tab", beat: Date.now() }));
      const { user } = setup();
      await paste(user, `${D},1`);
      expect(screen.getByText(t.form.locked)).toBeInTheDocument();
      expect(sendButton()).toBeDisabled();
    });

    it("after a run, a newer stored copy (another tab) replaces the run's stale rows on screen", async () => {
      const { recipients, key, stored } = seed([{ status: "todo" }, { status: "todo" }, { status: "todo" }]);
      const at = Date.now();
      saveProgress(OWNER, 84532, key, [{ ...stored[0]!, status: "confirmed", hash: HASH, updated: at + 5 }, stored[1]!, stored[2]!]);
      hook.value = {
        ...hook.value,
        runs: 1,
        runKey: progressKey(OWNER, 84532, key),
        rows: [{ ...stored[0]!, status: "unconfirmed", attempt: { block: "900", at }, updated: at }, stored[1]!, stored[2]!],
      };
      const { user } = setup();
      await paste(user, LIST);
      const progress = screen.getByRole("list", { name: t.progress.title });
      expect(within(progress).getByText(t.progress.status.confirmed)).toBeInTheDocument();
      expect(within(progress).queryByText(t.progress.status.unconfirmed)).not.toBeInTheDocument();
      expect(recipients).toHaveLength(3);
    });

    it("copy: honest locked and wallet_pending texts, progress lives in this browser, open requests, smart wallets", async () => {
      for (const lang of ["es", "en"] as const) {
        const d = getDictionary(lang).multisend;
        expect(d.progress.errors.locked).not.toMatch(/nada|nothing/i);
        expect(d.progress.errors.wallet_pending).not.toMatch(/marcadas|ticked/i);
      }
      expect(t.progress.errors.locked).toBe("Se detuvo: otra pestaña está usando esta wallet. Revisa el estado de cada línea.");
      expect(t.progress.releaseHint).toContain("y que no tengas solicitudes de firma abiertas en tu wallet");
      expect(t.progress.releaseHintNoLink).toContain("y que no tengas solicitudes de firma abiertas en tu wallet");
      seed([{ hash: HASH, attempt: stale(), status: "not_found" }, { hash: HASH2, status: "confirmed" }, { status: "todo" }]);
      const { user } = setup();
      await paste(user, LIST);
      expect(screen.getByText(t.form.browserOnly)).toBeInTheDocument();
      expect(t.form.browserOnly).toBe("El progreso se guarda solo en este navegador.");
      expect(screen.getByText(t.progress.smartWallet)).toBeInTheDocument();
      expect(t.progress.smartWallet).toMatch(/ERC-4337/);
    });
  });
});
