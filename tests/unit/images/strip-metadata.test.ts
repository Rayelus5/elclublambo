import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageProcessError, reencodeImage } from "@/lib/images/strip-metadata";

const file = (type: string) => new File([new Uint8Array(10)], "x", { type });

function mockCanvas(w = 2000, h = 1000, outType?: string) {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: w, height: h, close: vi.fn() })));
  const drawImage = vi.fn();
  const toBlob = vi.fn((cb: (b: Blob | null) => void, type?: string) => cb(new Blob([new Uint8Array(5)], { type: outType ?? type })));
  const canvases: { width: number; height: number }[] = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return real(tag);
    const c = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob };
    canvases.push(c);
    return c as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return { toBlob, drawImage, canvases };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reencodeImage", () => {
  it("returns GIFs untouched without decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    const gif = file("image/gif");
    expect(await reencodeImage(gif)).toBe(gif);
    expect(decode).not.toHaveBeenCalled();
  });

  it.each([["image/png", undefined], ["image/jpeg", 0.9], ["image/webp", 0.9]])("keeps the mime for %s", async (type, q) => {
    const m = mockCanvas(100, 100);
    const out = await reencodeImage(file(type));
    expect(out.type).toBe(type);
    expect(m.toBlob).toHaveBeenCalledWith(expect.any(Function), type, q);
  });

  it("downscales only above maxSide", async () => {
    const m = mockCanvas(2000, 1000);
    await reencodeImage(file("image/jpeg"), { maxSide: 512 });
    expect(m.canvases[0]).toMatchObject({ width: 512, height: 256 });
    const small = mockCanvas(300, 200);
    await reencodeImage(file("image/jpeg"), { maxSide: 512 });
    expect(small.canvases[0]).toMatchObject({ width: 300, height: 200 });
  });

  it("does not resize without maxSide", async () => {
    const m = mockCanvas(5000, 4000);
    await reencodeImage(file("image/png"));
    expect(m.canvases[0]).toMatchObject({ width: 5000, height: 4000 });
  });

  it("throws when decoding fails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bad"))));
    await expect(reencodeImage(file("image/png"))).rejects.toBeInstanceOf(ImageProcessError);
  });

  it("throws when the browser encodes a different type", async () => {
    mockCanvas(100, 100, "image/png");
    await expect(reencodeImage(file("image/webp"))).rejects.toBeInstanceOf(ImageProcessError);
  });
});
