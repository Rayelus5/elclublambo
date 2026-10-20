import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatChange } from "@/lib/market/format";

type Dir = ReturnType<typeof formatChange>["dir"];

/** Token colour for a variation's direction. Always paired with `ChangeIcon`: never colour alone. */
export function changeTone(dir: Dir): string {
  return dir === "up" ? "text-success" : dir === "down" ? "text-danger" : "text-fg-muted";
}

export function ChangeIcon({ dir }: { dir: Dir }) {
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return <Icon className="size-3.5 shrink-0" aria-hidden />;
}
