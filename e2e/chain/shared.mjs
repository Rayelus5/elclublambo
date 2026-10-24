import { toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

/**
 * Local chain constants shared by start-chain.mjs (Node) and the Playwright specs/helpers (P0-R13).
 * Everything here is TEST-ONLY: Hardhat's public default mnemonic. Never hold real funds on these accounts.
 *
 * Two Hardhat nodes, one per network of the testnet set: Base Sepolia on :8545 and Arbitrum Sepolia on :8546. Each has a
 * mock USDC at Circle's USDC address for that testnet (src/lib/economy/networks.ts), so the app's own registry applies.
 */
export const CHAINS = {
  84532: { rpcPort: 8545, rpcUrl: "http://127.0.0.1:8545", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  421614: { rpcPort: 8546, rpcUrl: "http://127.0.0.1:8546", usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" },
};
/** TEST-ONLY copy of the club Safe address stored in chains.safe_address (migration 20261024100001_chains.sql). */
export const CLUB_SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
/**
 * Where start-chain.mjs puts the mock Chainlink ETH/USD aggregator on both nodes (ETH_USD_FEED_ADDRESS_<chainId>).
 * All lowercase on purpose: viem's isAddress rejects the mixed-case "fEed" (bad EIP-55 checksum), and eth-price.ts
 * would then silently fall back to the real feed address.
 */
export const ETH_USD_FEED = "0x000000000000000000000000000000000000feed";
/** The mock feed's answer: 2000 USD with 8 decimals. */
export const ETH_USD_PRICE_E8 = 2000_00000000n;
/** The wallet's starting network, and the one the legacy islands' helpers (e2e/legacy) talk to. */
export const DEFAULT_CHAIN_ID = 84532;
/** Aliases of the default (84532) node, kept for e2e/legacy (preflight ruling #11). */
export const RPC_PORT = CHAINS[DEFAULT_CHAIN_ID].rpcPort;
export const RPC_URL = CHAINS[DEFAULT_CHAIN_ID].rpcUrl;
/** start-chain.mjs answers 200 here once BOTH nodes have their mock USDC in place (the RPC ports open earlier). */
export const READY_PORT = 8547;
export const READY_URL = `http://127.0.0.1:${READY_PORT}/ready`;
export const USDC_DECIMALS = 6;
export const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
/** Hardhat's default accounts get this much mock USDC on each chain (base units: 1,000,000 USDC). */
export const MINT_PER_ACCOUNT = 1_000_000n * 10n ** 6n;
export const MINTED_ACCOUNTS = 10;

/** Hardhat default account `index` (path m/44'/60'/0'/0/index). */
export function hardhatAccount(index) {
  const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  const privateKey = toHex(/** @type {Uint8Array} */ (account.getHdKey().privateKey));
  return { address: account.address, privateKey: /** @type {`0x${string}`} */ (privateKey) };
}
