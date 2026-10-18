import Link from "next/link";
import { GUIDE_SECTIONS, type GuideSlug } from "@/lib/guide/sections";
import { cn } from "@/lib/utils";

/**
 * "¿Cómo funciona?" link for the money dialogs. Same tab on purpose: the guide is short and the back button returns to
 * the page the member was on.
 */
export function HowItWorksLink({ section, className }: { section: GuideSlug; className?: string }) {
  const title = GUIDE_SECTIONS.find((s) => s.slug === section)?.title ?? "";
  return (
    <Link
      href={`/guia/${section}`}
      aria-label={`¿Cómo funciona? Guía: ${title}`}
      className={cn(
        "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
    >
      ¿Cómo funciona?
    </Link>
  );
}
