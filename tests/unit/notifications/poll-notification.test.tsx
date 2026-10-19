import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications } from "@/lib/notifications/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MSG = "11111111-1111-4111-8111-111111111111";

async function view(over: Record<string, unknown> = {}) {
  const row = {
    id: 9, kind: "poll_closed", created_at: "2026-10-19T10:00:00Z", read_at: null, channel_id: CH, ticket_id: null,
    message_id: MSG, data: {}, actor: null, channel: { name: "general" },
    message: { body_text: "¿Comemos   fuera?", deleted_at: null }, ticket: null, ...over,
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: [row], error: null });
  const [n] = await listNotifications({ filter: "all" }, { from: () => builder } as never);
  return n!;
}

describe("poll_closed", () => {
  it("says the poll closed, in the channel, and jumps to the poll message", async () => {
    const n = await view();
    expect(render(<NotificationItem notification={n} />).container.querySelector("a")!.textContent).toContain(
      "Ha cerrado la encuesta en la que votaste en #general",
    );
    expect(n.href).toBe(`/c/${CH}?m=${MSG}&h=n9`);
  });

  it("uses the question as the excerpt", async () => {
    expect((await view()).excerpt).toBe("¿Comemos fuera?");
  });

  it("has no excerpt when the poll message was deleted, and falls back to the channel without a message", async () => {
    const gone = await view({ message: { body_text: "x", deleted_at: "2026-10-19T09:00:00Z" } });
    expect(gone.excerpt).toBeNull();
    expect((await view({ message_id: null })).href).toBe(`/c/${CH}`);
  });
});
