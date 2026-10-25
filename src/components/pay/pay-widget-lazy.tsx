"use client";

import dynamic from "next/dynamic";

/** AppKit only exists in the browser (it throws during SSR); see public-connect-lazy.tsx. */
export const PayWidgetLazy = dynamic(() => import("./pay-widget").then((m) => m.PayWidget), {
  ssr: false,
  loading: () => <div className="min-h-96" aria-hidden />,
});
