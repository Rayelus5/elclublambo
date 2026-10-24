// P0-R2: se reescriben en P1. The Linea-era constants the legacy DAO / raffle / poll specs were written against; only
// e2e/legacy uses them, and these specs are excluded from the default run (playwright.config.ts testIgnore). The shared
// chain module (../chain/shared.mjs) no longer has them, and start-chain.mjs no longer deploys the mock feed or WETH.
// TEST-ONLY values.
export { hardhatAccount, RPC_PORT, RPC_URL } from "../chain/shared.mjs";

export const CHAIN_ID = 59141; // Linea Sepolia (legacy islands)
/** Circle's USDC address on Linea Sepolia (src/lib/legacy/linea.ts). */
export const USDC_ADDRESS = "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7";
/** F4a: fixed TEST-ONLY addresses of the mock Chainlink ETH/USD feed and the mock WETH. */
export const ETH_USD_FEED_ADDRESS = "0x00000000000000000000000000000000000f4a01";
export const WETH_ADDRESS = "0x00000000000000000000000000000000000f4a02";
/** The mock feed's starting ETH/USD answer (8 decimals). */
export const INITIAL_ETH_PRICE_E8 = 2500n * 10n ** 8n;
