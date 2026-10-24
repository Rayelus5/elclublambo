import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bounties/actions", () => ({ createBountyAction: vi.fn(), createBountyPaymentIntentAction: vi.fn(), cancelBountyAction: vi.fn(), markSolutionAction: vi.fn() }));
vi.mock("@/lib/polls/actions", () => ({ votePollAction: vi.fn(), createPollAction: vi.fn() }));
vi.mock("@/lib/reports/actions", () => ({ reportMessageAction: vi.fn() }));
vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));
vi.mock("@/lib/chat/actions", () => ({
  searchMentionTargetsAction: vi.fn(async () => ({ members: [], roles: [] })),
}));

import { AlphaCard } from "@/components/chat/alpha-card";
import { MessageItem } from "@/components/chat/message-item";
import { directory, makeMessage, viewer } from "./fixtures";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ cb: IOCallback; disconnect: ReturnType<typeof vi.fn> }> = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      disconnect = vi.fn();
      constructor(cb: IOCallback) {
        observers.push({ cb, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const reveal = () => act(() => observers.forEach((o) => o.cb([{ isIntersecting: true }])));

describe("AlphaCard", () => {
  it("shows the chip, the address in mono, the explorer link and the third-party notice", () => {
    render(<AlphaCard address={ADDR} chainId={84532} />);
    expect(screen.getByText("Alpha · Tesis")).toBeInTheDocument();
    expect(screen.getByText(ADDR)).toHaveClass("font-mono");
    const link = screen.getByRole("link", { name: /Ver en el explorador/i });
    expect(link).toHaveAttribute("href", `https://sepolia.basescan.org/address/${ADDR}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText("Contenido de terceros. Investiga antes de invertir.")).toBeVisible();
  });

  it("mounts the DexScreener iframe only after the card scrolls into view", () => {
    const { container } = render(<AlphaCard address={ADDR} chainId={84532} />);
    expect(container.querySelector("iframe")).toBeNull();
    reveal();
    const frame = container.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toBe(`https://dexscreener.com/base/${ADDR}?embed=1&theme=dark&trades=0&info=0`);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-popups");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.getAttribute("title")).toBe("Gráfico de 0x1234…5678 en DexScreener");
    expect(frame.getAttribute("height")).toBe("360");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("Arbitrum: arbiscan link and the arbitrum DexScreener chart", () => {
    const { container } = render(<AlphaCard address={ADDR} chainId={42161} />);
    expect(screen.getByRole("link", { name: /Ver en el explorador/i })).toHaveAttribute("href", `https://arbiscan.io/address/${ADDR}`);
    reveal();
    expect(container.querySelector("iframe")!.getAttribute("src")).toBe(
      `https://dexscreener.com/arbitrum/${ADDR}?embed=1&theme=dark&trades=0&info=0`,
    );
  });

  it("names the network on the card", () => {
    render(<AlphaCard address={ADDR} chainId={42161} />);
    expect(screen.getByText("Arbitrum")).toBeInTheDocument();
  });

  it("a legacy row on a network that is gone shows only the address and the copy button", () => {
    const { container } = render(<AlphaCard address={ADDR} chainId={59144} />);
    reveal();
    expect(screen.getByText(ADDR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar dirección" })).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("Alpha · Tesis")).toBeInTheDocument();
  });

  it("copies the address and confirms it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<AlphaCard address={ADDR} chainId={84532} />);
    await user.click(screen.getByRole("button", { name: "Copiar dirección" }));
    expect(writeText).toHaveBeenCalledWith(ADDR);
    expect(await screen.findByText("Copiada")).toBeInTheDocument();
  });

  it("falls back to mounting right away without IntersectionObserver", () => {
    vi.unstubAllGlobals();
    // jsdom has none
    const { container } = render(<AlphaCard address={ADDR} chainId={84532} />);
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("never builds URLs from an invalid address", () => {
    const { container } = render(<AlphaCard address={'0x"><script>'} chainId={84532} />);
    reveal();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("MessageItem with an alpha message", () => {
  it("renders the card above the thesis", () => {
    const m = makeMessage({ kind: "alpha", alpha: { address: ADDR, chainId: 84532 } });
    render(
      <ol>
        <MessageItem message={m} directory={directory} allowedDomains={[]} viewer={viewer()} />
      </ol>,
    );
    const chip = screen.getByText("Alpha · Tesis");
    const thesis = screen.getByText(/mensaje \d+/);
    expect(chip.compareDocumentPosition(thesis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a plain message has no card", () => {
    render(
      <ol>
        <MessageItem message={makeMessage()} directory={directory} allowedDomains={[]} viewer={viewer()} />
      </ol>,
    );
    expect(screen.queryByText("Alpha · Tesis")).toBeNull();
  });
});
