"use client";

import dynamic from "next/dynamic";

/** AppKit only exists in the browser; see login-panel-lazy.tsx. */
export const PublicConnectLazy = dynamic(() => import("./public-connect").then((m) => m.PublicConnect), {
  ssr: false,
  loading: () => <div className="min-h-11 min-w-32" aria-hidden />,
});
