import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VouchesReceived } from "@/components/profile/vouches-received";
import type { VouchesSummary } from "@/lib/vouches/types";

const ADDR = "0x3333333333333333333333333333333333333333";
const summary: VouchesSummary = {
  total: 2,
  counts: [
    { kind: 1, attesters: 1 },
    { kind: 2, attesters: 2 },
  ],
  items: [],
};

describe("VouchesReceived (forum profile)", () => {
  it("shows the distinct attesters, the counts per kind and links to the public tool", () => {
    render(<VouchesReceived address={ADDR} summary={summary} />);
    expect(screen.getByRole("heading", { level: 2, name: "Avales recibidos" })).toBeInTheDocument();
    expect(screen.getByText("2 avales")).toBeInTheDocument();
    expect(screen.getByText("Le conozco en persona · 1")).toBeInTheDocument();
    expect(screen.getByText("Hemos trabajado juntos · 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ver avales/ })).toHaveAttribute("href", `/herramientas/avales?address=${ADDR}`);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("one attester reads «1 aval»", () => {
    render(<VouchesReceived address={ADDR} summary={{ total: 1, counts: [{ kind: 3, attesters: 1 }], items: [] }} />);
    expect(screen.getByText("1 aval")).toBeInTheDocument();
  });

  it("renders nothing when total = 0", () => {
    const { container } = render(<VouchesReceived address={ADDR} summary={{ total: 0, counts: [], items: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
