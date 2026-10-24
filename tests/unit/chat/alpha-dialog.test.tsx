import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postAlphaAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/alpha", () => ({ postAlphaAction }));

import { AlphaDialog } from "@/components/chat/alpha-dialog";

const CH = "11111111-1111-4111-8111-111111111111";
const ADDR = "0x1234567890abcdef1234567890abcdef12345678";

function setup(initialText = "") {
  const onPosted = vi.fn();
  const onOpenChange = vi.fn();
  render(<AlphaDialog open onOpenChange={onOpenChange} channelId={CH} initialText={initialText} onPosted={onPosted} />);
  return { onPosted, onOpenChange, user: userEvent.setup() };
}

// Block body on purpose: a function returned from beforeEach is run by Vitest as a cleanup hook, and mockReset()
// returns the mock itself, so `() => postAlphaAction.mockReset()` would call the action once more after each test.
beforeEach(() => {
  postAlphaAction.mockReset();
});

describe("AlphaDialog", () => {
  it("rejects a malformed address on the client without calling the server", async () => {
    const { user } = setup("mi tesis");
    await user.type(screen.getByLabelText("Contrato"), "0x123");
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("dirección");
    expect(postAlphaAction).not.toHaveBeenCalled();
  });

  it("shows the network picker with the first network of the build chosen, and the Contrato label", () => {
    setup("");
    const group = screen.getByRole("radiogroup", { name: "Red" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Base Sepolia" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Arbitrum Sepolia" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Contrato")).toBeInTheDocument();
  });

  it("sends the chosen network", async () => {
    postAlphaAction.mockResolvedValue({ id: "m2" });
    const { user, onPosted } = setup("tesis");
    await user.click(screen.getByRole("radio", { name: "Arbitrum Sepolia" }));
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m2"));
    expect(postAlphaAction).toHaveBeenCalledWith(expect.objectContaining({ chainId: 421614, address: ADDR }));
  });

  it("requires a thesis", async () => {
    const { user } = setup("");
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tesis");
    expect(postAlphaAction).not.toHaveBeenCalled();
  });

  it("posts the address and the thesis as a doc (prefilled from the composer) and closes", async () => {
    postAlphaAction.mockResolvedValue({ id: "m1" });
    const { user, onPosted, onOpenChange } = setup("línea uno\nlínea dos");
    await user.type(screen.getByLabelText("Contrato"), ` ${ADDR} `);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    expect(postAlphaAction).toHaveBeenCalledWith({
      channelId: CH,
      chainId: 84532,
      address: ADDR,
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "línea uno" }] },
          { type: "paragraph", content: [{ type: "text", text: "línea dos" }] },
        ],
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    ["not_a_contract", "Esa dirección no es un contrato en esa red."],
    ["network", "No se pudo verificar el contrato. Inténtalo de nuevo."],
    ["forbidden", "No tienes permiso para hacer esto."],
  ])("shows the Spanish copy for %s and stays open", async (code, copy) => {
    postAlphaAction.mockResolvedValue({ error: code });
    const { user, onPosted, onOpenChange } = setup("tesis");
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(onPosted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Publicar alpha" })).toBeEnabled();
  });

  it("hands the slowmode seconds to the composer so its countdown starts", async () => {
    postAlphaAction.mockResolvedValue({ error: "slowmode", slowmodeSeconds: 42 });
    const onSlowmode = vi.fn();
    const user = userEvent.setup();
    render(<AlphaDialog open onOpenChange={vi.fn()} channelId={CH} initialText="tesis" onPosted={vi.fn()} onSlowmode={onSlowmode} />);
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    await waitFor(() => expect(onSlowmode).toHaveBeenCalledWith(42));
    expect(await screen.findByRole("alert")).toHaveTextContent(/espera/i);
  });

  it("shows the fallback copy and re-enables the button when the action rejects", async () => {
    postAlphaAction.mockRejectedValue(new Error("boom"));
    const { user, onPosted } = setup("tesis");
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo falló");
    expect(screen.getByRole("button", { name: "Publicar alpha" })).toBeEnabled();
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("marks the thesis as required, visibly and for assistive tech", () => {
    setup("");
    const thesis = screen.getByRole("textbox", { name: /Tu tesis/ });
    expect(thesis).toBeRequired();
    expect(thesis).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("(obligatoria)")).toBeVisible();
    expect(screen.getByText(/texto plano/i)).toBeInTheDocument();
  });

  it("links the error to the offending field", async () => {
    const { user } = setup("");
    const address = screen.getByLabelText("Contrato");
    await user.type(address, "0x123");
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    const alert = await screen.findByRole("alert");
    expect(alert.id).not.toBe("");
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(address).toHaveAttribute("aria-describedby", expect.stringContaining(alert.id));
    await user.clear(address);
    await user.type(address, ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    const thesis = screen.getByRole("textbox", { name: /Tu tesis/ });
    await waitFor(() => expect(thesis).toHaveAttribute("aria-invalid", "true"));
    expect(thesis).toHaveAttribute("aria-describedby", expect.stringContaining(screen.getByRole("alert").id));
    expect(address).not.toHaveAttribute("aria-invalid", "true");
  });

  it("treats an answer without id or error as a generic failure", async () => {
    postAlphaAction.mockResolvedValue({});
    const { user } = setup("tesis");
    await user.type(screen.getByLabelText("Contrato"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo falló");
  });
});
