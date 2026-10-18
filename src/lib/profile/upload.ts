import { reencodeImage } from "@/lib/images/strip-metadata";
import { createBrowserClient } from "@/lib/supabase/browser";

export const MAX_AVATAR_BYTES = 2097152;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export class AvatarError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AvatarError";
  }
}

export const AVATAR_MAX_SIDE = 512;

/** Client-side check; the bucket and set_avatar enforce the same limits on the server. */
export function checkAvatarFile(file: File): void {
  if (!Object.hasOwn(EXT, file.type)) throw new AvatarError("Usa una imagen PNG, JPG o WebP.");
  if (file.size > MAX_AVATAR_BYTES) throw new AvatarError("La imagen pesa más de 2 MB.");
}

/** Uploads to `<member_id>/<uuid>.<ext>` (no overwrite) and returns the object path to pass to setAvatarAction. */
export async function uploadAvatar(original: File): Promise<string> {
  if (!Object.hasOwn(EXT, original.type)) throw new AvatarError("Usa una imagen PNG, JPG o WebP.");
  // Re-encode first: drops EXIF/GPS and shrinks the image, so the size check applies to what is really uploaded.
  let file: File;
  try {
    file = await reencodeImage(original, { maxSide: AVATAR_MAX_SIDE });
  } catch (e) {
    throw new AvatarError("No se pudo procesar la imagen", { cause: e });
  }
  checkAvatarFile(file);
  const supabase = createBrowserClient();
  const me = await supabase.rpc("current_member_id");
  if (me.error || typeof me.data !== "string") throw new AvatarError("Tu sesión no es válida. Vuelve a conectar tu wallet.");
  const path = `${me.data}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
  if (error) throw new AvatarError("No se pudo subir la imagen. Inténtalo de nuevo.", { cause: error });
  return path;
}
