"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDaoEvents } from "@/lib/treasury/realtime";

const DEBOUNCE_MS = 300;

/**
 * Keeps /dao live: on a treasury change (or a re-join after a gap) it re-renders the server page, which re-reads every
 * figure through the definer RPCs. Bursts collapse into one refresh (a credit touches the ledger and the state together).
 */
export function DaoLive() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useDaoEvents({ onChanged: schedule, onResync: schedule });
  return null;
}
