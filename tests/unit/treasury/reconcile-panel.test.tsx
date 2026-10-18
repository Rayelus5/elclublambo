import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileNowAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/actions", () => ({ reconcileNowAction, setRankingVisibleAction: vi.fn() }));

import { ReconcilePanel } from "@/components/treasury/reconcile-panel";
import { Perm } from "@/lib/permissions/bits";

const run = (diff: string) => ({
  ranAt: "2026-10-18T10:00:00Z",
  ledgerValue: "10000000",
  pendingValue: "0",
  onchainBalance: String(10_000_000n + BigInt(diff)),
  diff,
});

beforeEach(() => vi.clearAllMocks());

describe("ReconcilePanel", () => {
  it("renders nothing without MANAGE_TREASURY (bit 256)", () => {
    const { container } = render(<ReconcilePanel perms={255n} last={run("0")} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders for bit 256", () => {
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={run("0")} />);
    expect(screen.getByRole("button", { name: "Reconciliar ahora" })).toBeInTheDocument();
    expect(screen.getByText("La Safe y el registro coinciden.")).toBeInTheDocument();
  });
  it("explains a positive diff", () => {
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={run("2500000")} />);
    expect(screen.getByText("Hay fondos en la Safe que no están en el registro (transferencias directas)")).toBeInTheDocument();
  });
  it("explains a negative diff", () => {
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={run("-2500000")} />);
    expect(screen.getByText("La Safe tiene menos de lo registrado")).toBeInTheDocument();
  });
  it("says there is no run yet", () => {
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={null} />);
    expect(screen.getByText("Todavía no se ha reconciliado.")).toBeInTheDocument();
  });
  it("runs the reconciliation and shows the new result", async () => {
    reconcileNowAction.mockResolvedValue({
      ok: true,
      result: { chainId: 59141, ledgerValue: "10000000", pendingValue: "0", onchainBalance: "9000000", diff: "-1000000", rawDiff: "-1000000", id: "r1" },
    });
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Reconciliar ahora" }));
    expect(await screen.findByText("La Safe tiene menos de lo registrado")).toBeInTheDocument();
  });
  it("shows the error when it fails", async () => {
    reconcileNowAction.mockResolvedValue({ ok: false, code: "safe_not_configured", error: "La tesorería aún no tiene Safe configurada en esta red." });
    render(<ReconcilePanel perms={Perm.MANAGE_TREASURY} last={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Reconciliar ahora" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La tesorería aún no tiene Safe configurada en esta red.");
  });
});
