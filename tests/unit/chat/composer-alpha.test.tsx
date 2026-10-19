import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// How the composer reacts to the Alpha dialog's outcomes. The dialog itself is covered in alpha-dialog.test.tsx;
// here it is replaced by a stub that exposes its callbacks.
vi.mock("@/lib/polls/actions", () => ({ createPollAction: vi.fn(), votePollAction: vi.fn() }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/chat/actions", () => ({
  postMessageAction: vi.fn(),
  getSlowmodeAction: vi.fn(async () => ({ seconds: 0 })),
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
vi.mock("@/components/chat/alpha-dialog", () => ({
  AlphaDialog: (props: { onPosted: (id: string) => void; onSlowmode?: (s: number) => void }) => (
    <div>
      <button type="button" onClick={() => props.onPosted("m-alpha")}>
        stub-posted
      </button>
      <button type="button" onClick={() => props.onSlowmode?.(30)}>
        stub-slowmode
      </button>
    </div>
  ),
}));
const uploadChatImage = vi.fn();
vi.mock("@/lib/chat/upload", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/upload")>()), uploadChatImage: (...a: unknown[]) => uploadChatImage(...a) }));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({ rpc: async () => ({ data: "44444444-4444-4444-8444-444444444444", error: null }) }),
}));

import { Composer } from "@/components/chat/composer";

const CH = "11111111-1111-4111-8111-111111111111";
const base = { channelId: CH, canPost: true, canAttach: true, canMentionEveryone: false, slowmodeSeconds: 60, canAlpha: true };

beforeEach(() => {
  uploadChatImage.mockReset();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Composer + Alpha dialog", () => {
  it("starts the slowmode countdown when the Alpha post hits slowmode", async () => {
    render(<Composer {...base} />);
    await screen.findByRole("textbox", { name: "Mensaje" });
    await userEvent.click(screen.getByRole("button", { name: "stub-slowmode" }));
    expect(await screen.findByText("Puedes escribir de nuevo en 30s")).toBeInTheDocument();
  });

  it("clears pending attachments and the quote after a successful Alpha post", async () => {
    uploadChatImage.mockResolvedValue({ path: "p", mime: "image/webp", size: 5, width: 1, height: 1 });
    const onRemoveQuoted = vi.fn();
    const onPosted = vi.fn();
    render(
      <Composer {...base} quoted={{ id: "55555555-5555-4555-8555-555555555555", authorName: "Ana" }} onRemoveQuoted={onRemoveQuoted} onPosted={onPosted} />,
    );
    const box = await screen.findByRole("textbox", { name: "Mensaje" });
    fireEvent.paste(box, { clipboardData: { files: [new File([new Uint8Array(4)], "a.png", { type: "image/png" })], items: [], getData: () => "" } });
    expect(await screen.findByRole("button", { name: "Quitar a.png" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "stub-posted" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quitar a.png" })).not.toBeInTheDocument());
    expect(onRemoveQuoted).toHaveBeenCalled();
    expect(onPosted).toHaveBeenCalledWith("m-alpha");
  });
});
