import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMessageTips = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/queries", async (orig) => ({ ...(await orig<typeof import("@/lib/payments/queries")>()), getMessageTips }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({}) }));

import { TipsBadge } from "@/components/payments/tips-badge";
import type { TipEntry } from "@/lib/payments/queries";

const HASH = `0x${"cd".repeat(32)}`;
const entry = (over: Partial<TipEntry> = {}): TipEntry => ({
  tipId: "t1",
  donorName: "Dona",
  isMe: false,
  anonymous: false,
  token: "USDC",
  amount: 12_500_000n,
  chainId: 59141,
  txHash: HASH,
  createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  ...over,
});

beforeEach(() => {
  getMessageTips.mockReset();
});

describe("TipsBadge", () => {
  it("shows the totals with USDC before ETH, comma decimals and no trailing zeros", () => {
    render(
      <TipsBadge
        messageId="m1"
        totals={[
          { token: "ETH", total: 1_000_000_000_000_000n, count: 1 },
          { token: "USDC", total: 12_500_000n, count: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("Recompensado · 12,5 USDC · 0,001 ETH");
  });

  it("renders nothing without totals", () => {
    const { container } = render(<TipsBadge messageId="m1" totals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a donor list: name, amount, relative time and explorer link", async () => {
    getMessageTips.mockResolvedValue([entry()]);
    render(<TipsBadge messageId="m1" totals={[{ token: "USDC", total: 12_500_000n, count: 1 }]} />);
    await userEvent.click(screen.getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Dona")).toBeInTheDocument());
    expect(within(dialog).getByText("12,5 USDC")).toBeInTheDocument();
    expect(within(dialog).getByText(/hace 3 minutos/)).toBeInTheDocument();
    const link = within(dialog).getByRole("link", { name: /ver transacción/i });
    expect(link).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
    expect(getMessageTips).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("labels anonymous donors and the viewer's own anonymous tip", async () => {
    getMessageTips.mockResolvedValue([
      entry({ tipId: "a", donorName: null, anonymous: true }),
      entry({ tipId: "b", donorName: "Yo", isMe: true, anonymous: true }),
    ]);
    render(<TipsBadge messageId="m1" totals={[{ token: "USDC", total: 25_000_000n, count: 2 }]} />);
    await userEvent.click(screen.getByRole("button"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText("Anónimo")).toBeInTheDocument());
    expect(within(dialog).getByText("Tú (anónimo)")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yo")).toBeNull();
    expect(dialog.textContent).toMatch(/blockchain/i);
  });

  it("says so when the list cannot be loaded", async () => {
    getMessageTips.mockImplementation(async () => {
      throw new Error("x");
    });
    render(<TipsBadge messageId="m1" totals={[{ token: "USDC", total: 1_000_000n, count: 1 }]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument();
  });
});
