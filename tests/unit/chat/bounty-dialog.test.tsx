import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createBountyAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction }));
const balances = vi.hoisted(() => ({ map: {} as Record<string, bigint | null>, calls: [] as unknown[][] }));
vi.mock("@/lib/payments/balances", () => ({
  useAssetBalances: (...a: unknown[]) => {
    balances.calls.push(a);
    return balances.map;
  },
}));

import { BountyDialog } from "@/components/chat/bounty-dialog";
import { EconomyProvider } from "@/components/payments/economy-provider";
import type { EconomyConfig } from "@/lib/economy/config";

const CH = "11111111-1111-4111-8111-111111111111";
const config: EconomyConfig = {
  enabledChainIds: [84532, 421614],
  safes: {},
  legacyDaoEnabled: false,
  legacy: { activeChainId: 59141, withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false }, chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } } },
};

function setup(initialText = "") {
  const onSlowmode = vi.fn();
  const onPosted = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EconomyProvider config={config} wallet="0x1111111111111111111111111111111111111111" memberId="m1">
      <BountyDialog open onOpenChange={onOpenChange} channelId={CH} initialText={initialText} onPosted={onPosted} onSlowmode={onSlowmode} />
    </EconomyProvider>,
  );
  return { onPosted, onSlowmode, onOpenChange, user: userEvent.setup() };
}

const amountBox = () => screen.getByLabelText("Recompensa");
const publish = () => screen.getByRole("button", { name: "Publicar bounty" });

const radio = (re: RegExp) => screen.getByRole("radio", { name: re });

beforeEach(() => {
  createBountyAction.mockReset();
  balances.map = {};
  balances.calls = [];
});

