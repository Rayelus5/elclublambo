const REENCODABLE = new Set(["image/png", "image/jpeg", "image/webp"]);
const QUALITY = 0.9;

export class ImageProcessError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("No se pudo procesar la imagen", options);
    this.name = "ImageProcessError";
  }
}

/**
 * Re-encodes an image through a canvas so every metadata block (EXIF, GPS, camera, ...) is dropped. Same mime out
 * as in. Downscales only when the longest side exceeds `maxSide`. GIFs are returned untouched (re-encoding would
 * lose the animation). Throws ImageProcessError when the image cannot be decoded or encoded.
 */
export async function reencodeImage(file: File, opts: { maxSide?: number } = {}): Promise<File> {
  if (!REENCODABLE.has(file.type)) return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    throw new ImageProcessError({ cause: e });
  }
  try {
    const scale = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(bmp.width, bmp.height)) : 1;
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const quality = file.type === "image/png" ? undefined : QUALITY;
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageProcessError();
      ctx.drawImage(bmp, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: file.type, quality });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageProcessError();
      ctx.drawImage(bmp, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, quality));
    }
    // Some browsers fall back to PNG when they cannot encode the requested type: refuse rather than mislabel.
    if (!blob || blob.type !== file.type) throw new ImageProcessError();
    return new File([blob], file.name, { type: file.type });
  } catch (e) {
    throw e instanceof ImageProcessError ? e : new ImageProcessError({ cause: e });
  } finally {
    bmp.close?.();
  }
}
