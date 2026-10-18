import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null as unknown })));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));
vi.mock("@/lib/chat/actions", () => ({ searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })) }));
vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
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
  it("standard shows the avatar; switching to compact hides it, moves the time left and saves the preference", async () => {
    render(<Chat initial="standard" />);
    expect(document.querySelector("li img, li svg[viewBox='0 0 5 5']")).not.toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Compacto" }));
    expect(screen.getByRole("radio", { name: "Compacto" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector("li img, li svg[viewBox='0 0 5 5']")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("set_chat_density", { p_density: "compact" });
  });

  it("reverts when the preference cannot be saved", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    render(<Chat initial="standard" />);
    await userEvent.click(screen.getByRole("radio", { name: "Compacto" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Estándar" })).toHaveAttribute("aria-checked", "true"));
  });
});
