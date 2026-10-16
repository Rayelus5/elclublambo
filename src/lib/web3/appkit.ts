import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { colors } from "@/styles/tokens";
import { APP_CHAINS } from "./chains";

// IDs del explorer de Reown (WalletGuide).
export const METAMASK_WALLET_ID =
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96";
export const OKX_WALLET_ID =
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID;
if (!projectId) {
  throw new Error(
    "Falta NEXT_PUBLIC_REOWN_PROJECT_ID. Defínelo en .env.local (ver .env.example).",
  );
}

const networks = [...APP_CHAINS] as [AppKitNetwork, ...AppKitNetwork[]];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
});

const origin =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");

// Solo en el cliente: en el prerender de servidor createAppKit intenta hacer fetch
// de la configuración remota y falla con HANGING_PROMISE_REJECTION.
export const appKit =
  typeof window === "undefined"
    ? null
    : createAppKit({
        adapters: [wagmiAdapter],
        networks,
        projectId,
        metadata: {
          name: "El Club Lambo",
          description: "Foro privado de la comunidad",
          url: origin,
          icons: [],
        },
        themeMode: "dark",
        themeVariables: {
          "--w3m-accent": colors.accent,
          "--w3m-border-radius-master": "2px",
          "--w3m-font-family": "DM Sans, sans-serif",
        },
        features: {
          email: false,
          socials: false,
          swaps: false,
          onramp: false,
          analytics: false,
        },
        featuredWalletIds: [METAMASK_WALLET_ID, OKX_WALLET_ID],
        includeWalletIds: [METAMASK_WALLET_ID, OKX_WALLET_ID],
      });
