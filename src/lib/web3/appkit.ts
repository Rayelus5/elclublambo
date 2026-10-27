import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { colors } from "@/styles/tokens";
import { appChains } from "./chains";

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

const networks = [...appChains()] as [AppKitNetwork, ...AppKitNetwork[]];

// Browser-side RPC overrides (tests/local chains only; empty in production = the public RPC). The literal references
// are required: Next inlines NEXT_PUBLIC_* by name. They drive the wallet-balance reads before a payment is signed.
const customRpcUrls: Record<string, { url: string }[]> = {};
if (process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL) customRpcUrls["eip155:84532"] = [{ url: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL }];
if (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL) customRpcUrls["eip155:421614"] = [{ url: process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL }];

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  ...(Object.keys(customRpcUrls).length ? { customRpcUrls } : {}),
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
        defaultNetwork: networks[0],
        projectId,
        metadata: {
          name: "ElClub.",
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
        // MetaMask and OKX only. AppKit otherwise adds the Coinbase Wallet / Base Account connectors, and creating the
        // Coinbase one loads its telemetry script (cca-lite.coinbase.com), outside the CSP (src/lib/security/headers.ts).
        enableCoinbase: false,
        // D5 / P0-R11, checked 2026-10-24 against supabase/auth master (internal/utilities/siwe/parser.go,
        // VerifySignature, last changed c3005a4 2026-07-14): GoTrue's signInWithWeb3 verifies an Ethereum signature
        // with ecrecover only. It requires a 65-byte signature and compares the recovered address; there is no
        // ERC-1271 (isValidSignature) call and no ERC-6492 unwrapping. A Base Account (smart wallet) signature would
        // therefore fail login, so P0 accepts EOAs only and this stays off.
        enableBaseAccount: false,
        featuredWalletIds: [METAMASK_WALLET_ID, OKX_WALLET_ID],
        includeWalletIds: [METAMASK_WALLET_ID, OKX_WALLET_ID],
      });
