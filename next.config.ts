import type { NextConfig } from "next";
import { headerEnvFromProcess, securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  /* config options here */
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
