import { describe, expect, it, vi } from "vitest";
import { getOnline } from "@/lib/members/card";

describe("getOnline", () => {
  it("maps the cheap presence refresh and skips the call for an empty list", async () => {
    const rpc = vi.fn(async () => ({ data: [{ member_id: "a", online: true }, { member_id: "b", online: false }], error: null }));
    const map = await getOnline({ rpc } as never, ["a", "b"]);
    expect(rpc).toHaveBeenCalledWith("members_online", { p_members: ["a", "b"] });
    expect(map.get("a")).toBe(true);
    expect(map.get("b")).toBe(false);
    rpc.mockClear();
    expect((await getOnline({ rpc } as never, [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
