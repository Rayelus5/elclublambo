"use client";

import dynamic from "next/dynamic";

/** AppKit only exists in the browser (it throws during SSR); see pay-widget-lazy.tsx. */
export const MultisendLazy = dynamic(() => import("./multisend-form").then((m) => m.MultisendForm), {
  ssr: false,
  loading: () => <div className="min-h-96 rounded-panel bg-surface-2 motion-safe:animate-pulse" aria-hidden />,
});
