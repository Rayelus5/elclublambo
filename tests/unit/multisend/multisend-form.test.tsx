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
  sendOneByOne: ReturnType<typeof vi.fn>;
};
const hook = vi.hoisted(() => ({ value: {} as Hook }));
vi.mock("@/lib/multisend/use-multisend", () => ({ useMultisend: () => hook.value }));

import { MultisendForm } from "@/components/multisend/multisend-form";
import { encodeLines } from "@/lib/multisend/fragment";
import { listKey, parseRecipients } from "@/lib/multisend/parse";
import { saveProgress } from "@/lib/multisend/progress";
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
  account.isConnected = true;
  account.status = "connected";
  account.address = OWNER;
  balances.value = { "USDC:84532": 100_000_000n, "ETH:84532": 10n ** 17n, "USDC:421614": 0n, "ETH:421614": 0n };
  hook.value = { mode: "sequential", send: vi.fn(async () => {}), rows: [], runKey: null, running: false, switching: false, error: null, sendOneByOne: vi.fn() };
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
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, listKey(84532, recipients));
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

  it("Review Focus 4: saved progress shows each sent row with its hash and «Continuar» confirms only what is left", async () => {
    const { recipients } = parseRecipients(LIST, 84532);
    const key = listKey(84532, recipients);
    saveProgress(OWNER, 84532, key, [
      { to: recipients[0]!.to, amount: "10000000", hash: HASH, sentAt: Date.now(), status: "confirmed" },
      { to: recipients[1]!.to, amount: "12500000", status: "failed" },
      { to: recipients[2]!.to, amount: "7500000", status: "todo" },
    ]);
    hook.value.error = null;
    const { user } = setup();
    await paste(user, LIST);
    const progress = screen.getByRole("list", { name: t.progress.title });
    const link = within(progress).getByRole("link", { name: fill(t.progress.viewTx, { n: 1 }) });
    expect(link).toHaveAttribute("href", `https://sepolia.basescan.org/tx/${HASH}`);
    expect(within(progress).getByText(t.progress.status.confirmed)).toBeInTheDocument();
    expect(within(progress).getByText(t.progress.status.failed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.form.send })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.form.continue }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Vas a enviar 20 USDC a 2 direcciones en Base Sepolia. Cada envío es definitivo.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.confirm.confirm }));
    expect(hook.value.send).toHaveBeenCalledWith(recipients, OWNER, key);
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
});
