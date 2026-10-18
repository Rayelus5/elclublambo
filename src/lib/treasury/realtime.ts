"use client";

import { usePrivateTopic } from "@/lib/realtime/private-topic";

export interface DaoEventHandlers {
  /** The treasury changed (donation recorded, credited or reverted; ranking opt-in): re-read it. */
  onChanged?: () => void;
  /** The socket was re-joined after a gap: events may have been missed. */
  onResync?: () => void;
}

/** The private `dao` topic (any active member may join; the payload carries only the chain). */
export function useDaoEvents(handlers: DaoEventHandlers): void {
  usePrivateTopic("dao", "dao_changed", { onEvent: () => handlers.onChanged?.(), onResync: () => handlers.onResync?.() });
}
