import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications } from "@/lib/notifications/queries";

describe("treasury_outflow notification", () => {
  const row = (data: Record<string, unknown>) => ({
    id: 2, kind: "treasury_outflow", created_at: "2026-10-18T10:00:00Z", read_at: null, channel_id: null, ticket_id: null,
    message_id: null, data, actor: null, channel: null, message: null, ticket: null,
  });
  async function list(data: Record<string, unknown>) {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: [row(data)], error: null });
    const [n] = await listNotifications({ filter: "all" }, { from: () => builder } as never);
    return n!;
  }

  it("reads «Salida de la tesorería sin explicar: <amount> <asset>» and links to the treasurer panel (R1)", async () => {
    const n = await list({ opId: "o", asset: "USDC", amount: "250000000" });
    expect(n.href).toBe("/dao/tesoreria");
    const t = render(<NotificationItem notification={n} />).container.querySelector("a")!.textContent;
    expect(t).toContain("Salida de la tesorería sin explicar: 250 USDC");
    expect(t).not.toContain("Alguien");
  });

  it("formats WETH and ETH with 18 decimals", async () => {
    const n = await list({ opId: "o", asset: "WETH", amount: "1500000000000000000" });
    expect(render(<NotificationItem notification={n} />).container.textContent).toContain("Salida de la tesorería sin explicar: 1,5 WETH");
  });

  it("falls back to a generic sentence when the payload is malformed", async () => {
    const n = await list({ asset: "DOGE", amount: "x" });
    expect(render(<NotificationItem notification={n} />).container.textContent).toContain("Salida de la tesorería sin explicar");
  });
});
