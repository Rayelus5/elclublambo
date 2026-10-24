import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("empty: says nobody is listed yet", () => {
    render(<DonorList rows={[]} />);
    expect(screen.getByText("Todavía no hay donantes en la lista.")).toBeInTheDocument();
  });
});
