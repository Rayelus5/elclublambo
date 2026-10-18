import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationItem } from "@/components/notifications/notification-item";
import { listNotifications, type NotificationView } from "@/lib/notifications/queries";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MSG = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";

const view = (over: Partial<NotificationView>): NotificationView => ({
  id: 1,
  kind: "tip_received",
  createdAt: "2026-10-18T10:00:00Z",
  readAt: null,
  actor: { name: "@ana", wallet: "0xabc" },
  channelName: "trading",
  excerpt: null,
  ticketSubject: null,
  ticketStatus: null,
  href: "/c/x",
  ...over,
});
const text = (v: NotificationView) => render(<NotificationItem notification={v} />).container.querySelector("a")!.textContent;

describe("tip_received copy", () => {
  it("names the donor", () => expect(text(view({}))).toContain("@ana te ha enviado una propina"));
  it("is anonymous without an actor", () => {
    const t = text(view({ actor: null }));
    expect(t).toContain("Has recibido una propina anónima");
    expect(t).not.toContain("Alguien");
  });
});

describe("tip_received link", () => {
  const row = (data: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    id: 5,
    kind: "tip_received",
    created_at: "2026-10-18T10:00:00Z",
    read_at: null,
    channel_id: CH,
    ticket_id: null,
    data,
    actor: null,
    channel: { name: "trading" },
    message: { body_text: "x ha enviado 1 USDC", deleted_at: null },
    ticket: null,
    ...over,
  });
  const run = async (r: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in", "or"]) builder[m] = () => builder;
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: [r], error: null });
    return (await listNotifications({ filter: "all" }, { from: () => builder } as never))[0]!;
  };

  it("targets the tipped message, with its thread when it is a reply", async () => {
    expect((await run(row({ messageId: MSG, threadRootId: ROOT }))).href).toBe(`/c/${CH}?m=${MSG}&thread=${ROOT}`);
    expect((await run(row({ messageId: MSG, threadRootId: MSG }))).href).toBe(`/c/${CH}?m=${MSG}`);
  });

  it("never shows the notice text as an excerpt", async () => {
    expect((await run(row({ messageId: MSG }))).excerpt).toBeNull();
  });

  it("ignores malformed ids and falls back to the channel or the list", async () => {
    expect((await run(row({ messageId: "nope" }))).href).toBe(`/c/${CH}`);
    expect((await run(row({}, { channel_id: null }))).href).toBe("/notifications");
  });
});
