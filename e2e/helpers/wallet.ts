import type { BrowserContext } from "@playwright/test";
import { CHAIN_ID, RPC_URL } from "../chain/shared.mjs";

export type TestWallet = {
  address: string;
  /** Hashes of every eth_sendTransaction this wallet signed, in order (across all pages of the context). */
  sent: string[];
};

export type TestWalletOptions = {
  /** Hardhat account address the wallet signs with (the node keeps these accounts unlocked). */
  address: string;
  /**
   * Called inside the wallet right after the node mined a transaction and BEFORE its hash is handed to the app.
   * `n` counts from 1. Whatever it awaits holds the app back, so a spec can cut the network at exactly this point.
   */
  onSent?: (n: number, hash: string) => void | Promise<void>;
};

type PageConfig = { address: string; rpcUrl: string; chainId: number };

/** Runs in the page (serialised by Playwright): no closures over Node values. */
function injected({ address, rpcUrl, chainId }: PageConfig) {
  type Req = { method: string; params?: unknown[] };
  const w = window as unknown as Record<string, unknown> & { __walletSent?: (n: number, hash: string) => Promise<void> };
  const STORE = "__testwallet_permitted";
  const chainHex = "0x" + chainId.toString(16);
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args));
  const read = () => {
    try {
      return localStorage.getItem(STORE) === address.toLowerCase();
    } catch {
      return false;
    }
  };
  const write = (on: boolean) => {
    try {
      if (on) localStorage.setItem(STORE, address.toLowerCase());
      else localStorage.removeItem(STORE);
    } catch {
      /* private mode: permission lasts for this page only */
    }
  };
  let permitted = read();
  let sentCount = 0;

  const err = (code: number, message: string) => Object.assign(new Error(message), { code });
  async function node(method: string, params: unknown[] = []): Promise<unknown> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    const json = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
    if (json.error) throw err(json.error.code, json.error.message);
    return json.result;
  }

  const provider = {
    isMetaMask: true,
    async request({ method, params = [] }: Req): Promise<unknown> {
      switch (method) {
        case "eth_requestAccounts": {
          if (!permitted) {
            permitted = true;
            write(true);
            emit("connect", { chainId: chainHex });
            emit("accountsChanged", [address]);
          }
          return [address];
        }
        case "eth_accounts":
          return permitted ? [address] : [];
        case "eth_chainId":
          return chainHex;
        case "net_version":
          return String(chainId);
        case "wallet_getPermissions":
        case "wallet_requestPermissions":
          if (method === "wallet_requestPermissions") {
            permitted = true;
            write(true);
          }
          return permitted ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          permitted = false;
          write(false);
          emit("accountsChanged", []);
          return null;
        case "wallet_switchEthereumChain": {
          const target = (params[0] as { chainId?: string } | undefined)?.chainId;
          if (target?.toLowerCase() === chainHex) return null;
          throw err(4902, "Unrecognized chain ID");
        }
        case "wallet_addEthereumChain":
          return null;
        case "linea_estimateGas": {
          // viem's Linea chain asks the wallet for fees through this Linea-only method: answer from the standard ones.
          const tx = params[0] as Record<string, unknown>;
          const [gas, tip, block] = await Promise.all([
            node("eth_estimateGas", [tx]),
            node("eth_maxPriorityFeePerGas"),
            node("eth_getBlockByNumber", ["latest", false]) as Promise<{ baseFeePerGas?: string }>,
          ]);
          return { gasLimit: gas, baseFeePerGas: block.baseFeePerGas ?? "0x1", priorityFeePerGas: tip };
        }
        case "eth_sendTransaction": {
          if (!permitted) throw err(4100, "The requested account has not been authorized by the user.");
          const tx = { ...(params[0] as Record<string, unknown>) };
          if (typeof tx.from === "string" && tx.from.toLowerCase() !== address.toLowerCase()) {
            throw err(4100, "The requested account has not been authorized by the user.");
          }
          tx.from = address;
          delete tx.chainId; // the node only runs this one chain; the wallet already vouched for it
          const hash = (await node("eth_sendTransaction", [tx])) as string;
          sentCount += 1;
          await w.__walletSent?.(sentCount, hash);
          return hash;
        }
        default:
          return node(method, params);
      }
    },
    on(event: string, fn: (...a: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return provider;
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
    off(event: string, fn: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
    once(event: string, fn: (...a: unknown[]) => void) {
      const wrapped = (...a: unknown[]) => {
        provider.removeListener(event, wrapped);
        fn(...a);
      };
      return provider.on(event, wrapped);
    },
  };

  // Announced as MetaMask (its EIP-6963 rdns): AppKit is configured with MetaMask/OKX only, so that is the entry it lists.
  const detail = Object.freeze({
    info: Object.freeze({
      uuid: "00000000-0000-4000-8000-000000000001",
      name: "MetaMask",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjZjY4NTFiIi8+PC9zdmc+",
      rdns: "io.metamask",
    }),
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true, writable: true });
}

/**
 * Injects an EIP-1193 / EIP-6963 wallet into every page of `context` (call it before the first page loads). It signs
 * with a Hardhat default account by forwarding `eth_*` calls to the local node, which has those accounts unlocked.
 * TEST-ONLY: the accounts come from Hardhat's public mnemonic.
 */
export async function installTestWallet(context: BrowserContext, opts: TestWalletOptions): Promise<TestWallet> {
  const wallet: TestWallet = { address: opts.address, sent: [] };
  // The page-side counter restarts on every reload; the context-wide count is the one specs care about.
  await context.exposeFunction("__walletSent", async (_pageCount: number, hash: string) => {
    const n = wallet.sent.push(hash);
    await opts.onSent?.(n, hash);
  });
  await context.addInitScript(injected, { address: opts.address, rpcUrl: RPC_URL, chainId: CHAIN_ID });
  return wallet;
}
