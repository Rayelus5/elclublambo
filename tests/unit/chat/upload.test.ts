import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImage, uploadChatImage, MAX_IMAGE_BYTES, ImageError } from "@/lib/chat/upload";

type Px = { alpha: boolean };

function file(type: string, bytes = 10, name = "x"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Mocks createImageBitmap + canvas. `outBytes` is the size of the re-encoded blob. */
function mockCanvas(opts: { w?: number; h?: number; px?: Px; outBytes?: number; toBlobNull?: boolean; outType?: string } = {}) {
  const { w = 800, h = 600, px = { alpha: false }, outBytes = 1000, toBlobNull = false, outType } = opts;
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: w, height: h, close })));
  const drawImage = vi.fn();
  const data = new Uint8ClampedArray(4 * 4).fill(255);
  if (px.alpha) data[7] = 0;
  const getImageData = vi.fn(() => ({ data }));
  const toBlob = vi.fn((cb: (b: Blob | null) => void, type?: string) => {
    cb(toBlobNull ? null : new Blob([new Uint8Array(outBytes)], { type: outType ?? type }));
  });
  const canvases: HTMLCanvasElement[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return realCreate(tag);
    const c = { width: 0, height: 0, getContext: () => ({ drawImage, getImageData }), toBlob } as unknown as HTMLCanvasElement;
    canvases.push(c);
    return c;
  }) as typeof document.createElement);
  return { drawImage, getImageData, toBlob, close, canvases };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepareImage", () => {
  it("re-encodes jpeg to webp (drops EXIF) and reports the output size", async () => {
    const m = mockCanvas({ w: 640, h: 480, outBytes: 2048 });
    const r = await prepareImage(file("image/jpeg"));
    expect(r.mime).toBe("image/webp");
    expect(r.blob.size).toBe(2048);
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
    expect(m.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", expect.any(Number));
    expect(m.drawImage).toHaveBeenCalled();
    expect(m.close).toHaveBeenCalled();
  });

  it("keeps png as png when it has transparency", async () => {
    const m = mockCanvas({ px: { alpha: true } });
    const r = await prepareImage(file("image/png"));
    expect(r.mime).toBe("image/png");
    expect(m.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
  });

  it("converts an opaque png to webp", async () => {
    mockCanvas({ px: { alpha: false } });
    expect((await prepareImage(file("image/png"))).mime).toBe("image/webp");
  });

  it("re-encodes webp (strips metadata)", async () => {
    mockCanvas();
    expect((await prepareImage(file("image/webp"))).mime).toBe("image/webp");
  });

  it("downscales images above the max dimension, keeping the aspect ratio", async () => {
    const m = mockCanvas({ w: 8000, h: 4000 });
    const r = await prepareImage(file("image/jpeg"));
    expect(r.width).toBe(4096);
    expect(r.height).toBe(2048);
    expect(m.canvases[0]?.width).toBe(4096);
  });

  it("keeps gifs as-is (canvas would drop the animation) but reads their size", async () => {
    const m = mockCanvas({ w: 100, h: 50 });
    const gif = file("image/gif", 1234);
    const r = await prepareImage(gif);
    expect(r.blob).toBe(gif);
    expect(r.mime).toBe("image/gif");
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
    expect(m.toBlob).not.toHaveBeenCalled();
  });

  it("rejects gifs over 5 MB without decoding", async () => {
    const m = mockCanvas();
    await expect(prepareImage(file("image/gif", MAX_IMAGE_BYTES + 1))).rejects.toMatchObject({ code: "image_too_large" });
    expect(m.toBlob).not.toHaveBeenCalled();
  });

  it("rejects disallowed types", async () => {
    mockCanvas();
    for (const t of ["image/svg+xml", "image/bmp", "text/html", "application/pdf", ""]) {
      await expect(prepareImage(file(t))).rejects.toMatchObject({ code: "image_type" });
    }
  });

  it("rejects when the re-encoded blob is over 5 MB", async () => {
    mockCanvas({ outBytes: MAX_IMAGE_BYTES + 1 });
    await expect(prepareImage(file("image/jpeg"))).rejects.toBeInstanceOf(ImageError);
    await expect(prepareImage(file("image/jpeg"))).rejects.toMatchObject({ code: "image_too_large" });
  });

  it("accepts exactly 5 MB after re-encode", async () => {
    mockCanvas({ outBytes: MAX_IMAGE_BYTES });
    await expect(prepareImage(file("image/jpeg"))).resolves.toBeDefined();
  });

  it("reports an undecodable image", async () => {
    mockCanvas();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("bad"); }));
    await expect(prepareImage(file("image/jpeg"))).rejects.toMatchObject({ code: "image_decode" });
  });

  it("reports the mime the browser really produced (Safari may return png for webp)", async () => {
    mockCanvas({ outType: "image/png" });
    const r = await prepareImage(file("image/jpeg"));
    expect(r.mime).toBe("image/png");
  });

  it("falls back to the requested mime when the blob has no type", async () => {
    mockCanvas({ outType: "" });
    expect((await prepareImage(file("image/jpeg"))).mime).toBe("image/webp");
  });

  it("reports a failed encode", async () => {
    mockCanvas({ toBlobNull: true });
    await expect(prepareImage(file("image/jpeg"))).rejects.toMatchObject({ code: "image_decode" });
  });
});

