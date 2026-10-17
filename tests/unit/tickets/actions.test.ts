import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const schedule = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: schedule }));

import { openTicketAction, postTicketMessageAction, setTicketStatusAction } from "@/lib/tickets/actions";

const CH = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset();
  schedule.mockReset();
});

describe("openTicketAction", () => {
  it("rejects a bad channel, subject or body without calling the rpc", async () => {
    expect(await openTicketAction("nope", "Asunto", "cuerpo")).toEqual({ error: "invalid_input" });
    expect(await openTicketAction(CH, "ab", "cuerpo")).toEqual({ error: "invalid_input" });
    expect(await openTicketAction(CH, "Asunto", "   ")).toEqual({ error: "invalid_input" });
    expect(await openTicketAction(CH, "Asunto", "a".repeat(4001))).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("sends trimmed text, returns the id and schedules the push dispatch", async () => {
    rpc.mockResolvedValue({ data: T, error: null });
    expect(await openTicketAction(CH, "  Mi problema ", "  hola \n que tal ")).toEqual({ id: T });
    expect(rpc).toHaveBeenCalledWith("open_ticket", { p_channel: CH, p_subject: "Mi problema", p_body: "hola \n que tal" });
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("maps too_many_open_tickets and does not schedule on error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "too_many_open_tickets" } });
    expect(await openTicketAction(CH, "Asunto", "cuerpo")).toEqual({ error: "too_many_open_tickets" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("postTicketMessageAction", () => {
  it("validates, posts, returns the message id and schedules the push dispatch", async () => {
    expect(await postTicketMessageAction("nope", "hola")).toEqual({ error: "invalid_input" });
    expect(await postTicketMessageAction(T, "  ")).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: "m1", error: null });
    expect(await postTicketMessageAction(T, " hola ")).toEqual({ id: "m1" });
    expect(rpc).toHaveBeenCalledWith("post_ticket_message", { p_ticket: T, p_body: "hola" });
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("maps ticket_closed without scheduling", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "ticket_closed" } });
    expect(await postTicketMessageAction(T, "hola")).toEqual({ error: "ticket_closed" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("setTicketStatusAction", () => {
  it("validates the id and the status", async () => {
    expect(await setTicketStatusAction("nope", "closed")).toEqual({ error: "invalid_input" });
    expect(await setTicketStatusAction(T, "pending" as never)).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("changes the status and schedules the push dispatch", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await setTicketStatusAction(T, "closed")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("set_ticket_status", { p_ticket: T, p_status: "closed" });
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("surfaces forbidden (an author reopening) without scheduling", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await setTicketStatusAction(T, "open")).toEqual({ error: "forbidden" });
    expect(schedule).not.toHaveBeenCalled();
  });
});
