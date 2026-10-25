import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications } from "@/lib/notifications/queries";

const ID = "11111111-1111-4111-8111-111111111111";

async function view(data: Record<string, unknown> | null) {
  const row = {
    id: 9, kind: "giveaway_won", created_at: "2026-10-24T10:00:00Z", read_at: null, channel_id: null, ticket_id: null,
    message_id: null, data, actor: null, channel: null, message: null, ticket: null,
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [row], error: null });
  const [n] = await listNotifications({ filter: "all" }, { from: () => builder } as never);
  return n!;
}
const text = (n: Awaited<ReturnType<typeof view>>) => render(<NotificationItem notification={n} />).container.querySelector("a")!.textContent;

describe("giveaway_won", () => {
  it("names the prize and the giveaway, and links to /sorteos/<id>", async () => {
    const n = await view({ giveawayId: ID, title: "Sorteo de otoño", prizeLabel: "Camiseta" });
    expect(text(n)).toContain("Has ganado «Camiseta» en «Sorteo de otoño»");
    expect(n.href).toBe(`/foro/sorteos/${ID}`);
  });

  it("falls back on malformed data and links to /sorteos", async () => {
    const n = await view({ giveawayId: "nope", title: 5, prizeLabel: null });
    expect(text(n)).toContain("Has ganado un sorteo");
    expect(n.href).toBe("/foro/sorteos");
    expect(text(await view(null))).toContain("Has ganado un sorteo");
  });

  it("never renders the labels as markup", async () => {
    const n = await view({ giveawayId: ID, title: "<b>x</b>", prizeLabel: "<i>y</i>" });
    const { container } = render(<NotificationItem notification={n} />);
    expect(container.querySelector("b, i")).toBeNull();
  });
});
