import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
const getVouchesFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vouches/queries", () => ({ getVouchesFor }));

import { ProfileVouches } from "@/components/vouches/profile-vouches";
import { getDictionary } from "@/lib/i18n";
import type { VouchesSummary } from "@/lib/vouches/types";

const es = getDictionary("es");
const en = getDictionary("en");
const TO = "0x3333333333333333333333333333333333333333";
const BY = "0x1111111111111111111111111111111111111111";
const UID = `0x${"ab".repeat(32)}`;
const summary: VouchesSummary = {
  total: 2,
  counts: [
    { kind: 2, attesters: 2 },
    { kind: 3, attesters: 1 },
  ],
  items: [{ uid: UID, chainId: 84532, kind: 2, attester: BY, attesterAlias: "ana", attestedAt: "2026-10-20T10:00:00Z", txHash: `0x${"c".repeat(64)}` }],
};

beforeEach(() => {
  getVouchesFor.mockReset();
  connection.mockClear();
});

describe("ProfileVouches (/pay/<x>)", () => {
  it("reads after connection() and shows the counts per kind and the list with easscan links", async () => {
    getVouchesFor.mockResolvedValue(summary);
    render(await ProfileVouches({ lang: "es", address: TO }));
    expect(connection).toHaveBeenCalled();
    expect(getVouchesFor).toHaveBeenCalledWith(TO);
    const section = screen.getByRole("region", { name: es.pay.page.vouchesTitle });
    const counts = within(section).getByRole("list", { name: es.vouches.summary.countsLabel });
    expect(within(counts).getByText("Hemos trabajado juntos · 2")).toBeInTheDocument();
    expect(within(counts).getByText("Trato fiable (pagos o intercambios) · 1")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "@ana" })).toHaveAttribute("href", "/pay/ana");
    expect(within(section).getByRole("link", { name: /Ver en EAS Scan/ })).toHaveAttribute(
      "href",
      `https://base-sepolia.easscan.org/attestation/view/${UID}`,
    );
    expect(within(section).getByText(es.vouches.notice)).toBeInTheDocument();
  });

  it("«Avalar esta dirección» is an outline link to the tool with ?address=, and the section has no brand fill", async () => {
    getVouchesFor.mockResolvedValue(summary);
    const { container } = render(await ProfileVouches({ lang: "es", address: TO }));
    const cta = screen.getByRole("link", { name: "Avalar esta dirección" });
    expect(cta).toHaveAttribute("href", `/herramientas/avales?address=${TO}`);
    expect(cta).toHaveAttribute("data-variant", "outline");
    expect(container.querySelector(".bg-accent-fill")).toBeNull();
  });

  it("empty: the empty text and still the CTA (English URL in English)", async () => {
    getVouchesFor.mockResolvedValue({ total: 0, counts: [], items: [] });
    render(await ProfileVouches({ lang: "en", address: TO }));
    expect(screen.getByText(en.vouches.summary.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.pay.page.vouchesCta })).toHaveAttribute("href", `/en/tools/vouches?address=${TO}`);
  });

  it("a read that throws shows «No se pudieron cargar los avales» instead of throwing", async () => {
    getVouchesFor.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await ProfileVouches({ lang: "es", address: TO }));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los avales");
    expect(screen.getByRole("link", { name: "Avalar esta dirección" })).toBeInTheDocument();
  });
});
