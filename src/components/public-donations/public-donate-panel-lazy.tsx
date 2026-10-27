"use client";

import dynamic from "next/dynamic";

/** AppKit only exists in the browser (it throws during SSR), and the panel resumes a stored donation from localStorage. */
export const PublicDonatePanelLazy = dynamic(() => import("./public-donate-panel").then((m) => m.PublicDonatePanel), {
  ssr: false,
  loading: () => <div className="min-h-64" aria-hidden />,
});
