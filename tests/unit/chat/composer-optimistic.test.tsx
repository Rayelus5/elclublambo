import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postMessageAction = vi.fn();
const getSlowmodeAction = vi.fn();
vi.mock("@/lib/polls/actions", () => ({ createPollAction: vi.fn(), votePollAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/chat/actions", () => ({
  postMessageAction: (...a: unknown[]) => postMessageAction(...a),
  getSlowmodeAction: (...a: unknown[]) => getSlowmodeAction(...a),
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
vi.mock("@/lib/chat/alpha", () => ({ postAlphaAction: vi.fn() }));
const uploadChatImage = vi.fn();
vi.mock("@/lib/chat/upload", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/upload")>()), uploadChatImage: (...a: unknown[]) => uploadChatImage(...a) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: vi.fn(async () => ({ data: "44444444-4444-4444-8444-444444444444", error: null })) }) }));

import { Composer } from "@/components/chat/composer";
import type { OutgoingMessage } from "@/lib/chat/pending";

const CH = "11111111-1111-4111-8111-111111111111";
const base = { channelId: CH, canPost: true, canAttach: true, canMentionEveryone: false, slowmodeSeconds: 0 };

async function mount(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const utils = render(<Composer {...base} {...props} />);
  const box = await screen.findByRole("textbox", { name: "Mensaje" });
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  return { ...utils, box, editor };
}

const type = (editor: Editor, html: string) =>
  act(() => {
    editor.commands.setContent(html);
  });

beforeEach(() => {
  postMessageAction.mockReset();
  getSlowmodeAction.mockReset();
  getSlowmodeAction.mockResolvedValue({ seconds: 0 });
  uploadChatImage.mockReset();
});

describe("Composer with an optimistic sender", () => {
  it("hands the message over and clears the box at once, without posting itself", async () => {
    let finish: (v: object) => void = () => {};
    const onSendOptimistic = vi.fn<(m: OutgoingMessage) => Promise<object>>(() => new Promise<object>((r) => (finish = r)));
    const onPosted = vi.fn();
    const { box, editor } = await mount({ onSendOptimistic, onPosted, quoted: { id: "q1", authorName: "Ana" }, onRemoveQuoted: vi.fn() });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSendOptimistic).toHaveBeenCalledTimes(1));
    expect(onSendOptimistic.mock.calls[0]![0]).toMatchObject({ text: "hola", expanded: false, quotedId: "q1", attachments: [] });
    // Cleared before the server answered.
    expect(editor.isEmpty).toBe(true);
    expect(postMessageAction).not.toHaveBeenCalled();
    expect(onPosted).not.toHaveBeenCalled();

    // Without slowmode the next message goes right away, even while the first is in flight.
    type(editor, "<p>otra</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSendOptimistic).toHaveBeenCalledTimes(2));
    expect(onSendOptimistic.mock.calls[1]![0]).toMatchObject({ text: "otra" });
    await act(async () => finish({}));
  });

  it("with slowmode, one send at a time: Enter while one is in flight keeps the draft", async () => {
    let finish: (v: object) => void = () => {};
    const onSendOptimistic = vi.fn<(m: OutgoingMessage) => Promise<object>>(() => new Promise<object>((r) => (finish = r)));
    const { box, editor } = await mount({ onSendOptimistic, slowmodeSeconds: 5 });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSendOptimistic).toHaveBeenCalledTimes(1));
    type(editor, "<p>otra</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSendOptimistic).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("otra");
    await act(async () => finish({}));
  });

  it("a slowmode refusal starts the countdown (the failed message itself is shown by the list)", async () => {
    const onSendOptimistic = vi.fn(async () => ({ error: "slowmode", slowmodeSeconds: 12 }));
    const { box, editor } = await mount({ onSendOptimistic, slowmodeSeconds: 30 });
    type(editor, "<p>hola</p>");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Puedes escribir de nuevo en 12s")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("passes the uploaded images with their local previews, which it no longer owns", async () => {
    uploadChatImage.mockResolvedValue({ path: "p", mime: "image/webp", size: 5, width: 3, height: 2 });
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: revoke }));
    const onSendOptimistic = vi.fn<(m: OutgoingMessage) => Promise<object>>(async () => ({}));
    const { box } = await mount({ onSendOptimistic });
    fireEvent.paste(box, { clipboardData: { files: [new File([new Uint8Array(4)], "a.png", { type: "image/png" })], items: [], getData: () => "" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar mensaje" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(onSendOptimistic).toHaveBeenCalled());
    expect(onSendOptimistic.mock.calls[0]![0]).toMatchObject({
      attachments: [{ previewUrl: "blob:x", mime: "image/webp", width: 3, height: 2, uploaded: { path: "p", mime: "image/webp", size: 5, width: 3, height: 2 } }],
    });
    expect(screen.queryByRole("button", { name: "Quitar a.png" })).not.toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
