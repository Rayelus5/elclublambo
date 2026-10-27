import { HandHeart } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Mecenas role as a chip (P1-R3: from 1 USD donated, never removed automatically). */
export function MecenasBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-control border border-accent px-2 py-0.5 text-[13px] font-bold text-accent", className)}>
      <HandHeart aria-hidden className="size-3.5" />
      Mecenas
    </span>
  );
}
