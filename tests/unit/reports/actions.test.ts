import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const schedule = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: schedule }));

import { reportMessageAction, resolveReportAction } from "@/lib/reports/actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset();
  schedule.mockReset();
});

describe("reportMessageAction", () => {
  it("rejects bad input without calling the rpc", async () => {
    expect(await reportMessageAction("nope", "spam", null)).toEqual({ error: "invalid_input" });
    expect(await reportMessageAction(ID, "other-reason", null)).toEqual({ error: "invalid_input" });
    expect(await reportMessageAction(ID, "spam", "x".repeat(501))).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("sends the trimmed note (null when empty) and schedules the push dispatch", async () => {
    rpc.mockResolvedValue({ data: "report-id", error: null });
    expect(await reportMessageAction(ID, "scam", "  parece una estafa  ")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("report_message", { p_message: ID, p_reason: "scam", p_note: "parece una estafa" });
    expect(schedule).toHaveBeenCalledTimes(1);
    await reportMessageAction(ID, "spam", "   ");
    expect(rpc).toHaveBeenLastCalledWith("report_message", { p_message: ID, p_reason: "spam", p_note: null });
  });

  it("maps already_reported and rate_limited and does not schedule on error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "already_reported" } });
    expect(await reportMessageAction(ID, "spam", null)).toEqual({ error: "already_reported" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "rate_limited" } });
    expect(await reportMessageAction(ID, "spam", null)).toEqual({ error: "rate_limited" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("resolveReportAction", () => {
  it("rejects bad input", async () => {
    expect(await resolveReportAction("nope", "dismissed")).toEqual({ error: "invalid_input" });
    expect(await resolveReportAction(ID, "open" as never)).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("resolves and schedules the push dispatch", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await resolveReportAction(ID, "actioned")).toEqual({});
    expect(rpc).toHaveBeenCalledWith("resolve_report", { p_report: ID, p_status: "actioned" });
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("maps errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await resolveReportAction(ID, "dismissed")).toEqual({ error: "forbidden" });
    expect(schedule).not.toHaveBeenCalled();
  });
});
