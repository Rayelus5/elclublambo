import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
const getGasSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gas/read", () => ({ getGasSnapshot }));

import { GasContent } from "@/components/gas/gas-content";
import { getDictionary } from "@/lib/i18n";
import type { GasSnapshot } from "@/lib/gas/read";

const es = getDictionary("es");
const en = getDictionary("en");
const GWEI = 1_000_000_000n;

const rows = (price: bigint, withL1: boolean) =>
  (
    [
      ["ethTransfer", 21_000n],
      ["erc20Transfer", 65_000n],
      ["swap", 180_000n],
      ["nftMint", 120_000n],
    ] as const
  ).map(([action, gas]) => {
    const l2 = gas * price;
    const l1 = withL1 ? 5_000_000_000_000n : null;
    return { action, l2Wei: String(l2), l1Wei: l1 === null ? null : String(l1), totalWei: String(l2 + (l1 ?? 0n)) };
  });

function snapshot(over: Partial<GasSnapshot> = {}): GasSnapshot {
  return {
    networks: [
      { status: "ok", chainId: 84532, baseFeeWei: String(GWEI), priorityWei: String(GWEI / 10n), rows: rows(1_100_000_000n, true), l1Status: "ok" },
      { status: "ok", chainId: 421614, baseFeeWei: String(GWEI / 100n), priorityWei: "0", rows: rows(GWEI / 100n, false), l1Status: "unavailable" },
    ],
    ethereum: { l1BaseFeeWei: String(3n * GWEI), rows: rows(3n * GWEI, false).map(({ action, totalWei }) => ({ action, totalWei })) },
    ethUsdE8: "200000000000",
    readAt: "2026-10-25T10:20:30.000Z",
    ...over,
  };
}

/** The page with its streamed part stubbed: a client render cannot run the async GasContent inside <Suspense>. */
async function renderPage(lang: "es" | "en") {
  vi.resetModules();
  vi.doMock("@/components/gas/gas-content", () => ({ GasContent: () => <div data-testid="gas-content" /> }));
  const { default: GasPage } = await import("@/app/(public)/[lang]/tools/gas/page");
  return render(await GasPage({ params: Promise.resolve({ lang }) } as never));
}

/** Every string in a dictionary subtree. */
function strings(tree: unknown): string[] {
  if (typeof tree === "string") return [tree];
  return Object.values(tree as Record<string, unknown>).flatMap(strings);
}

beforeEach(() => {
  vi.clearAllMocks();
  getGasSnapshot.mockResolvedValue(snapshot());
});

describe("gas page header", () => {
  it("title, the approximate-estimates notice and noCustody, without a brand fill", async () => {
    const { container } = await renderPage("es");
    expect(screen.getByRole("heading", { level: 1, name: es.gas.title })).toBeInTheDocument();
    expect(screen.getByText(es.gas.notice)).toBeInTheDocument();
    expect(es.gas.notice).toBe("Estimaciones aproximadas; el coste real depende de la transacción.");
    expect(screen.getByText(es.common.noCustody)).toBeInTheDocument();
    expect(container.querySelector(".bg-accent-fill")).toBeNull();
  });
});

