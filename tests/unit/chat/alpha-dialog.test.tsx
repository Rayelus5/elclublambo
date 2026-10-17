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

beforeEach(() => postAlphaAction.mockReset());

describe("AlphaDialog", () => {
  it("rejects a malformed address on the client without calling the server", async () => {
    const { user } = setup("mi tesis");
    await user.type(screen.getByLabelText("Contrato en Linea"), "0x123");
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("dirección");
    expect(postAlphaAction).not.toHaveBeenCalled();
  });

  it("requires a thesis", async () => {
    const { user } = setup("");
    await user.type(screen.getByLabelText("Contrato en Linea"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tesis");
    expect(postAlphaAction).not.toHaveBeenCalled();
  });

  it("posts the address and the thesis as a doc (prefilled from the composer) and closes", async () => {
    postAlphaAction.mockResolvedValue({ id: "m1" });
    const { user, onPosted, onOpenChange } = setup("línea uno\nlínea dos");
    await user.type(screen.getByLabelText("Contrato en Linea"), ` ${ADDR} `);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    expect(postAlphaAction).toHaveBeenCalledWith({
      channelId: CH,
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
    ["not_a_contract", "Esa dirección no es un contrato en Linea."],
    ["network", "No se pudo verificar el contrato. Inténtalo de nuevo."],
    ["forbidden", "No tienes permiso para hacer esto."],
  ])("shows the Spanish copy for %s and stays open", async (code, copy) => {
    postAlphaAction.mockResolvedValue({ error: code });
    const { user, onPosted, onOpenChange } = setup("tesis");
    await user.type(screen.getByLabelText("Contrato en Linea"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(onPosted).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "Publicar alpha" })).toBeEnabled();
  });

  it("treats an answer without id or error as a generic failure", async () => {
    postAlphaAction.mockResolvedValue({});
    const { user } = setup("tesis");
    await user.type(screen.getByLabelText("Contrato en Linea"), ADDR);
    await user.click(screen.getByRole("button", { name: "Publicar alpha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo falló");
  });
});
