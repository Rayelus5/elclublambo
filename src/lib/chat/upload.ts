import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const CHAT_IMAGES_BUCKET = "chat-images";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export type ImageErrorCode = "image_type" | "image_too_large" | "image_decode" | "image_upload";

const IMAGE_ERROR_COPY: Record<ImageErrorCode, string> = {
  image_type: "Solo puedes adjuntar imágenes PNG, JPG, WebP o GIF.",
  image_too_large: "La imagen pesa más de 5 MB.",
  image_decode: "No se pudo leer esa imagen.",
  image_upload: "No se pudo subir la imagen. Inténtalo de nuevo.",
};

export class ImageError extends Error {
  constructor(
    public readonly code: ImageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(IMAGE_ERROR_COPY[code], options);
    this.name = "ImageError";
  }
}

export type PreparedImage = { blob: Blob; width: number; height: number; mime: string };

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  return false;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError("image_decode"))), mime, quality);
  });
}

/**
 * Validates and normalizes an image before upload.
 * - png/jpeg/webp are decoded and re-encoded through a canvas (webp, or png when the source is a png with
 *   transparency). Re-encoding drops EXIF and every other metadata block (GPS, camera, ...).
 * - gif is kept byte-for-byte: a canvas would flatten the animation. Its metadata (comment/application
 *   extension blocks) is therefore NOT stripped.
 * Rejects non-allowed types and anything over 5 MB (after re-encoding for the canvas path).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ALLOWED.has(file.type)) throw new ImageError("image_type");

  if (file.type === "image/gif") {
    if (file.size > MAX_IMAGE_BYTES) throw new ImageError("image_too_large");
    const bmp = await decode(file);
    const { width, height } = bmp;
    bmp.close?.();
    return { blob: file, width, height, mime: "image/gif" };
  }

  const bmp = await decode(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageError("image_decode");
    ctx.drawImage(bmp, 0, 0, width, height);

    const keepPng = file.type === "image/png" && hasTransparency(ctx, width, height);
    const requested = keepPng ? "image/png" : "image/webp";
    const blob = await toBlob(canvas, requested, keepPng ? undefined : 0.9);
    if (blob.size > MAX_IMAGE_BYTES) throw new ImageError("image_too_large");
    // Safari can't encode webp and silently returns a PNG: trust the blob, not the request.
    const mime = ALLOWED.has(blob.type) ? blob.type : requested;
    return { blob, width, height, mime };
  } finally {
    bmp.close?.();
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new ImageError("image_decode");
  }
}

export type UploadedImage = { path: string; mime: string; size: number; width: number; height: number };

/**
 * Uploads to `<channel>/<member>/<uuid>.<ext>` in the private bucket. upsert is false on purpose: members have
 * no UPDATE policy, so an existing object can never be overwritten.
 */
export async function uploadChatImage(
  supabase: SupabaseClient,
  channelId: string,
  memberId: string,
  file: File,
): Promise<UploadedImage> {
  const { blob, width, height, mime } = await prepareImage(file);
  const path = `${channelId}/${memberId}/${crypto.randomUUID()}.${EXT[mime] ?? "jpg"}`;
  const { error } = await supabase.storage
    .from(CHAT_IMAGES_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false, cacheControl: "3600" });
  if (error) throw new ImageError("image_upload", { cause: error });
  return { path, mime, size: blob.size, width, height };
}
