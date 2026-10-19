import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null as unknown })));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));
vi.mock("@/lib/chat/actions", () => ({ searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })) }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));

import { ChatDensityProvider, DensityToggle } from "@/components/chat/density";
import { MessageItem } from "@/components/chat/message-item";
import { directory, makeMessage, viewer } from "./fixtures";

beforeEach(() => rpc.mockClear());

function Chat({ initial }: { initial: "standard" | "compact" }) {
  return (
    <ChatDensityProvider initial={initial}>
      <DensityToggle />
      <ol>
        <MessageItem message={makeMessage()} directory={directory} allowedDomains={[]} viewer={viewer()} />
      </ol>
    </ChatDensityProvider>
  );
}

describe("chat density", () => {
  it("compact keeps the avatar, only smaller, and saves the preference", async () => {
    render(<Chat initial="standard" />);
    const avatar = () => document.querySelector("li img") as HTMLImageElement;
    expect(avatar().getAttribute("width")).toBe("32");
    await userEvent.click(screen.getByRole("radio", { name: "Compacto" }));
    expect(screen.getByRole("radio", { name: "Compacto" })).toHaveAttribute("aria-checked", "true");
    expect(avatar().getAttribute("width")).toBe("24");
    expect(rpc).toHaveBeenCalledWith("set_chat_density", { p_density: "compact" });
  });

  it("reverts when the preference cannot be saved", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    render(<Chat initial="standard" />);
    await userEvent.click(screen.getByRole("radio", { name: "Compacto" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Estándar" })).toHaveAttribute("aria-checked", "true"));
  });

  it("an author's name takes their role colour when readable, the default colour when too dark", () => {
    const withColor = (nameColor: string) => {
      const dir = { ...directory, members: Object.fromEntries(Object.entries(directory.members).map(([k, v]) => [k, { ...v, nameColor }])) };
      return render(
        <ol>
          <MessageItem message={makeMessage()} directory={dir} allowedDomains={[]} viewer={viewer()} />
        </ol>,
      );
    };
    const bright = withColor("#61DFFF");
    expect(bright.container.querySelector("span[style*='color']")).not.toBeNull();
    bright.unmount();
    const dark = withColor("#111111");
    expect(dark.container.querySelector("span[style*='color']")).toBeNull();
  });
});
