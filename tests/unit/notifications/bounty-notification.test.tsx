import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications, type NotificationView } from "@/lib/notifications/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOUNTY = "11111111-1111-4111-8111-111111111111";
const REPLY = "22222222-2222-4222-8222-222222222222";

const view = (over: Partial<NotificationView>): NotificationView => ({
  id: 1,
  kind: "bounty_solution",
  createdAt: "2026-10-18T10:00:00Z",
  readAt: null,
  actor: { name: "@ana", wallet: "0xabc" },
  channelName: "ayuda",
  excerpt: null,
  ticketSubject: null,
  ticketStatus: null,
  href: "/foro/c/x",
  ...over,
});
const text = (v: NotificationView) => render(<NotificationItem notification={v} />).container.querySelector("a")!.textContent;

describe("bounty notification copy", () => {
  it("bounty_solution names the author who chose the answer", () => {
    expect(text(view({}))).toContain("@ana ha elegido tu respuesta como solución del bounty");
  });
  it("bounty_paid names the payer", () => {
    expect(text(view({ kind: "bounty_paid" }))).toContain("@ana te ha pagado el bounty");
  });
});

describe("bounty notification links", () => {
  const row = (kind: string, data: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    id: 5,
    kind,
    created_at: "2026-10-18T10:00:00Z",
    read_at: null,
    channel_id: CH,
    ticket_id: null,
    message_id: null,
    data,
    actor: null,
    channel: { name: "ayuda" },
    message: { body_text: "texto del mensaje", deleted_at: null },
    ticket: null,
    ...over,
  });
  const run = async (r: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: [r], error: null });
    return (await listNotifications({ filter: "all" }, { from: () => builder } as never))[0]!;
  };

  it("bounty_solution jumps to the chosen reply inside the bounty thread", async () => {
    const n = await run(row("bounty_solution", { bountyId: BOUNTY, threadRootId: BOUNTY }, { message_id: REPLY }));
    expect(n.href).toBe(`/foro/c/${CH}?m=${REPLY}&thread=${BOUNTY}`);
  });

  it("bounty_paid jumps to the paid solution inside the bounty thread", async () => {
    const n = await run(row("bounty_paid", { bountyId: BOUNTY, messageId: REPLY, threadRootId: BOUNTY }));
    expect(n.href).toBe(`/foro/c/${CH}?m=${REPLY}&thread=${BOUNTY}`);
  });

  it("falls back to the bounty message itself, then the channel", async () => {
    expect((await run(row("bounty_paid", { bountyId: BOUNTY }))).href).toBe(`/foro/c/${CH}?m=${BOUNTY}`);
    expect((await run(row("bounty_solution", { bountyId: "nope" }))).href).toBe(`/foro/c/${CH}`);
  });

  it("never copies message text into the notice", async () => {
    expect((await run(row("bounty_paid", { bountyId: BOUNTY }))).excerpt).toBeNull();
    expect((await run(row("bounty_solution", { bountyId: BOUNTY }, { message_id: REPLY }))).excerpt).toBeNull();
  });
});
