import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const schedulePushDispatch = vi.fn();
vi.mock("@/lib/push/schedule", () => ({ schedulePushDispatch: () => schedulePushDispatch() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { finalizeDuePolls } from "@/lib/polls/cron";

beforeEach(() => vi.clearAllMocks());

describe("finalizeDuePolls", () => {
  it("calls close_due_polls with the admin client and schedules push when something was finalized", async () => {
    rpc.mockResolvedValue({ data: { finalized: 2 }, error: null });
    expect(await finalizeDuePolls()).toEqual({ finalized: 2 });
    expect(rpc).toHaveBeenCalledWith("close_due_polls");
    expect(schedulePushDispatch).toHaveBeenCalledTimes(1);
  });

  it("does not schedule push when nothing was finalized", async () => {
    rpc.mockResolvedValue({ data: { finalized: 0 }, error: null });
    expect(await finalizeDuePolls()).toEqual({ finalized: 0 });
    expect(schedulePushDispatch).not.toHaveBeenCalled();
  });

  it("throws on an RPC error and on a malformed payload (the route reports failed)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(finalizeDuePolls()).rejects.toThrow();
    rpc.mockResolvedValue({ data: { finalized: "x" }, error: null });
    await expect(finalizeDuePolls()).rejects.toThrow();
    expect(schedulePushDispatch).not.toHaveBeenCalled();
  });
});
