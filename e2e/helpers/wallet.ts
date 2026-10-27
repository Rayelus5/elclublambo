import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CHAINS, DEFAULT_CHAIN_ID } from "../chain/shared.mjs";

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
  /** The network the wallet starts on (every page load starts there again); defaults to Base Sepolia. */
  chainId?: number;
  /**
   * Asked before every eth_sendTransaction, before anything reaches the node: true rejects it as a user would (EIP-1193
   * 4001), so nothing is sent. Lets a spec reject exactly the n-th signature.
   */
  reject?: () => boolean | Promise<boolean>;
};

type PageConfig = { address: string; rpcUrls: Record<number, string>; chainId: number };

/** Runs in the page (serialised by Playwright): no closures over Node values. */
function injected({ address, rpcUrls, chainId: initialChainId }: PageConfig) {
  type Req = { method: string; params?: unknown[] };
  const w = window as unknown as Record<string, unknown> & {
    __walletSent?: (n: number, hash: string) => Promise<void>;
    __walletReject?: () => Promise<boolean>;
  };
  const STORE = "__testwallet_permitted";
  const hex = (id: number) => "0x" + id.toString(16);
  // The wallet's current network, as in a real wallet: wallet_switchEthereumChain moves it, and eth_chainId and every
  // forwarded call follow it. Kept per page (a reload starts again on the initial network).
  let chainId = initialChainId;
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
    const res = await fetch(rpcUrls[chainId]!, {
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
            emit("connect", { chainId: hex(chainId) });
            emit("accountsChanged", [address]);
          }
          return [address];
        }
        case "eth_accounts":
          return permitted ? [address] : [];
        case "eth_chainId":
          return hex(chainId);
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
          // Only the networks the test nodes run (a real wallet answers 4902 for one it does not know).
          const target = Number.parseInt((params[0] as { chainId?: string } | undefined)?.chainId ?? "", 16);
          if (!rpcUrls[target]) throw err(4902, "Unrecognized chain ID");
          if (target !== chainId) {
            chainId = target;
            emit("chainChanged", hex(chainId));
          }
          return null;
        }
        case "wallet_addEthereumChain":
          return null;
        case "eth_sendTransaction": {
          if (!permitted) throw err(4100, "The requested account has not been authorized by the user.");
          const tx = { ...(params[0] as Record<string, unknown>) };
          if (typeof tx.from === "string" && tx.from.toLowerCase() !== address.toLowerCase()) {
            throw err(4100, "The requested account has not been authorized by the user.");
          }
          tx.from = address;
          // Each node runs one chain, the current one; a request for another chain is refused like a real wallet does.
          if (tx.chainId !== undefined && Number(tx.chainId) !== chainId) throw err(4901, "The provider is not connected to the requested chain.");
          delete tx.chainId;
          if (await w.__walletReject?.()) throw err(4001, "User rejected the request.");
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
 * with a Hardhat default account by forwarding `eth_*` calls to the local node of its current network (CHAINS), which
 * has those accounts unlocked, and switches between those networks on wallet_switchEthereumChain (P0-R13).
 * TEST-ONLY: the accounts come from Hardhat's public mnemonic.
 */
export async function installTestWallet(context: BrowserContext, opts: TestWalletOptions): Promise<TestWallet> {
  const wallet: TestWallet = { address: opts.address, sent: [] };
  // The page-side counter restarts on every reload; the context-wide count is the one specs care about.
  await context.exposeFunction("__walletSent", async (_pageCount: number, hash: string) => {
    const n = wallet.sent.push(hash);
    await opts.onSent?.(n, hash);
  });
  await context.exposeFunction("__walletReject", async () => (await opts.reject?.()) ?? false);
  const rpcUrls = Object.fromEntries(Object.entries(CHAINS).map(([id, c]) => [Number(id), c.rpcUrl]));
  await context.addInitScript(injected, { address: opts.address, rpcUrls, chainId: opts.chainId ?? DEFAULT_CHAIN_ID });
  return wallet;
}

/**
 * Connects the injected wallet from a payment dialog's "Conectar wallet": opens the AppKit modal (mounted outside the
 * Radix dialog) and picks MetaMask (the EIP-6963 announcement above). Retried, because a click that lands while the
 * modal is still animating in does nothing; done once the dialog no longer offers "Conectar wallet".
 */
export async function connectInjected(page: Page, dialogName: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  const connect = dialog.getByRole("button", { name: "Conectar wallet" });
  const metamask = page.locator("w3m-modal").getByText("MetaMask").first();
  await expect(async () => {
    if (!(await metamask.isVisible()) && (await connect.isVisible())) await connect.click({ timeout: 5_000 });
    await metamask.click({ timeout: 5_000 });
    await expect(connect).toHaveCount(0, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

const PUBLIC_CONNECT = { es: { connect: "Conectar wallet", sign: "Firmar y entrar" }, en: { connect: "Connect wallet", sign: "Sign in" } };

/**
 * Signs in from the public side (P2-R16) with the injected wallet: «Conectar wallet» inside `scope` opens AppKit, MetaMask
 * connects, then «Firmar y entrar» signs the SIWE message (the Hardhat node signs for its unlocked account) and the
 * component navigates to its `next`. Retried like connectInjected: a click on the modal while it animates in does nothing.
 */
export async function signInPublic(page: Page, scope: Locator, lang: "es" | "en" = "es") {
  const t = PUBLIC_CONNECT[lang];
  const connect = scope.getByRole("button", { name: t.connect });
  const sign = scope.getByRole("button", { name: t.sign });
  const metamask = page.locator("w3m-modal").getByText("MetaMask").first();
  await expect(async () => {
    if (await sign.isVisible()) return;
    if (!(await metamask.isVisible()) && (await connect.isVisible())) await connect.click({ timeout: 5_000 });
    await metamask.click({ timeout: 5_000 });
    await expect(sign).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
  await sign.click();
}
