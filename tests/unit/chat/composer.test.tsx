import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMessageAction = vi.fn();
const getSlowmodeAction = vi.fn();
const searchMentionTargetsAction = vi.fn(async () => ({ members: [], roles: [] }));
vi.mock("@/lib/polls/actions", () => ({ createPollAction: vi.fn(), votePollAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/chat/actions", () => ({
  postMessageAction: (...a: unknown[]) => postMessageAction(...a),
  getSlowmodeAction: (...a: unknown[]) => getSlowmodeAction(...a),
  searchMentionTargetsAction: (...a: unknown[]) => searchMentionTargetsAction(...(a as [])),
}));
vi.mock("@/lib/chat/alpha", () => ({ postAlphaAction: vi.fn() }));
const uploadChatImage = vi.fn();
vi.mock("@/lib/chat/upload", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/upload")>()), uploadChatImage: (...a: unknown[]) => uploadChatImage(...a) }));
const memberRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: memberRpc }) }));

import { Composer } from "@/components/chat/composer";
import { formatDuration, SlowmodeTimer } from "@/components/chat/slowmode-timer";

const CH = "11111111-1111-4111-8111-111111111111";
const base = { channelId: CH, canPost: true, canAttach: true, canMentionEveryone: false, slowmodeSeconds: 0 };

async function mount(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const utils = render(<Composer {...base} {...props} />);
  const box = await screen.findByRole("textbox", { name: "Mensaje" });
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  return { ...utils, box, editor };
}

function type(editor: Editor, text: string) {
  act(() => {
    editor.commands.setContent(text);
  });
}

beforeEach(() => {
  postMessageAction.mockReset();
  getSlowmodeAction.mockReset();
  getSlowmodeAction.mockResolvedValue({ seconds: 0 });
  uploadChatImage.mockReset();
  memberRpc.mockReset();
  memberRpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
});
afterEach(() => vi.useRealTimers());

