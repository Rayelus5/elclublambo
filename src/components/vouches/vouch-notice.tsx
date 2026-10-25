import { Info } from "lucide-react";

/** The notice every vouches screen carries (public, permanent, identities not verified). */
export function VouchNotice({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-control border border-border p-3 text-sm text-fg-muted">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {text}
    </p>
  );
}
