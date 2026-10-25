"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the receipt (server refresh) every `everyMs` while it is not final. Mounted only when pending. */
export function ReceiptRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
