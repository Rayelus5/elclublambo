import type { NextConfig } from "next";
import { assertProductionReady } from "./src/lib/deploy/readiness";
import { headerEnvFromProcess, securityHeaders } from "./src/lib/security/headers";

// F5-R10: a Vercel production build with a testnet/unsafe configuration fails here, before anything deploys.
assertProductionReady();

const nextConfig: NextConfig = {
  // Standalone server only for the preproduction Docker image (F5-R7); Vercel and local dev keep the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    // Full CSP + security headers (F5-R3/R4), derived from NEXT_PUBLIC_* env when this config loads.
    return [{ source: "/:path*", headers: securityHeaders(headerEnvFromProcess()) }];
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
