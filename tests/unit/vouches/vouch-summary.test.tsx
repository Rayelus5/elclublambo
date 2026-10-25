import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/vouches/refresh-button", () => ({ RefreshButton: (p: { uid: string }) => <button type="button" data-testid={`refresh-${p.uid}`} /> }));

import { VouchSummary } from "@/components/vouches/vouch-summary";
import { getDictionary } from "@/lib/i18n";
import type { VouchesSummary } from "@/lib/vouches/types";

const es = getDictionary("es").vouches;
const en = getDictionary("en").vouches;
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const UID1 = `0x${"a1".repeat(32)}`;
const UID2 = `0x${"b2".repeat(32)}`;

const summary: VouchesSummary = {
  total: 3,
  counts: [
    { kind: 1, attesters: 2 },
    { kind: 9, attesters: 1 },
  ],
  items: [
    { uid: UID1, chainId: 84532, kind: 1, attester: A1, attesterAlias: "rayelus", attestedAt: "2026-10-20T10:00:00Z", txHash: `0x${"c".repeat(64)}` },
    { uid: UID2, chainId: 84532, kind: 9, attester: A2, attesterAlias: null, attestedAt: "2026-10-21T10:00:00Z", txHash: `0x${"d".repeat(64)}` },
  ],
};

describe("VouchSummary", () => {
  it("counts distinct attesters per kind; an unknown kind shows as «Otro» (Review Focus 5)", () => {
    render(<VouchSummary lang="es" t={es} summary={summary} />);
    const counts = screen.getByRole("list", { name: es.summary.countsLabel });
    expect(within(counts).getByText("Le conozco en persona · 2")).toBeInTheDocument();
    expect(within(counts).getByText("Otro · 1")).toBeInTheDocument();
  });

  it("an attester with a Pay alias links to /pay/alias; without one, the short address links to the lookup", () => {
    render(<VouchSummary lang="es" t={es} summary={summary} />);
    expect(screen.getByRole("link", { name: "@rayelus" })).toHaveAttribute("href", "/pay/rayelus");
    expect(screen.getByRole("link", { name: "0x2222…2222" })).toHaveAttribute("href", `/herramientas/avales?address=${A2}`);
  });

  it("every row links to its attestation on easscan, and nothing says «Miembro» (D15)", () => {
    render(<VouchSummary lang="es" t={es} summary={summary} />);
    const links = screen.getAllByRole("link", { name: new RegExp(es.summary.viewOnEasscan) });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `https://base-sepolia.easscan.org/attestation/view/${UID1}`,
      `https://base-sepolia.easscan.org/attestation/view/${UID2}`,
    ]);
    expect(document.body.textContent).not.toMatch(/miembro|member/i);
  });

  it("the refresh button per uid only when asked for", () => {
    const { unmount } = render(<VouchSummary lang="es" t={es} summary={summary} />);
    expect(screen.queryByTestId(`refresh-${UID1}`)).not.toBeInTheDocument();
    unmount();
    render(<VouchSummary lang="es" t={es} summary={summary} refresh />);
    expect(screen.getByTestId(`refresh-${UID1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`refresh-${UID2}`)).toBeInTheDocument();
  });

  it("compact shows the counts without the list", () => {
    render(<VouchSummary lang="en" t={en} summary={summary} compact />);
    expect(screen.getByText("I know them in person · 2")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "@rayelus" })).not.toBeInTheDocument();
  });

  it("empty shows the empty text", () => {
    render(<VouchSummary lang="es" t={es} summary={{ total: 0, counts: [], items: [] }} />);
    expect(screen.getByText(es.summary.empty)).toBeInTheDocument();
    expect(es.summary.empty).toBe("Esta dirección aún no tiene avales.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
