"use client";

import dynamic from "next/dynamic";

/**
 * AppKit only exists in the browser (see lib/web3/appkit.ts), and `useAppKit()` throws during SSR.
 * The wallet panel is therefore rendered client-side only; the placeholder keeps the button's height.
 */
export const LoginPanelLazy = dynamic(() => import("./login-panel").then((m) => m.LoginPanel), {
  ssr: false,
  loading: () => <div className="min-h-11" aria-hidden />,
});
