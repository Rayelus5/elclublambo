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
vi.mock("@/components/chat/bounty-dialog", () => ({ BountyDialog: () => null }));
vi.mock("@/components/chat/poll-dialog", () => ({
  PollDialog: (props: { open: boolean; channelId: string; initialQuestion: string; onPosted: (id: string) => void; onSlowmode?: (s: number) => void }) => (
    <div data-testid="poll-stub" data-open={String(props.open)} data-channel={props.channelId} data-text={props.initialQuestion}>
      <button type="button" onClick={() => props.onPosted("m-poll")}>
        stub-posted
      </button>
      <button type="button" onClick={() => props.onSlowmode?.(30)}>
        stub-slowmode
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

describe("Composer + /encuesta", () => {
  it("does not mount the poll dialog without canPoll, nor offer the command", async () => {
    const { editor } = await mount();
    expect(screen.queryByTestId("poll-stub")).not.toBeInTheDocument();
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("/");
    });
    // Another command still shows (so the popup rendered); /encuesta must not be among them.
    act(() => {
      editor.commands.insertContent("i");
    });
    expect(await screen.findByText("/imagen")).toBeInTheDocument();
    expect(screen.queryByText("/encuesta")).not.toBeInTheDocument();
  });

  it("offers /encuesta when canPoll and opens the dialog with the draft text as the question", async () => {
    const { box, editor } = await mount({ canPoll: true });
    expect(screen.getByTestId("poll-stub")).toHaveAttribute("data-open", "false");
    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("¿Cenamos? /enc");
    });
    expect(await screen.findByText("/encuesta")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("poll-stub")).toHaveAttribute("data-open", "true"));
    expect(screen.getByTestId("poll-stub")).toHaveAttribute("data-channel", CH);
    expect(screen.getByTestId("poll-stub").getAttribute("data-text")).toContain("¿Cenamos?");
  });

  it("reports the new message and forwards slowmode", async () => {
    const onPosted = vi.fn();
    await mount({ canPoll: true, onPosted, slowmodeSeconds: 60 });
    await userEvent.click(screen.getByRole("button", { name: "stub-posted" }));
    expect(onPosted).toHaveBeenCalledWith("m-poll");
    await userEvent.click(screen.getByRole("button", { name: "stub-slowmode" }));
    expect(await screen.findByText("Puedes escribir de nuevo en 30s")).toBeInTheDocument();
  });
});
