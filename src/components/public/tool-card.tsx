import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

interface Props {
  icon: LucideIcon;
  name: string;
  text: string;
  /** Status label ("Available" / "Coming soon" / "Not available right now"). */
  status: string;
  /** Present: an active tool that links. Absent: a card that is not a link («coming soon» or switched off). */
  href?: string;
  /**
   * A tool switched off from Administración (A-R16): no link, a dashed border and the icon dimmed. Every text keeps
   * AA contrast (no fade on text), so the state reads in the status label and not only through the fade.
   */
  dimmed?: boolean;
}

/** A tool in the hub. Cards without a link are plain list items: no hover affordance, status read with the name. */
export function ToolCard({ icon: Icon, name, text, status, href, dimmed = false }: Props) {
  const fade = dimmed ? " opacity-60" : "";
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface-2 ${dimmed ? "text-fg-muted" : "text-accent"}${fade}`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <span
          className={
            href
              ? "rounded-control border border-accent px-2 py-1 text-small font-bold text-accent"
              : dimmed
                ? "rounded-control border border-border-strong px-2 py-1 text-small font-bold text-fg"
                : "rounded-control border border-border-strong px-2 py-1 text-small text-fg-muted"
          }
        >
          {status}
        </span>
      </span>
      <span className="font-display text-lg font-bold text-fg">{name}</span>
      {/* No fade on the description: fg-muted at 60 % falls under AA (4.0:1 on surface); fg-muted alone is 9.2:1. */}
      <span className="text-base text-fg-muted">{text}</span>
      {href ? <ArrowRight aria-hidden className="mt-auto size-5 text-accent" /> : null}
    </>
  );
  const base = "flex h-full min-h-44 flex-col gap-3 rounded-control border border-border-strong bg-surface p-5";
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={`${base} outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent`}
        >
          {body}
        </Link>
      ) : (
        <div className={dimmed ? `${base} border-dashed` : `${base} opacity-80`}>{body}</div>
      )}
    </li>
  );
}