describe("BountyDialog", () => {
  it("offers USDC and ETH of every enabled network, USDC of the first one chosen, and the guide link", () => {
    setup();
    const group = screen.getByRole("radiogroup", { name: "Moneda" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(radio(/USDC.*Base Sepolia/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/ETH.*Arbitrum Sepolia/)).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/foro/guia/bounties");
  });

  it("explains the network is indicative and that ElClub. holds no funds", () => {
    setup();
    expect(
      screen.getByText("La red es orientativa: podrás pagar con el mismo token en otra red que acepte quien lo resuelva."),
    ).toBeInTheDocument();
    expect(screen.getByText("ElClub. no custodia fondos: va directo a su wallet.")).toBeInTheDocument();
  });

  it("shows the creator's balances as a guide (read for the session wallet), without blocking a bigger reward", async () => {
    balances.map = { "USDC:84532": 2_000_000n, "ETH:84532": 0n, "USDC:421614": 0n, "ETH:421614": 0n };
    createBountyAction.mockResolvedValue({ ok: true, messageId: "m1" });
    const { user, onPosted } = setup("ayuda");
    expect(balances.calls.at(-1)![1]).toBe("0x1111111111111111111111111111111111111111");
    expect(radio(/USDC.*Base Sepolia/)).toHaveAccessibleName(/Saldo: 2/);
    await user.type(amountBox(), "50");
    await user.click(publish());
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
  });

  it("the picker is only a guide: rows keep their order while the reward is typed", async () => {
    balances.map = { "USDC:84532": 2_000_000n, "ETH:84532": 10n ** 18n, "USDC:421614": 100_000_000n, "ETH:421614": 10n ** 18n };
    const { user } = setup("ayuda");
    const order = () => screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? r.textContent);
    const before = order();
    await user.type(amountBox(), "50");
    expect(order()).toEqual(before);
    expect(screen.getAllByRole("radio")[0]).toHaveAccessibleName(/USDC.*Base Sepolia/);
  });

  it("with no enabled network it says so and cannot publish", async () => {
    const onPosted = vi.fn();
    render(
      <EconomyProvider config={{ ...config, enabledChainIds: [] }} wallet="0x1111111111111111111111111111111111111111" memberId="m1">
        <BountyDialog open onOpenChange={() => {}} channelId={CH} initialText="ayuda" onPosted={onPosted} />
      </EconomyProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ahora mismo no hay ninguna red activa para publicar bounties.");
    expect(publish()).toBeDisabled();
    expect(createBountyAction).not.toHaveBeenCalled();
  });

  it("choosing ETH:421614 posts that token and network", async () => {
    createBountyAction.mockResolvedValue({ ok: true, messageId: "m1" });
    const { user, onPosted } = setup("ayuda");
    await user.click(radio(/ETH.*Arbitrum Sepolia/));
    await user.type(amountBox(), "0,01");
    await user.click(publish());
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    expect(createBountyAction).toHaveBeenCalledWith(expect.objectContaining({ chainId: 421614, token: "ETH", amount: "0,01" }));
  });

  it("rejects a USDC amount under 1 or over 100000 without calling the server", async () => {
    const { user } = setup("ayuda");
    await user.type(amountBox(), "0,5");
    expect(screen.getByText("La recompensa debe estar entre 1 y 100000 USDC.")).toBeInTheDocument();
    await user.click(publish());
    expect(createBountyAction).not.toHaveBeenCalled();
    await user.clear(amountBox());
    await user.type(amountBox(), "100001");
    expect(screen.getByText("La recompensa debe estar entre 1 y 100000 USDC.")).toBeInTheDocument();
    await user.click(publish());
    expect(createBountyAction).not.toHaveBeenCalled();
  });

  it("hands the slowmode seconds to the composer so its countdown starts", async () => {
    createBountyAction.mockResolvedValue({ ok: false, code: "slowmode", error: "Vas demasiado rápido. Espera un momento.", slowmodeSeconds: 42 });
    const { user, onSlowmode, onPosted } = setup("ayuda");
    await user.type(amountBox(), "5");
    await user.click(publish());
    await waitFor(() => expect(onSlowmode).toHaveBeenCalledWith(42));
    expect(await screen.findByRole("alert")).toHaveTextContent(/demasiado rápido/);
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("uses the ETH bounds (0,0001 to 100) once ETH is chosen", async () => {
    const { user } = setup("ayuda");
    await user.click(radio(/ETH.*Base Sepolia/));
    await user.type(amountBox(), "0,00001");
    expect(screen.getByText("La recompensa debe estar entre 0,0001 y 100 ETH.")).toBeInTheDocument();
    await user.clear(amountBox());
    await user.type(amountBox(), "0,0001");
    expect(screen.queryByText(/La recompensa debe estar entre/)).not.toBeInTheDocument();
  });

  it("requires an amount and a description", async () => {
    const { user } = setup("");
    await user.click(publish());
    expect(await screen.findByRole("alert")).toHaveTextContent("importe");
    await user.type(amountBox(), "10");
    await user.click(publish());
    expect(await screen.findByRole("alert")).toHaveTextContent("descripción");
    expect(createBountyAction).not.toHaveBeenCalled();
  });

  it("posts amount, token and the description (prefilled from the composer) as a doc, then closes", async () => {
    createBountyAction.mockResolvedValue({ ok: true, messageId: "m1" });
    const { user, onPosted, onOpenChange } = setup("línea uno\nlínea dos");
    await user.type(amountBox(), "25");
    await user.click(publish());
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    expect(createBountyAction).toHaveBeenCalledWith({
      channelId: CH,
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "línea uno" }] },
          { type: "paragraph", content: [{ type: "text", text: "línea dos" }] },
        ],
      },
      chainId: 84532,
      token: "USDC",
      amount: "25",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the server error and stays open", async () => {
    createBountyAction.mockResolvedValue({ ok: false, code: "forbidden", error: "No tienes permiso para hacer esto." });
    const { user, onPosted } = setup("ayuda");
    await user.type(amountBox(), "25");
    await user.click(publish());
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para hacer esto.");
    expect(onPosted).not.toHaveBeenCalled();
  });
});
