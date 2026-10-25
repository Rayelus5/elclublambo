import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications } from "@/lib/notifications/queries";

const ID = "11111111-1111-4111-8111-111111111111";

async function view(kind: string, data: Record<string, unknown> | null) {
  const row = {
    id: 9, kind, created_at: "2026-10-19T10:00:00Z", read_at: null, channel_id: null, ticket_id: null,
    message_id: null, data, actor: null, channel: null, message: null, ticket: null,
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [row], error: null });
  const [n] = await listNotifications({ filter: "all" }, { from: () => builder } as never);
  return n!;
}
const text = (n: Awaited<ReturnType<typeof view>>) => render(<NotificationItem notification={n} />).container.querySelector("a")!.textContent;

describe("raffle_won", () => {
  it("names the raffle and the prize, and links to the raffle page", async () => {
    const n = await view("raffle_won", { raffleId: ID, title: "Gran sorteo", token: "USDC", amount: "10000000" });
    expect(text(n)).toContain("Has ganado el sorteo «Gran sorteo»: 10 USDC");
    expect(n.href).toBe(`/foro/dao/sorteos/${ID}`);
  });

  it("formats a WETH prize", async () => {
    const n = await view("raffle_won", { raffleId: ID, title: "X", token: "WETH", amount: "10000000000000000" });
    expect(text(n)).toContain("Has ganado el sorteo «X»: 0,01 WETH");
  });

  it("falls back on malformed data and links to the section", async () => {
    const n = await view("raffle_won", { raffleId: "nope", title: 5, token: "DOGE", amount: "x" });
    expect(text(n)).toContain("Has ganado un sorteo");
    expect(n.href).toBe("/foro/dao#sorteos");
    expect(text(await view("raffle_won", null))).toContain("Has ganado un sorteo");
  });

  it("never renders the title as markup", async () => {
    const n = await view("raffle_won", { raffleId: ID, title: "<b>x</b>", token: "USDC", amount: "1000000" });
    expect(render(<NotificationItem notification={n} />).container.querySelector("b")).toBeNull();
  });
});

describe("treasury_notice raffle events", () => {
  it("raffle_drawn asks to pay the prize", async () => {
    const n = await view("treasury_notice", { event: "raffle_drawn", raffleId: ID });
    expect(text(n)).toContain("Un sorteo tiene ganador: paga el premio");
    expect(n.href).toBe("/foro/dao/tesoreria#sorteos");
  });

  it("raffle_unpaid warns of a prize 14 days unpaid", async () => {
    const n = await view("treasury_notice", { event: "raffle_unpaid", raffleId: ID });
    expect(text(n)).toContain("Un premio de sorteo lleva 14 días sin pagarse");
    expect(n.href).toBe("/foro/dao/tesoreria#sorteos");
  });

  it("the withdrawal events keep their plain link", async () => {
    expect((await view("treasury_notice", { event: "withdrawal_requested" })).href).toBe("/foro/dao/tesoreria");
  });
});
