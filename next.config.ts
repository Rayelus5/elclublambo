import type { NextConfig } from "next";

// Only frame-src / frame-ancestors are set on purpose: no default-src, so nothing else (scripts, fetches, images)
// is restricted. Child frames allowed: the DexScreener chart of Alpha messages and the iframes the wallet SDK
// (Reown AppKit / WalletConnect) mounts for its secure site and for Verify.
const FRAME_SRC = [
  "https://dexscreener.com",
  "https://secure.walletconnect.org",
  "https://secure.walletconnect.com",
  "https://secure-mobile.walletconnect.org",
  "https://secure-mobile.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://verify.walletconnect.com",
];
const CSP = `frame-src ${FRAME_SRC.join(" ")}; frame-ancestors 'none'`;

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: CSP }] }];
  },
  turbopack: {
    resolveAlias: {
      // Base/Coinbase Smart Wallet no está habilitado: si se activara alguna vez,
      // este stub lanzaría error en tiempo de ejecución.
      "@base-org/account": "./src/lib/web3/stubs/base-account.ts",
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