describe("GasContent", () => {
  it("reads after connection() and shows each network's costs labelled approximate", async () => {
    const { container } = render(await GasContent({ lang: "es" }));
    expect(connection).toHaveBeenCalled();
    expect(getGasSnapshot).toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 2, name: "Base Sepolia" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("heading", { level: 2, name: "Arbitrum Sepolia" }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/aprox\./).length).toBeGreaterThan(0);
    // ETH transfer on Base: 21000 × 1.1 gwei + 5000 gwei of L1 = 28100 gwei = 0.0000281 ETH ≈ 0.06 USD.
    expect(screen.getAllByText("28100").length).toBeGreaterThan(0);
    // Spanish uses a decimal comma (as Multisend and Approvals do).
    expect(screen.getAllByText("0,0000281").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0,06").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("0.0000281")).toHaveLength(0);
    expect(screen.getByText(/Precio del gas: 1,1 gwei \(base 1 \+ propina 0,1\)/)).toBeInTheDocument();
    // Arbitrum's L1 part could not be read: marked.
    expect(screen.getAllByText(es.gas.noL1).length).toBeGreaterThan(0);
    expect(screen.getByText(es.gas.ethereumTitle)).toBeInTheDocument();
    expect(screen.getByText(/10:20:30/)).toBeInTheDocument();
    expect(container.querySelector(".bg-accent-fill")).toBeNull();
  });

  it("a network that could not be read (Review Focus 5): «—» with the reason, and the other still shows", async () => {
    getGasSnapshot.mockResolvedValue(
      snapshot({
        networks: [snapshot().networks[0]!, { status: "unavailable", chainId: 421614 }],
      }),
    );
    render(await GasContent({ lang: "es" }));
    const arb = screen.getByRole("region", { name: "Arbitrum Sepolia" });
    expect(within(arb).getByText("—")).toBeInTheDocument();
    expect(within(arb).getByText(es.gas.networkUnavailable)).toBeInTheDocument();
    const base = screen.getByRole("region", { name: "Base Sepolia" });
    expect(within(base).getAllByText("28100").length).toBeGreaterThan(0);
  });

  it("no ETH price: USD shows «—» with the reason and the converter's USD field is disabled", async () => {
    getGasSnapshot.mockResolvedValue(snapshot({ ethUsdE8: null }));
    render(await GasContent({ lang: "es" }));
    expect(screen.getAllByText(es.gas.noPrice).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(es.gas.converter.usd)).toBeDisabled();
    expect(screen.getByLabelText(es.gas.converter.eth)).toBeEnabled();
  });

  it("no Ethereum reference: its reason instead", async () => {
    getGasSnapshot.mockResolvedValue(snapshot({ ethereum: null }));
    render(await GasContent({ lang: "es" }));
    expect(screen.getByText(es.gas.ethereumUnavailable)).toBeInTheDocument();
  });

  it("English has no Spanish strings", async () => {
    getGasSnapshot.mockResolvedValue(snapshot({ ethUsdE8: null, ethereum: null, networks: [snapshot().networks[0]!, { status: "unavailable", chainId: 421614 }] }));
    const { container } = render(await GasContent({ lang: "en" }));
    const header = (await renderPage("en")).container;
    const text = (container.textContent ?? "") + (header.textContent ?? "");
    const enStrings = new Set(strings(en.gas));
    for (const s of strings(es.gas).filter((x) => !enStrings.has(x) && x.length > 3)) {
      const fixed = s.split(/\{\w+\}/)[0]!.trim();
      if (fixed.length > 3) expect(text, s).not.toContain(fixed);
    }
    expect(text).toContain(en.gas.networkUnavailable);
    expect(text).toContain(en.common.noCustody);
  });

  it("English keeps the decimal point", async () => {
    render(await GasContent({ lang: "en" }));
    expect(screen.getAllByText("0.0000281").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.06").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("0,0000281")).toHaveLength(0);
    expect(screen.getByText(en.gas.converter.price.replace("{usd}", "2000.00"))).toBeInTheDocument();
  });
});

describe("UnitConverter", () => {
  it("Spanish shows the converted amounts and the price with a decimal comma, and still reads either separator", async () => {
    const user = userEvent.setup();
    render(await GasContent({ lang: "es" }));
    const c = es.gas.converter;
    expect(screen.getByText(c.price.replace("{usd}", "2000,00"))).toBeInTheDocument();
    await user.type(screen.getByLabelText(c.gwei), "1,5");
    expect(screen.getByLabelText(c.eth)).toHaveValue("0,0000000015");
    expect(screen.getByLabelText(c.wei)).toHaveValue("1500000000");
    await user.clear(screen.getByLabelText(c.eth));
    await user.type(screen.getByLabelText(c.eth), "0.5");
    expect(screen.getByLabelText(c.usd)).toHaveValue("1000,00");
    expect(screen.getByLabelText(c.gwei)).toHaveValue("500000000");
  });

  it("English shows the converted amounts with a decimal point", async () => {
    const user = userEvent.setup();
    render(await GasContent({ lang: "en" }));
    const c = en.gas.converter;
    await user.type(screen.getByLabelText(c.gwei), "1.5");
    expect(screen.getByLabelText(c.eth)).toHaveValue("0.0000000015");
  });

  it("every field has its live region in the DOM from the start (empty), filled when the entry is invalid", async () => {
    const user = userEvent.setup();
    render(await GasContent({ lang: "es" }));
    const c = es.gas.converter;
    const gwei = screen.getByLabelText(c.gwei);
    const live = document.getElementById(`${gwei.id}-hint`);
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    await user.type(gwei, "abc");
    expect(document.getElementById(`${gwei.id}-hint`)).toBe(live);
    expect(live).toHaveTextContent(c.invalid);
    expect(gwei).toHaveAttribute("aria-describedby", live!.id);
  });

  it("the invalid copy accepts 0 and does not talk about wei on every field; gas.approx is gone", () => {
    expect(es.gas.converter.invalid).toBe("Escribe un número (0 o más) con los decimales que admite esta unidad.");
    expect(en.gas.converter.invalid).toBe("Type a number (0 or more) with no more decimals than this unit allows.");
    expect("approx" in es.gas).toBe(false);
    expect("approx" in en.gas).toBe(false);
  });
});
