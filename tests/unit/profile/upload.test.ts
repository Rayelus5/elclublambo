import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc, storage: { from: () => ({ upload }) } }) }));

import { AvatarError, uploadAvatar } from "@/lib/profile/upload";

const ME = "44444444-4444-4444-8444-444444444444";
const file = (type: string, size = 10) => new File([new Uint8Array(size)], "a", { type });

beforeEach(() => {
  upload.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ data: ME, error: null });
});

describe("uploadAvatar", () => {
  it.each([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]])("names %s objects .%s under the member folder", async (type, ext) => {
    const path = await uploadAvatar(file(type));
    expect(path).toMatch(new RegExp(`^${ME}/[0-9a-f-]{36}\\.${ext}$`));
    expect(upload).toHaveBeenCalledWith(path, expect.any(File), expect.objectContaining({ upsert: false, contentType: type }));
  });

  it("rejects other types and oversized files before uploading", async () => {
    await expect(uploadAvatar(file("image/gif"))).rejects.toBeInstanceOf(AvatarError);
    await expect(uploadAvatar(file("image/png", 2097153))).rejects.toBeInstanceOf(AvatarError);
    expect(upload).not.toHaveBeenCalled();
  });

  it("accepts exactly 2 MB", async () => {
    await expect(uploadAvatar(file("image/png", 2097152))).resolves.toBeTruthy();
  });
});
