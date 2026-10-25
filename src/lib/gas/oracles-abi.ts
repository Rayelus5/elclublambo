/**
 * OP Stack GasPriceOracle predeploy (Base). `getL1FeeUpperBound` exists since Fjord; source:
 * ethereum-optimism/optimism packages/contracts-bedrock/src/L2/GasPriceOracle.sol (checked 2026-10-25).
 */
export const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as const;

export const gasPriceOracleAbi = [
  {
    type: "function",
    name: "getL1FeeUpperBound",
    stateMutability: "view",
    inputs: [{ name: "_unsignedTxSize", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "l1BaseFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/**
 * Arbitrum Nitro's NodeInterface (a virtual contract the node answers in eth_call; docs.arbitrum.io «NodeInterface
 * reference», checked 2026-10-25). `payable` in its interface, so it is called with `call`, not `readContract`.
 */
export const NODE_INTERFACE = "0x00000000000000000000000000000000000000C8" as const;

export const nodeInterfaceAbi = [
  {
    type: "function",
    name: "gasEstimateL1Component",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "contractCreation", type: "bool" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "gasEstimateForL1", type: "uint64" },
      { name: "baseFee", type: "uint256" },
      { name: "l1BaseFeeEstimate", type: "uint256" },
    ],
  },
] as const;
