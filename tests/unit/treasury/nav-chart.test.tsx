import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserClient: () => ({ rpc: h.rpc }),
}));

import { NavChart } from "@/components/treasury/nav-chart";

const rows = [
  { taken_at: "2026-10-17T10:00:00Z", nav_usd6: "100000000", share_price_usd6: "1000000" },
  { taken_at: "2026-10-18T10:00:00Z", nav_usd6: "125500000", share_price_usd6: "1255000" },
];

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: rows, error: null });
});

describe("NavChart", () => {
  it("loads the last 7 days of the fund value by default and summarises it for screen readers", async () => {
    render(<NavChart />);
    expect(h.rpc).toHaveBeenCalledWith("dao_nav_history", { p_range: "7d" });
    expect(await screen.findByRole("img", { name: /Valor del fondo: de 100 USDC a 125,5 USDC/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the range when a tab is clicked", async () => {
    render(<NavChart />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "30 días" }));
    await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith("dao_nav_history", { p_range: "30d" }));
    expect(screen.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
    for (const [label, range] of [["24 h", "24h"], ["Todo", "all"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(h.rpc).toHaveBeenLastCalledWith("dao_nav_history", { p_range: range }));
    }
  });

  it("switches the series to the value per participación without refetching", async () => {
    render(<NavChart />);
    await screen.findByRole("img");
    const calls = h.rpc.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Valor por participación" }));
    expect(screen.getByRole("img", { name: /Valor por participación: de 1 USDC a 1,255 USDC/ })).toBeInTheDocument();
    expect(h.rpc.mock.calls.length).toBe(calls);
  });

  it("shows an empty state before the first valuation", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    render(<NavChart />);
    expect(await screen.findByText("El gráfico aparecerá con la primera valoración.")).toBeInTheDocument();
  });

  it("shows an error when the history cannot be read", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<NavChart />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el gráfico.");
  });

  it("reloads when a new valuation lands", async () => {
    const { rerender } = render(<NavChart navAt="2026-10-18T10:00:00Z" />);
    await screen.findByRole("img");
    const calls = h.rpc.mock.calls.length;
    rerender(<NavChart navAt="2026-10-18T11:00:00Z" />);
    await waitFor(() => expect(h.rpc.mock.calls.length).toBe(calls + 1));
  });
});
