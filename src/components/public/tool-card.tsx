import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

interface Props {
  icon: LucideIcon;
  name: string;
  text: string;
  /** Status label ("Available" / "Coming soon"). */
  status: string;
  /** Present: an active tool that links. Absent: a «coming soon» card, not a link. */
  href?: string;
}

/** A tool in the hub. Coming-soon cards are plain list items: no link, no hover affordance, status read with the name. */
export function ToolCard({ icon: Icon, name, text, status, href }: Props) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface-2 text-accent">
          <Icon aria-hidden className="size-5" />
        </span>
        <span
          className={
            href
              ? "rounded-control border border-accent px-2 py-1 text-small font-bold text-accent"
              : "rounded-control border border-border-strong px-2 py-1 text-small text-fg-muted"
          }
        >
          {status}
        </span>
      </span>
      <span className="font-display text-lg font-bold text-fg">{name}</span>
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
        <div className={`${base} opacity-80`}>{body}</div>
      )}
    </li>
  );
}
