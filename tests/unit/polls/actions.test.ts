import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const schedulePushDispatch = vi.fn();
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: () => schedulePushDispatch() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { createPollAction, votePollAction } from "@/lib/polls/actions";

const CH = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const O = "33333333-3333-4333-8333-333333333333";

const closesAt = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const input = (over: Record<string, unknown> = {}) => ({
  channelId: CH,
  question: "  ¿Comemos\n  fuera? ",
  options: ["Sí", "No"],
  closesAt: closesAt(),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("createPollAction", () => {
  it("calls create_poll with the normalized question, the options and an ISO close (no weight mode), then schedules push", async () => {
    rpc.mockResolvedValue({ data: P, error: null });
    const at = closesAt();
    const r = await createPollAction(input({ closesAt: at }) as never);
    expect(r).toEqual({ ok: true, messageId: P });
    expect(rpc).toHaveBeenCalledWith("create_poll", {
      p_channel: CH,
      p_question: "¿Comemos fuera?",
      p_options: ["Sí", "No"],
      p_closes_at: new Date(at).toISOString(),
    });
    expect(schedulePushDispatch).toHaveBeenCalled();
  });

  it.each([
    ["empty question", { question: "  " }, "question_required"],
    ["one option", { options: ["Sí"] }, "poll_options_invalid"],
    ["duplicate options", { options: ["Sí", "sí"] }, "poll_options_invalid"],
    ["close too soon", { closesAt: new Date(Date.now() + 60_000).toISOString() }, "closes_at_invalid"],
    ["unparsable close", { closesAt: "nope" }, "closes_at_invalid"],
    ["bad channel", { channelId: "x" }, "invalid_input"],
    ["options not an array", { options: "Sí,No" }, "invalid_input"],
  ])("rejects %s with %s and no RPC call", async (_n, over, code) => {
    const r = await createPollAction(input(over) as never);
    expect(r).toMatchObject({ ok: false, code });
    expect(rpc).not.toHaveBeenCalled();
    expect(schedulePushDispatch).not.toHaveBeenCalled();
  });

  it("carries slowmodeSeconds from the error detail", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "slowmode", details: "12" } });
    expect(await createPollAction(input() as never)).toMatchObject({ ok: false, code: "slowmode", slowmodeSeconds: 12 });
  });

  it.each([
    ["forbidden", "No tienes permiso"],
    ["question_required", "Escribe la pregunta"],
    ["poll_options_invalid", "de 2 a 10 opciones"],
  ])("maps %s to Spanish copy", async (code, copy) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });
    const r = await createPollAction(input() as never);
    expect(r).toMatchObject({ ok: false, code });
    expect((r as { error: string }).error).toContain(copy);
  });

  it("fails with unknown when the RPC returns nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await createPollAction(input() as never)).toMatchObject({ ok: false, code: "unknown" });
  });
});

describe("votePollAction", () => {
  it("returns the status and the voter count", async () => {
    rpc.mockResolvedValue({ data: { status: "cast", voterCount: 4 }, error: null });
    expect(await votePollAction(P, O)).toEqual({ ok: true, status: "cast", voterCount: 4 });
    expect(rpc).toHaveBeenCalledWith("cast_poll_vote", { p_poll: P, p_option: O });
    expect(schedulePushDispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["x", O],
    [P, "y"],
  ])("rejects non-uuid input (%s, %s) with invalid_input and no RPC call", async (p, o) => {
    expect(await votePollAction(p, o)).toMatchObject({ ok: false, code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps poll_closed to its copy", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "poll_closed" } });
    expect(await votePollAction(P, O)).toMatchObject({ ok: false, code: "poll_closed", error: "La encuesta ya está cerrada." });
  });

  it("rejects an unexpected RPC payload", async () => {
    rpc.mockResolvedValue({ data: { status: "weird", voterCount: 1 }, error: null });
    expect(await votePollAction(P, O)).toMatchObject({ ok: false, code: "unknown" });
  });
});
