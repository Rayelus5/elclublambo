import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/actions", () => ({
  postMessageAction: vi.fn(),
  getSlowmodeAction: vi.fn(async () => ({ seconds: 0 })),
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));
vi.mock("@/components/chat/alpha-dialog", () => ({ AlphaDialog: () => null }));
vi.mock("@/components/chat/bounty-dialog", () => ({
  BountyDialog: (props: { open: boolean; channelId: string; initialText: string; onPosted: (id: string) => void }) => (
    <div data-testid="bounty-stub" data-open={String(props.open)} data-channel={props.channelId} data-text={props.initialText}>
      <button type="button" onClick={() => props.onPosted("m-bounty")}>
        stub-posted
      </button>
    </div>
  ),
}));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: async () => ({ data: null, error: null }) }) }));

import { Composer } from "@/components/chat/composer";

const CH = "11111111-1111-4111-8111-111111111111";
const base = { channelId: CH, canPost: true, canAttach: true, canMentionEveryone: false, slowmodeSeconds: 0 };

async function mount(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const utils = render(<Composer {...base} {...props} />);
  const box = await screen.findByRole("textbox", { name: "Mensaje" });
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  return { ...utils, box, editor };
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
});

describe("Composer + /bounty", () => {
  it("does not mount the bounty dialog without canBounty, nor offer the command", async () => {
    const { editor } = await mount();
    expect(screen.queryByTestId("bounty-stub")).not.toBeInTheDocument();
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("/bou");
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("/bounty")).not.toBeInTheDocument();
  });

  it("offers /bounty when canBounty and opens the dialog with the draft text", async () => {
    const { box, editor } = await mount({ canBounty: true });
    expect(screen.getByTestId("bounty-stub")).toHaveAttribute("data-open", "false");
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("/bou");
    });
    expect(await screen.findByText("/bounty")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("bounty-stub")).toHaveAttribute("data-open", "true"));
    expect(screen.getByTestId("bounty-stub")).toHaveAttribute("data-channel", CH);
  });

  it("reports the new message once the bounty is posted", async () => {
    const onPosted = vi.fn();
    await mount({ canBounty: true, onPosted });
    await userEvent.click(screen.getByRole("button", { name: "stub-posted" }));
    expect(onPosted).toHaveBeenCalledWith("m-bounty");
  });
});