describe("uploadChatImage", () => {
  const CH = "11111111-1111-4111-8111-111111111111";
  const ME = "22222222-2222-4222-8222-222222222222";
  let upload: ReturnType<typeof vi.fn>;
  let from: ReturnType<typeof vi.fn>;
  let sb: Parameters<typeof uploadChatImage>[0];

  beforeEach(() => {
    upload = vi.fn(async () => ({ data: {}, error: null }));
    from = vi.fn(() => ({ upload }));
    sb = { storage: { from } } as unknown as Parameters<typeof uploadChatImage>[0];
    vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "33333333-3333-4333-8333-333333333333" });
  });

  it("uploads to chat-images at <channel>/<member>/<uuid>.<ext> without upsert", async () => {
    mockCanvas({ w: 10, h: 20, outBytes: 500 });
    const r = await uploadChatImage(sb, CH, ME, file("image/jpeg"));
    expect(from).toHaveBeenCalledWith("chat-images");
    expect(r).toEqual({ path: `${CH}/${ME}/33333333-3333-4333-8333-333333333333.webp`, mime: "image/webp", size: 500, width: 10, height: 20 });
    expect(upload).toHaveBeenCalledWith(r.path, expect.any(Blob), { contentType: "image/webp", upsert: false, cacheControl: "3600" });
  });

  it("uses png and gif extensions", async () => {
    mockCanvas({ px: { alpha: true } });
    expect((await uploadChatImage(sb, CH, ME, file("image/png"))).path.endsWith(".png")).toBe(true);
    expect((await uploadChatImage(sb, CH, ME, file("image/gif"))).path.endsWith(".gif")).toBe(true);
  });

  it("produces a path the database regex accepts", async () => {
    mockCanvas();
    const r = await uploadChatImage(sb, CH, ME, file("image/jpeg"));
    expect(r.path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/);
  });

  it("does not hit storage when the image is rejected", async () => {
    mockCanvas();
    await expect(uploadChatImage(sb, CH, ME, file("image/svg+xml"))).rejects.toMatchObject({ code: "image_type" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("surfaces storage errors as an upload ImageError", async () => {
    mockCanvas();
    upload.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(uploadChatImage(sb, CH, ME, file("image/jpeg"))).rejects.toMatchObject({ code: "image_upload" });
  });

  it("picks the extension from the real mime", async () => {
    mockCanvas({ outType: "image/png" });
    expect((await uploadChatImage(sb, CH, ME, file("image/jpeg"))).path.endsWith(".png")).toBe(true);
    expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Blob), expect.objectContaining({ contentType: "image/png" }));
  });

  it("attaches the storage error as cause", async () => {
    mockCanvas();
    const storageError = { message: "denied" };
    upload.mockResolvedValueOnce({ data: null, error: storageError });
    await expect(uploadChatImage(sb, CH, ME, file("image/jpeg"))).rejects.toMatchObject({ cause: storageError });
  });
});
