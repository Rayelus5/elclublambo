// Hardhat 2 config for the local E2E chain. Only `hardhat node` is used: no contracts are compiled
// (the mock USDC ships precompiled in mock-usdc.json). Default accounts = Hardhat's public test mnemonic.
/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 59141, // Linea Sepolia
      mining: { auto: true, interval: 0 },
      // 10_000 ETH each: Hardhat's default; stated so a Hardhat upgrade cannot change it silently.
      accounts: { count: 20, accountsBalance: "10000000000000000000000" },
    },
  },
  paths: {
    // Keep Hardhat's cache out of the repo tree (it is git-ignored anyway).
    cache: "./.hardhat/cache",
    artifacts: "./.hardhat/artifacts",
    sources: "./.hardhat/no-sources",
  },
};