describe("Composer", () => {
  it("Enter sends the sanitized doc", async () => {
    postMessageAction.mockResolvedValue({ id: "m1" });
    const onPosted = vi.fn();
    const { box, editor } = await mount({ onPosted });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(postMessageAction).toHaveBeenCalledTimes(1));
    const arg = postMessageAction.mock.calls[0]![0];
    expect(arg).toMatchObject({ channelId: CH, expanded: false });
    expect(JSON.stringify(arg.doc)).toContain("hola");
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(editor.isEmpty).toBe(true));
  });

  it("sends a plain-object doc: ProseMirror attrs (null prototype) would reach the server action as an opaque reference and lose the links", async () => {
    postMessageAction.mockResolvedValue({ id: "m1" });
    const { box, editor } = await mount();
    type(editor, '<p>mira <a href="https://ejemplo.com/x">https://ejemplo.com/x</a></p>');
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(postMessageAction).toHaveBeenCalledTimes(1));
    const doc = postMessageAction.mock.calls[0]![0].doc as { content: Array<{ content: Array<{ marks?: Array<{ attrs: object }> }> }> };
    const link = doc.content[0]!.content.flatMap((n) => n.marks ?? [])[0]!;
    expect(link.attrs).toBeDefined();
    expect(Object.getPrototypeOf(link.attrs)).toBe(Object.prototype);
  });

  it("Shift+Enter does not send", async () => {
    const { box, editor } = await mount();
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(postMessageAction).not.toHaveBeenCalled();
  });

  it("an empty doc is not sent", async () => {
    const { box } = await mount();
    fireEvent.keyDown(box, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 20));
    expect(postMessageAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeDisabled();
  });

  it("shows the disabled copy and no editor without canPost", () => {
    render(<Composer {...base} canPost={false} />);
    expect(screen.getByText("No tienes permiso para escribir en este canal.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Mensaje" })).not.toBeInTheDocument();
  });

  it("without canAttach there is no attach button and pasting an image warns", async () => {
    const { box } = await mount({ canAttach: false });
    expect(screen.queryByRole("button", { name: "Adjuntar imagen" })).not.toBeInTheDocument();
    const file = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [file], items: [], getData: () => "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para adjuntar imágenes");
    expect(uploadChatImage).not.toHaveBeenCalled();
  });

  it("with canAttach it uploads pasted images and shows removable thumbnails", async () => {
    uploadChatImage.mockResolvedValue({ path: "p", mime: "image/webp", size: 5, width: 1, height: 1 });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    const { box } = await mount();
    expect(screen.getByRole("button", { name: "Adjuntar imagen" })).toBeInTheDocument();
    const file = new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [file], items: [], getData: () => "" } });
    const remove = await screen.findByRole("button", { name: "Quitar a.png" });
    await waitFor(() => expect(uploadChatImage).toHaveBeenCalled());
    // an attachment alone is enough to send
    postMessageAction.mockResolvedValue({ id: "m2" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() =>
      expect(postMessageAction.mock.calls[0]![0].attachments).toEqual([{ path: "p", mime: "image/webp", size: 5, width: 1, height: 1 }]),
    );
    expect(remove).toBeDefined();
    vi.unstubAllGlobals();
  });

  it("limits attachments to 4", async () => {
    uploadChatImage.mockResolvedValue({ path: "p", mime: "image/webp", size: 5, width: 1, height: 1 });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    const { box } = await mount();
    const files = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(4)], `f${i}.png`, { type: "image/png" }));
    fireEvent.paste(box, { clipboardData: { files, items: [], getData: () => "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("4 imágenes");
    await waitFor(() => expect(uploadChatImage).toHaveBeenCalledTimes(4));
    vi.unstubAllGlobals();
  });

  it("a slowmode error starts the countdown and blocks sending", async () => {
    postMessageAction.mockResolvedValue({ error: "slowmode", slowmodeSeconds: 12 });
    const { box, editor } = await mount({ slowmodeSeconds: 30 });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Puedes escribir de nuevo en 12s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeDisabled();
    // only sending is locked: the member can keep drafting
    expect(editor.isEditable).toBe(true);
    // Enter during the cooldown does not call the server and explains why
    postMessageAction.mockClear();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Espera");
    expect(postMessageAction).not.toHaveBeenCalled();
    // keeps the text the member wrote
    expect(editor.getText()).toBe("hola");
  });

  it("a slowmode error without details asks the server, and alerts if it is still unknown", async () => {
    postMessageAction.mockResolvedValue({ error: "slowmode" });
    getSlowmodeAction.mockResolvedValue({ seconds: 0 });
    const first = await mount({ slowmodeSeconds: 30 });
    type(first.editor, "<p>hola</p>");
    getSlowmodeAction.mockClear();
    getSlowmodeAction.mockResolvedValue({ seconds: 9 });
    fireEvent.keyDown(first.box, { key: "Enter" });
    expect(await screen.findByText("Puedes escribir de nuevo en 9s")).toBeInTheDocument();
    expect(getSlowmodeAction).toHaveBeenCalledWith(CH);
  });

  it("a slowmode error with unknown seconds everywhere shows the generic copy", async () => {
    postMessageAction.mockResolvedValue({ error: "slowmode" });
    getSlowmodeAction.mockResolvedValue({ seconds: 0 });
    const { box, editor } = await mount({ slowmodeSeconds: 30 });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Vas demasiado rápido");
  });

  it("Enter sends when the mention popup has no matches (zero-match @xyz)", async () => {
    postMessageAction.mockResolvedValue({ id: "m1" });
    const { box, editor } = await mount();
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("@xyz");
    });
    // let the (debounced) suggestion search resolve with no results
    await new Promise((r) => setTimeout(r, 350));
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(postMessageAction).toHaveBeenCalledTimes(1));
  });

  it("disables the attach button while a send is in flight", async () => {
    let resolve!: (v: unknown) => void;
    postMessageAction.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { box, editor } = await mount();
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Adjuntar imagen" })).toBeDisabled());
    await act(async () => resolve({ id: "m1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Adjuntar imagen" })).toBeEnabled());
  });

  it("clears the 'Espera' alert when the cooldown elapses", async () => {
    postMessageAction.mockResolvedValue({ error: "slowmode", slowmodeSeconds: 1 });
    const { box, editor } = await mount({ slowmodeSeconds: 30 });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText("Puedes escribir de nuevo en 1s");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Espera");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it("retries resolving the member id after a failure", async () => {
    uploadChatImage.mockResolvedValue({ path: "p", mime: "image/webp", size: 5, width: 1, height: 1 });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    memberRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { box } = await mount();
    const f = () => new File([new Uint8Array(4)], "a.png", { type: "image/png" });
    fireEvent.paste(box, { clipboardData: { files: [f()], items: [], getData: () => "" } });
    await screen.findByRole("alert");
    expect(uploadChatImage).not.toHaveBeenCalled();
    fireEvent.paste(box, { clipboardData: { files: [f()], items: [], getData: () => "" } });
    await waitFor(() => expect(uploadChatImage).toHaveBeenCalledTimes(1));
    expect(memberRpc).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("does not send twice when Enter is pressed again while a post is in flight", async () => {
    let resolve!: (v: unknown) => void;
    postMessageAction.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { box, editor } = await mount();
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(postMessageAction).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ id: "m1" }));
  });

  it("emoji picker uses pressed category buttons and Escape returns focus to the trigger", async () => {
    await mount();
    const trigger = screen.getByRole("button", { name: "Insertar emoji" });
    await userEvent.click(trigger);
    expect(await screen.findByRole("group", { name: "Categorías de emoji" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Caras" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Gestos" }));
    expect(screen.getByRole("button", { name: "Gestos" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("group", { name: "Categorías de emoji" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("shows other mapped errors with role=alert and keeps the draft", async () => {
    postMessageAction.mockResolvedValue({ error: "too_long" });
    const { box, editor } = await mount();
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("El mensaje es demasiado largo.");
    expect(editor.getText()).toBe("hola");
  });

  it("shows the quoted chip and lets the member remove it", async () => {
    const onRemoveQuoted = vi.fn();
    await mount({ quoted: { id: "55555555-5555-4555-8555-555555555555", authorName: "Ana" }, onRemoveQuoted });
    expect(screen.getByText("Citando a Ana")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar cita" }));
    expect(onRemoveQuoted).toHaveBeenCalled();
  });

  it("shows the character counter near the limit", async () => {
    const { editor } = await mount();
    expect(screen.queryByText(/\/ 4000/)).not.toBeInTheDocument();
    type(editor, `<p>${"a".repeat(3700)}</p>`);
    expect(await screen.findByText("3700 / 4000")).toBeInTheDocument();
  });

  it("expands into a dialog with a formatting toolbar and sends as expanded", async () => {
    postMessageAction.mockResolvedValue({ id: "m3" });
    const { editor } = await mount();
    type(editor, "<p>borrador</p>");
    await userEvent.click(screen.getByRole("button", { name: "Expandir editor" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    for (const name of ["Encabezado 1", "Encabezado 2", "Encabezado 3", "Lista con viñetas", "Lista numerada", "Cita", "Bloque de código", "Tabla", "Separador"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed");
    }
    // the draft moved into the expanded editor
    expect(editor.isEmpty).toBe(true);
    const boxes = await screen.findAllByRole("textbox", { name: "Mensaje" });
    const expandedBox = boxes[boxes.length - 1]!;
    expect(expandedBox.textContent).toContain("borrador");
    fireEvent.keyDown(expandedBox, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(postMessageAction).toHaveBeenCalled());
    expect(postMessageAction.mock.calls[0]![0]).toMatchObject({ expanded: true });
  });

  it("toolbar buttons toggle formatting", async () => {
    const { editor } = await mount();
    type(editor, "<p>titulo</p>");
    await userEvent.click(screen.getByRole("button", { name: "Expandir editor" }));
    await screen.findByRole("dialog");
    const h1 = screen.getByRole("button", { name: "Encabezado 1" });
    await userEvent.click(h1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Encabezado 1" })).toHaveAttribute("aria-pressed", "true"));
  });
});

describe("Composer alpha", () => {
  it("does not mount the Alpha dialog unless the channel and the member allow it", async () => {
    await mount();
    expect(screen.queryByRole("dialog", { name: "Publicar alpha" })).toBeNull();
  });
});

describe("SlowmodeTimer", () => {
  it("ticks silently (aria-hidden) and announces only the start and the end", () => {
    vi.useFakeTimers();
    const onElapsed = vi.fn();
    const { container } = render(<SlowmodeTimer seconds={3} resetKey={1} onElapsed={onElapsed} />);
    const status = screen.getByText("Puedes escribir de nuevo en 3s");
    expect(status.closest("[aria-hidden='true']")).not.toBeNull();
    const live = container.querySelector("[aria-live='polite']")!;
    expect(live).toHaveClass("sr-only");
    expect(live.textContent).toBe("Podrás escribir de nuevo en 3s");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Puedes escribir de nuevo en 2s")).toBeInTheDocument();
    expect(live.textContent).toBe("Podrás escribir de nuevo en 3s");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText(/Puedes escribir/)).not.toBeInTheDocument();
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(live.textContent).toBe("Ya puedes escribir");
  });

  it("restarts when the reset key changes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SlowmodeTimer seconds={5} resetKey={1} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<SlowmodeTimer seconds={5} resetKey={2} />);
    expect(screen.getByText("Puedes escribir de nuevo en 5s")).toBeInTheDocument();
  });

  it("renders no text for 0 seconds (the live region stays mounted)", () => {
    const { container } = render(<SlowmodeTimer seconds={0} resetKey={1} />);
    expect(container.textContent).toBe("");
  });

  it("formats long durations", () => {
    expect(formatDuration(5)).toBe("5s");
    expect(formatDuration(59)).toBe("59s");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(86400)).toBe("1d 0:00");
    expect(formatDuration(604800)).toBe("7d 0:00");
    expect(formatDuration(90061)).toBe("1d 1:01");
  });
});
