import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

import { MessageItem, type MessageItemProps } from "@/components/chat/message-item";
import { ReactionBar } from "@/components/chat/reaction-bar";
import { directory, makeMessage, ME, viewer } from "./fixtures";

function setup(props: Partial<MessageItemProps> = {}) {
  const handlers = {
    onOpenThread: vi.fn(),
    onQuote: vi.fn(),
    onEdit: vi.fn<NonNullable<MessageItemProps["onEdit"]>>(async () => null),
    onDelete: vi.fn<NonNullable<MessageItemProps["onDelete"]>>(async () => null),
    onPin: vi.fn(),
    onToggleReaction: vi.fn(),
  };
  const message = props.message ?? makeMessage();
  const utils = render(
    <ol>
      <MessageItem
        message={message}
        directory={directory}
        allowedDomains={["github.com"]}
        viewer={viewer()}
        {...handlers}
        {...props}
      />
    </ol>,
  );
  return { ...utils, ...handlers, message };
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
  return screen.findByRole("menu");
}
const items = () => screen.getAllByRole("menuitem").map((i) => i.textContent);

describe("MessageItem", () => {
  it("shows author, time and the rendered content", () => {
    setup({ message: makeMessage({ body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hola mundo" }] }] } }) });
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("hola mundo")).toBeInTheDocument();
    expect(document.querySelector("time")).not.toBeNull();
  });

  it("falls back to a generic name when the author is unknown", () => {
    setup({ directory: { members: {}, roles: {} } });
    expect(screen.getByText("Miembro")).toBeInTheDocument();
  });

  it("marks edited messages", () => {
    setup({ message: makeMessage({ editedAt: "2026-10-17T11:00:00+00:00" }) });
    expect(screen.getByText("editado")).toBeInTheDocument();
  });

  it("grouped messages omit the author header", () => {
    setup({ grouped: true });
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();
  });

  it("a soft-deleted message is a placeholder without content, menu or reactions", () => {
    setup({
      message: makeMessage({ deletedAt: "2026-10-17T11:00:00+00:00", replyCount: 2, reactions: [{ emoji: "👍", count: 1, reactedByMe: false }] }),
    });
    expect(screen.getByText("Mensaje eliminado")).toBeInTheDocument();
    expect(screen.queryByText(/mensaje \d+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acciones del mensaje" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /👍/ })).not.toBeInTheDocument();
    // the thread stays reachable
    expect(screen.getByRole("button", { name: "2 respuestas" })).toBeInTheDocument();
  });

  it("opens the thread from the reply counter", async () => {
    const { onOpenThread, message } = setup({ message: makeMessage({ replyCount: 1 }) });
    await userEvent.click(screen.getByRole("button", { name: "1 respuesta" }));
    expect(onOpenThread).toHaveBeenCalledWith(message, expect.anything());
  });

  it("renders the quote preview", () => {
    setup({ message: makeMessage({ quotedId: "q", quote: { authorName: "Luis", text: "texto citado", deleted: false } }) });
    expect(screen.getByText("Luis")).toBeInTheDocument();
    expect(screen.getByText("texto citado")).toBeInTheDocument();
  });

  describe("menu depends on permissions", () => {
    it("a regular member on someone else's message: reply, quote, report (disabled); no edit/delete/pin", async () => {
      setup();
      await openMenu();
      expect(items()).toEqual(["Responder en hilo", "Citar", "Reportar Próximamente"]);
      const report = screen.getByRole("menuitem", { name: /Reportar/ });
      expect(report).toHaveAttribute("aria-disabled", "true");
      expect(report).toHaveAttribute("title", "Próximamente");
    });

    it("the author can edit and delete but not pin", async () => {
      setup({ message: makeMessage({ authorId: ME }) });
      await openMenu();
      expect(items()).toEqual(["Responder en hilo", "Citar", "Editar", "Borrar"]);
    });

    it("a moderator can delete and pin someone else's message", async () => {
      setup({ viewer: viewer({ canManage: true }) });
      await openMenu();
      expect(items()).toEqual(["Responder en hilo", "Citar", "Borrar", "Fijar", "Reportar Próximamente"]);
    });

    it("a pinned message offers to unpin", async () => {
      setup({ viewer: viewer({ canManage: true }), message: makeMessage({ pinnedAt: "2026-10-17T11:00:00+00:00" }) });
      await openMenu();
      expect(items()).toContain("Desfijar");
      expect(items()).not.toContain("Fijar");
    });

    it("moderators cannot edit others' messages; replies cannot be pinned or replied to again", async () => {
      setup({ viewer: viewer({ canManage: true }), message: makeMessage({ threadRootId: "root" }), variant: "thread" });
      await openMenu();
      expect(items()).toEqual(["Borrar", "Reportar Próximamente"]);
    });

    it("without SEND_IN_THREADS the thread entry reads 'Ver hilo'", async () => {
      setup({ viewer: viewer({ canThread: false }) });
      await openMenu();
      expect(items()).toContain("Ver hilo");
      expect(items()).not.toContain("Responder en hilo");
    });

    it("without canPost there is no quote", async () => {
      setup({ viewer: viewer({ canPost: false }) });
      await openMenu();
      expect(items()).not.toContain("Citar");
    });
  });

  it("menu actions call their handlers", async () => {
    const { onOpenThread, onQuote, onPin, message } = setup({ viewer: viewer({ canManage: true }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Responder en hilo" }));
    expect(onOpenThread).toHaveBeenCalledWith(message, expect.anything());
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Citar" }));
    expect(onQuote).toHaveBeenCalledWith(message);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Fijar" }));
    expect(onPin).toHaveBeenCalledWith(message, true);
  });

  it("deleting asks for confirmation first", async () => {
    const { onDelete, message } = setup({ message: makeMessage({ authorId: ME }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(onDelete).not.toHaveBeenCalled();

    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(message));
  });

  it("editing opens an inline editor and saves the document", async () => {
    const { onEdit, message } = setup({ message: makeMessage({ authorId: ME }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    const box = await screen.findByRole("textbox", { name: "Editar mensaje" });
    expect(box).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]![0]).toBe(message);
    expect(JSON.stringify(onEdit.mock.calls[0]![1])).toContain("mensaje");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Editar mensaje" })).not.toBeInTheDocument());
  });

  it("cancelling an edit restores the message", async () => {
    const { onEdit } = setup({ message: makeMessage({ authorId: ME }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    await screen.findByRole("textbox", { name: "Editar mensaje" });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Editar mensaje" })).not.toBeInTheDocument();
  });

  it("an image message can be saved with an empty caption (SQL allows it)", async () => {
    const att = { id: "a1", url: null, mime: "image/png", width: 10, height: 10 };
    const { onEdit } = setup({ message: makeMessage({ authorId: ME, body: { type: "doc", content: [] }, attachments: [att] }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    await screen.findByRole("textbox", { name: "Editar mensaje" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
  });

  it("a text-only message cannot be saved empty", async () => {
    const { onEdit } = setup({ message: makeMessage({ authorId: ME, body: { type: "doc", content: [] } }) });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    await screen.findByRole("textbox", { name: "Editar mensaje" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("vacío");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("an edit error keeps the editor open and is announced", async () => {
    const onEdit = vi.fn<NonNullable<MessageItemProps["onEdit"]>>(async () => "No se pudo guardar.");
    setup({ message: makeMessage({ authorId: ME }), onEdit });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    await screen.findByRole("textbox", { name: "Editar mensaje" });
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar.");
    expect(screen.getByRole("textbox", { name: "Editar mensaje" })).toBeInTheDocument();
  });
});

describe("ReactionBar", () => {
  const chips = [
    { emoji: "👍", count: 2, reactedByMe: true },
    { emoji: "🔥", count: 1, reactedByMe: false },
  ];

  it("renders chips with aria-pressed and the count", () => {
    render(<ReactionBar reactions={chips} canReact onToggle={() => {}} />);
    const mine = screen.getByRole("button", { name: /👍/ });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    expect(mine).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /🔥/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles when a chip is clicked", async () => {
    const onToggle = vi.fn();
    render(<ReactionBar reactions={chips} canReact onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /🔥/ }));
    expect(onToggle).toHaveBeenCalledWith("🔥");
  });

  it("adds a reaction through the emoji picker", async () => {
    const onToggle = vi.fn();
    render(<ReactionBar reactions={[]} canReact onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Añadir reacción" }));
    await userEvent.click(await screen.findByRole("button", { name: "Insertar 😀" }));
    expect(onToggle).toHaveBeenCalledWith("😀");
  });

  it("without canReact chips are inert and there is no add button", () => {
    render(<ReactionBar reactions={chips} canReact={false} onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: /👍/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Añadir reacción" })).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<ReactionBar reactions={[]} canReact={false} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
