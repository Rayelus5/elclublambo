import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DonorList } from "@/components/donations/donor-list";

const rows = [
  { memberId: "a", label: "@ana", totalUsd6: 1_250_500_000n, isMe: false },
  { memberId: "b", label: "@beto", totalUsd6: 5_000_000n, isMe: true },
];

describe("DonorList", () => {
  it("ranks donors with their total in USD and marks the viewer's row with «Tú»", () => {
    render(<DonorList rows={rows} />);
    const items = within(screen.getByRole("list", { name: "Lista de donantes" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("@ana");
    expect(items[0]).toHaveTextContent("1.250,5 USD");
    expect(within(items[0]!).queryByText("Tú")).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent("@beto");
    expect(within(items[1]!).getByText("Tú")).toBeInTheDocument();
  });

  it("external donors: no profile link, label as given, distinct keys for identical labels", () => {
    const ext = [
      { memberId: null, label: "Donante externo · 0x12…ab", totalUsd6: 9_000_000n, isMe: false },
      { memberId: null, label: "Donante externo · 0x12…ab", totalUsd6: 3_000_000n, isMe: false },
    ];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DonorList rows={ext} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Donante externo · 0x12…ab");
    expect(screen.queryByRole("link")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("empty: says nobody is listed yet", () => {
    render(<DonorList rows={[]} />);
    expect(screen.getByText("Todavía no hay donantes en la lista.")).toBeInTheDocument();
  });
});
