import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createBountyAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction }));

import { BountyDialog } from "@/components/chat/bounty-dialog";
import { EconomyProvider } from "@/components/payments/economy-provider";

const CH = "11111111-1111-4111-8111-111111111111";
const config = {
  activeChainId: 59141 as const,
  minFeeBps: 100,
  withdrawalsEnabled: { 59144: false, 59141: false }, weightedRafflesEnabled: { 59144: false, 59141: false },
  chains: { 59144: { safe: null, platform: null }, 59141: { safe: null, platform: null } },
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

beforeEach(() => {
  createBountyAction.mockReset();
});

describe("BountyDialog", () => {
  it("shows the active network and the guide link", () => {
    setup();
    expect(screen.getByText(/MODO PRUEBA · Linea Sepolia/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/bounties");
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
    await user.click(screen.getByRole("radio", { name: "ETH" }));
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
