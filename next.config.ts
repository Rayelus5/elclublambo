import type { NextConfig } from "next";
import { assertProductionReady } from "./src/lib/deploy/readiness";
import { publicRedirects, publicRewrites } from "./src/lib/i18n/route-rules";
import { headerEnvFromProcess, securityHeaders } from "./src/lib/security/headers";

// F5-R10: a Vercel production build with a testnet/unsafe configuration fails here, before anything deploys.
assertProductionReady();

const nextConfig: NextConfig = {
  // Standalone server only for the preproduction Docker image (F5-R7); Vercel and local dev keep the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // The redirects and rewrites below match like the proxy that used to do them: case-sensitively. Otherwise
    // /HERRAMIENTAS/GAS would be served while the proxy (switches, 404s) sees an unknown URL.
    caseSensitiveRoutes: true,
  },
  async headers() {
    // Full CSP + security headers (F5-R3/R4), derived from NEXT_PUBLIC_* env when this config loads.
    return [{ source: "/:path*", headers: securityHeaders(headerEnvFromProcess()) }];
  },
  // The fixed public routing (Spanish URLs, /es/* → canonical, old club URLs → /foro). Here and not in the proxy:
  // Vercel resolves these in its router without running any function, prefetches included (they skip the proxy).
  async redirects() {
    return publicRedirects();
  },
  async rewrites() {
    return { beforeFiles: publicRewrites(), afterFiles: [], fallback: [] };
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
