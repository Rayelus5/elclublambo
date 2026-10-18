import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/actions", () => ({ searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })) }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn(async () => ({})) }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("@/lib/payments/queries", async (orig) => ({ ...(await orig<typeof import("@/lib/payments/queries")>()), getMessageTips: vi.fn(async () => []) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));

import { MessageItem } from "@/components/chat/message-item";
import { SystemNotice } from "@/components/chat/system-notice";
import { directory, doc, makeMessage, viewer } from "./fixtures";

const HASH = `0x${"ef".repeat(32)}`;
const TEXT = "@ana ha enviado 12,5 USDC a @bob por este mensaje";
const notice = (over = {}) =>
  makeMessage({ kind: "system", authorId: null, body: doc(TEXT), tipId: "t1", tipLink: { chainId: 59141, txHash: HASH }, ...over });

describe("SystemNotice", () => {
  it("shows El Club, the text and the explorer link", () => {
    render(<SystemNotice message={notice()} />);
    expect(screen.getByText("El Club")).toBeInTheDocument();
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver transacción/i })).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
  });

  it("has no link when the transaction is unknown", () => {
    render(<SystemNotice message={notice({ tipLink: null })} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("MessageItem with a system notice", () => {
  const setup = (over = {}) =>
    render(
      <ol>
        <MessageItem message={notice(over)} directory={directory} allowedDomains={[]} viewer={viewer({ canManage: true })} onEdit={vi.fn()} onDelete={vi.fn()} onPin={vi.fn()} />
      </ol>,
    );

  it("renders the notice with no author and only 'Copiar enlace' in the menu", async () => {
    setup();
    expect(screen.getByText("El Club")).toBeInTheDocument();
    expect(screen.queryByText("Miembro")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Acciones del mensaje" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Copiar enlace"]);
  });

  it("never shows a badge on a notice", () => {
    setup({ tips: [{ token: "USDC", total: 1n, count: 1 }] });
    expect(screen.queryByText(/Recompensado/)).toBeNull();
  });
});

describe("MessageItem tip badge", () => {
  it("shows the badge under a tipped message", () => {
    const m = makeMessage({ tips: [{ token: "USDC", total: 12_500_000n, count: 1 }] });
    render(
      <ol>
        <MessageItem message={m} directory={directory} allowedDomains={[]} viewer={viewer()} />
      </ol>,
    );
    expect(screen.getByText(/Recompensado · 12,5 USDC/)).toBeInTheDocument();
  });
});
