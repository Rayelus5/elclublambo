"use client";

import { useLinkStatus } from "next/link";
import { Diamond } from "@/components/loading-ui/diamond";
import { cn } from "@/lib/utils";

/**
 * Small «loading» hint for the clicked sidebar link (must render inside a `<Link>`). The fixed-size slot is always
 * there, so the row never shifts; the diamond is mounted only while the navigation is pending and fades in after
 * 150 ms, so an instant (prefetched) navigation shows nothing. The content area's loader carries the announcement.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden="true" data-link-pending={pending ? "true" : "false"} className={cn("inline-flex size-3 shrink-0", className)}>
      {pending ? <Diamond role={undefined} aria-label={undefined} className="size-3 animate-loader-in text-accent" /> : null}
    </span>
  );
}
