import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc: h.rpc }) }));

import { OperationsList } from "@/components/treasury/operations-list";
import type { Operation } from "@/lib/treasury/queries";

const HASH = `0x${"cd".repeat(32)}`;
const out: Operation = {
  id: "11111111-1111-4111-8111-111111111111",
  asset: "USDC",
  direction: "out",
  amount: 250_000_000n,
  txHash: HASH,
  occurredAt: "2026-10-18T10:00:00Z",
  note: null,
  explained: false,
};
const noted: Operation = {
  id: "22222222-2222-4222-8222-222222222222",
  asset: "WETH",
  direction: "in",
  amount: 10n ** 17n,
  txHash: null,
  occurredAt: "2026-10-18T10:00:00Z",
  note: "Swap de 250 USDC a WETH",
  explained: true,
};

beforeEach(() => {
  h.rpc.mockReset();
  h.refresh.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
});

describe("OperationsList", () => {
  it("shows a member each operation: asset, direction, amount, note or «Sin explicar», explorer link — and no editor", () => {
    render(<OperationsList operations={[out, noted]} chainId={59141} canNote={false} />);
    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).getByText("250 USDC")).toBeInTheDocument();
    expect(within(first!).getByText("Salida")).toBeInTheDocument();
    expect(within(first!).getByText("Sin explicar")).toBeInTheDocument();
    expect(within(first!).getByRole("link", { name: /Ver en el explorador/ })).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
    expect(within(second!).getByText("0,1 WETH")).toBeInTheDocument();
    expect(within(second!).getByText("Entrada")).toBeInTheDocument();
    expect(within(second!).getByText("Swap de 250 USDC a WETH")).toBeInTheDocument();
    // A null hash (every inflow, for members) renders without an explorer link.
    expect(within(second!).queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /nota/i })).toBeNull();
  });

  it("shows an empty state", () => {
    render(<OperationsList operations={[]} chainId={59141} canNote={false} />);
    expect(screen.getByText("Aún no hay operaciones de la Safe registradas.")).toBeInTheDocument();
  });

  it("lets a treasurer add a note: Save stays disabled while empty, then saves the trimmed text and shows it", async () => {
    render(<OperationsList operations={[out]} chainId={59141} canNote />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir nota" }));
    const box = screen.getByRole("textbox", { name: "Nota de la operación" });
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(box, { target: { value: "  Pago del hosting  " } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("set_operation_note", { p_op: out.id, p_note: "Pago del hosting" }));
    expect(await screen.findByText("Pago del hosting")).toBeInTheDocument();
    expect(screen.queryByText("Sin explicar")).toBeNull();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("keeps the editor open with the error when the note is rejected", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    render(<OperationsList operations={[out]} chainId={59141} canNote />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir nota" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nota de la operación" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Nota de la operación" })).toBeInTheDocument();
    expect(screen.getByText("Sin explicar")).toBeInTheDocument();
  });

  it("lets a treasurer edit an existing note", () => {
    render(<OperationsList operations={[noted]} chainId={59141} canNote />);
    fireEvent.click(screen.getByRole("button", { name: "Editar nota" }));
    expect(screen.getByRole("textbox", { name: "Nota de la operación" })).toHaveValue("Swap de 250 USDC a WETH");
  });
});
