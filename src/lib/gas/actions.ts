/**
 * The actions the gas tool prices (P6-R5): fixed L2 gas units and a representative calldata size each, for the L1 part.
 * Typical figures, not a measurement of any given contract; the page labels every amount «aprox.».
 */
export const GAS_ACTIONS = [
  { key: "ethTransfer", gas: 21_000n, calldataBytes: 0 },
  { key: "erc20Transfer", gas: 65_000n, calldataBytes: 68 },
  { key: "swap", gas: 180_000n, calldataBytes: 516 },
  { key: "nftMint", gas: 120_000n, calldataBytes: 164 },
] as const;

export type GasActionKey = (typeof GAS_ACTIONS)[number]["key"];

/**
 * Bytes an OP Stack transaction adds around its calldata (nonce, fees, gas, to, value, chain id, access list), passed
 * to GasPriceOracle.getL1FeeUpperBound together with the calldata; the oracle itself adds the 68-byte signature.
 */
export const OP_TX_ENVELOPE_BYTES = 110;
