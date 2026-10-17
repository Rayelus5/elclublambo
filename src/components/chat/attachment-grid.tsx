import { ImageOff } from "lucide-react";
import type { MessageAttachment } from "@/lib/chat/model";
import { cn } from "@/lib/utils";

/** Images attached to a message (private bucket, signed URLs). Click opens the full image in a new tab. */
export function AttachmentGrid({ attachments }: { attachments: readonly MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  const single = attachments.length === 1;
  return (
    <ul aria-label="Imágenes adjuntas" className={cn("grid gap-2", single ? "grid-cols-1" : "grid-cols-2")}>
      {attachments.map((a, i) => (
        <li key={a.id} className="min-w-0">
          {a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-fit max-w-full overflow-hidden rounded-control border border-border outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimizable */}
              <img
                src={a.url}
                alt={`Imagen adjunta ${i + 1} de ${attachments.length}`}
                width={a.width ?? undefined}
                height={a.height ?? undefined}
                loading="lazy"
                decoding="async"
                className={cn("h-auto w-auto max-w-full bg-surface-2 object-cover", single ? "max-h-80" : "max-h-48")}
              />
              <span className="sr-only"> (abre en una pestaña nueva)</span>
            </a>
          ) : (
            <div className="flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface-2 px-3 text-sm text-fg-muted">
              <ImageOff aria-hidden className="size-4" />
              Imagen no disponible
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
