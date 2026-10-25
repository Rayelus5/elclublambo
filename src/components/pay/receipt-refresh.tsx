"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the receipt (server refresh) every `everyMs`, at most `maxTicks` times when given. Mounted only when not final. */
export function ReceiptRefresh({ everyMs = 5000, maxTicks }: { everyMs?: number; maxTicks?: number }) {
  const router = useRouter();
  useEffect(() => {
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (maxTicks !== undefined && ticks >= maxTicks) clearInterval(id);
    }, everyMs);
    return () => clearInterval(id);
  }, [router, everyMs, maxTicks]);
  return null;
}
