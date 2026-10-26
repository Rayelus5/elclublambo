"use client";

import dynamic from "next/dynamic";

/** AppKit only exists in the browser (it throws during SSR); see pay-widget-lazy.tsx. */
export const ApprovalsLazy = dynamic(() => import("./approvals-list").then((m) => m.ApprovalsList), {
  ssr: false,
  loading: () => <div className="min-h-64 rounded-panel bg-surface-2 motion-safe:animate-pulse" aria-hidden />,
});
