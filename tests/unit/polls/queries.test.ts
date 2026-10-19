import { describe, expect, it, vi } from "vitest";
import { getPollDetails } from "@/lib/polls/queries";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  message_id: id,
  weight_mode: "equal",
  closes_at: "2026-10-20T10:00:00+00:00",
  closed: false,
  voter_count: 1,
  options: [
    { id: A, label: "Sí", position: 1 },
    { id: B, label: "No", position: 2 },
  ],
  my_option_id: null,
  i_voted: false,
  my_has_weight: null,
  results_status: "pending",
  results: null,
  ...over,
});

describe("getPollDetails", () => {
  it("makes no RPC call for an empty list", async () => {
    const rpc = vi.fn();
    expect((await getPollDetails({ rpc } as never, [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keys the map by message_id and skips malformed rows", async () => {
    const rpc = vi.fn(async () => ({ data: [row(M1), row(M2, { weight_mode: "cubic" })], error: null }));
    const out = await getPollDetails({ rpc } as never, [M1, M2]);
    expect(rpc).toHaveBeenCalledWith("poll_details", { p_message_ids: [M1, M2] });
    expect([...out.keys()]).toEqual([M1]);
    expect(out.get(M1)?.options.map((o) => o.label)).toEqual(["Sí", "No"]);
  });

  it("gives an empty map on an RPC error, on a non-array and on a throw", async () => {
    expect((await getPollDetails({ rpc: async () => ({ data: null, error: { message: "x" } }) } as never, [M1])).size).toBe(0);
    expect((await getPollDetails({ rpc: async () => ({ data: {}, error: null }) } as never, [M1])).size).toBe(0);
    expect(
      (
        await getPollDetails(
          {
            rpc: async () => {
              throw new Error("boom");
            },
          } as never,
          [M1],
        )
      ).size,
    ).toBe(0);
  });
});
