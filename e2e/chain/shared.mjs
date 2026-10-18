import { toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

/**
 * Local chain constants shared by start-chain.mjs (Node) and the Playwright specs/helpers.
 * Everything here is TEST-ONLY: Hardhat's public default mnemonic. Never hold real funds on these accounts.
 */
export const CHAIN_ID = 59141; // Linea Sepolia
export const RPC_PORT = 8545;
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
/** start-chain.mjs answers 200 here once the mock USDC is in place (the RPC port opens earlier). */
export const READY_PORT = 8547;
export const READY_URL = `http://127.0.0.1:${READY_PORT}/ready`;
/** Circle's USDC address on Linea Sepolia (src/lib/economy/networks.ts): the mock lives here. */
export const USDC_ADDRESS = "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7";
export const USDC_DECIMALS = 6;
/**
 * F4a: fixed TEST-ONLY addresses for the mock Chainlink ETH/USD feed and the mock WETH (start-chain.mjs puts their code
 * there). The server reads them through the ETH_USD_FEED_ADDRESS_59141 / WETH_ADDRESS_59141 overrides
 * (playwright.config.ts), never the real Linea Sepolia addresses. Lowercase so no checksum applies.
 */
export const ETH_USD_FEED_ADDRESS = "0x00000000000000000000000000000000000f4a01";
export const WETH_ADDRESS = "0x00000000000000000000000000000000000f4a02";
/** The mock feed's starting ETH/USD answer (8 decimals). */
export const INITIAL_ETH_PRICE_E8 = 2500n * 10n ** 8n;
export const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
/** Hardhat's default accounts get this much mock USDC (base units: 1,000,000 USDC). */
export const MINT_PER_ACCOUNT = 1_000_000n * 10n ** 6n;
export const MINTED_ACCOUNTS = 10;

/** Hardhat default account `index` (path m/44'/60'/0'/0/index). */
export function hardhatAccount(index) {
  const account = mnemonicToAccount(HARDHAT_MNEMONIC, { addressIndex: index });
  const privateKey = toHex(/** @type {Uint8Array} */ (account.getHdKey().privateKey));
  return { address: account.address, privateKey: /** @type {`0x${string}`} */ (privateKey) };
}
