import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications } from "@/lib/notifications/queries";

async function view(kind: string, data: Record<string, unknown> | null) {
  const row = {
    id: 7, kind, created_at: "2026-10-18T10:00:00Z", read_at: null, channel_id: null, ticket_id: null,
    message_id: null, data, actor: null, channel: null, message: null, ticket: null,
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [row], error: null });
  const [n] = await listNotifications({ filter: "all" }, { from: () => builder } as never);
  return n!;
}

const text = (n: Awaited<ReturnType<typeof view>>) => render(<NotificationItem notification={n} />).container.querySelector("a")!.textContent;

describe("withdrawal notifications", () => {
  it("withdrawal_approved", async () => {
    const n = await view("withdrawal_approved", { requestId: "r", amount: "8000000" });
    expect(text(n)).toContain("Tu retirada de 8 USDC está aprobada");
    expect(n.href).toBe("/dao#retirada");
  });

  it("withdrawal_rejected carries the reason", async () => {
    const n = await view("withdrawal_rejected", { requestId: "r", reason: "Sin fondos" });
    expect(text(n)).toContain("Tu retirada fue rechazada: Sin fondos");
    expect(n.href).toBe("/dao#retirada");
  });

  it("withdrawal_paid names the amount transferred", async () => {
    const n = await view("withdrawal_paid", { requestId: "r", amount: "8500000" });
    expect(text(n)).toContain("Has recibido 8,5 USDC de la tesorería");
    expect(n.href).toBe("/dao#retirada");
  });

  it("withdrawal_expired", async () => {
    const n = await view("withdrawal_expired", { requestId: "r" });
    expect(text(n)).toContain("Tu aprobación de retirada caducó: vuelve a estar pendiente");
    expect(n.href).toBe("/dao#retirada");
  });

  it("treasury_notice reads by event and links to the panel", async () => {
    const a = await view("treasury_notice", { event: "withdrawal_requested", requestId: "r" });
    expect(text(a)).toContain("Nueva solicitud de retirada");
    expect(a.href).toBe("/dao/tesoreria");
    const b = await view("treasury_notice", { event: "approval_expired", requestId: "r" });
    expect(text(b)).toContain("Una retirada aprobada caducó sin pagarse");
    expect(b.href).toBe("/dao/tesoreria");
  });

  it("treasury_outflow now links to the panel (ruling F4a-R1)", async () => {
    const n = await view("treasury_outflow", { opId: "o", asset: "USDC", amount: "250000000" });
    expect(n.href).toBe("/dao/tesoreria");
  });

  it("falls back to copy without the amount when the payload is malformed", async () => {
    expect(text(await view("withdrawal_approved", { amount: "abc" }))).toContain("Tu retirada está aprobada");
    expect(text(await view("withdrawal_approved", null))).toContain("Tu retirada está aprobada");
    expect(text(await view("withdrawal_paid", { amount: 5 }))).toContain("Has recibido el pago de tu retirada");
    expect(text(await view("withdrawal_rejected", { reason: 5 }))).toContain("Tu retirada fue rechazada");
    expect(text(await view("withdrawal_rejected", { reason: 5 }))).not.toContain("rechazada:");
    expect(text(await view("treasury_notice", { event: "x" }))).toContain("Aviso de la tesorería");
  });

  it("never renders a reason as markup", async () => {
    const n = await view("withdrawal_rejected", { reason: "<b>x</b>" });
    const { container } = render(<NotificationItem notification={n} />);
    expect(container.querySelector("b")).toBeNull();
  });
});
