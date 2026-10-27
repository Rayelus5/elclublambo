# Developer infrastructure: Arbitrum One vs Base vs Linea (and Sepolia testnets), as of Oct 2026

Research done 2026-10-23/24. Every contract address below was copied from the official source that is cited next to it. If a value was not fetched in this session, it is marked UNVERIFIED or listed under Gaps.

## 1. Chain ids, USDC/EURC addresses, CCTP

### Takeaway
All three chains have Circle-native USDC on mainnet and on Sepolia, and all three support CCTP V2 with Fast Transfer, so USDC can move natively between them. EURC is only on Base (mainnet and Base Sepolia). It is not on Arbitrum or Linea.

### Cited Findings
- Chain ids from the Etherscan V2 chainlist: Arbitrum One 42161, Arbitrum Sepolia 421614, Base 8453, Base Sepolia 84532, Linea 59144, Linea Sepolia 59141 — [Etherscan V2 chainlist](https://api.etherscan.io/v2/chainlist)
- Circle-issued USDC addresses — [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses):
  - Arbitrum mainnet `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
  - Base mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - Linea mainnet `0x176211869cA2b568f2A7D4EE941E073a821EE1ff`
  - Arbitrum Sepolia `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
  - Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - Linea Sepolia `0xFEce4462D57bD51A6A552365A011b95f0E16d9B7`
- Circle's page puts these under "USDC" (Circle-issued). Its only note about bridged USDC.e concerns X Layer, not these three chains. The page does not state decimals — [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- EURC: Base mainnet `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` and Base Sepolia `0x808456652fdb597867f38412077A9182bf77359F`. Arbitrum and Linea do not appear in the EURC list, on either mainnet or testnet — [Circle EURC addresses](https://developers.circle.com/stablecoins/eurc-contract-addresses)
- CCTP domain ids: Arbitrum = 3, Base = 6, Linea = 11. All three are in the main CCTP table, with Standard Transfer, Fast Transfer, Hooks and the Forwarding Service. None of them is in the "V1 (Legacy) only" section — [Circle CCTP supported blockchains](https://developers.circle.com/cctp/cctp-supported-blockchains)

### Inferences
- USDC uses 6 decimals on all three chains, which is the standard for Circle FiatToken. This was not confirmed on the Circle page in this session, so read `decimals()` on-chain before shipping.
- Arbitrum still has a large legacy bridged USDC.e in circulation (from training knowledge, not re-verified). The UI should only accept the native address above and should warn when a user holds USDC.e.
- A EUR-denominated stablecoin is only possible on Base.

### Gaps
- No official confirmation of decimals from Circle on this page.
- The USDC.e address on Arbitrum was not fetched, so it is not listed here on purpose.

## 2. Fees, block times, finality, reorgs

### Takeaway
All three are cheap: well under $0.01 for an ETH transfer or an ERC-20 transfer in normal conditions. Soft confirmation takes about 0.2–2 s on Base, about 1 s on Linea, and is sub-second on Arbitrum. Time to the `finalized` tag differs a lot: about 20 min on Base, up to about 2 h median on Linea, and tied to L1 batch posting plus L1 finality on Arbitrum. For server-side verification of tips and bounties, waiting a few L2 confirmations is enough in practice. `finalized` should only be required for high-value treasury events.

### Cited Findings
- **Base fees:** minimum base fee 5,000,000 wei (0.005 gwei) on mainnet and Sepolia since the Jovian upgrade, and it "may be periodically adjusted". A typical 200k-gas transaction costs about $0.002 at the minimum base fee, assuming ETH = $2,000 (estimate is undated). The L1 security (data) fee is usually higher than the L2 execution fee. You can estimate it with the GasPriceOracle at `0x420000000000000000000000000000000000000F` (`getL1Fee`). Base docs give a 2 s block time — [Base network fees](https://docs.base.org/base-chain/network-information/network-fees)
- **Base finality stages:**
  - Flashblock preconfirmation: about 200 ms, with reorgs "less than 0.001% of the time".
  - L2 block: about 2 s. Only one Base L2 block has ever reorged.
  - L1 batch inclusion: about 2 min.
  - L1 batch finality: about 20 min (more than 2 epochs).
  - Withdrawal window: 5 days on a single proof, or 1 day on the dual-proof (TEE+ZK) fast path since the Beryl upgrade.
  - Source: [Base transaction finality](https://docs.base.org/base-chain/network-information/transaction-finality)
- **Arbitrum One fees and limits:** gas price floor 0.02 gwei per the official chain parameters page. It was 0.01 gwei before ArbOS "Dia" (per a non-official news source). Block gas limit is 30M on Arbitrum One — [Arbitrum chain params](https://docs.arbitrum.io/arbitrum-essentials/reference/chain-params); [Arbitrum config params](https://docs.arbitrum.io/launch-orbit-chain/reference/additional-configuration-parameters)
- **Arbitrum finality:** soft finality comes when the sequencer emits the receipt through its feed. Hard finality "equivalent to that of an ordinary Ethereum transaction" requires at least one honest validator. The roughly one-week challenge period applies only to assertions and withdrawals — [Arbitrum FAQ](https://docs.arbitrum.io/learn-more/faq)
- **Arbitrum block numbers:** `block.number` in Solidity returns an *estimate of the L1 block number*, which updates every 13–15 s. The receipt `blockNumber` is the L2 number and `l1BlockNumber` is the L1 one. Block production depends on usage, and the docs do not state a fixed block time. The roughly 250 ms figure is commonly cited but UNVERIFIED this session — [Arbitrum block numbers and time](https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time)
- **Linea fees:** EIP-1559 model. Use `linea_estimateGas`, because the priority fee includes a data-cost component plus a fixed 0.03 gwei infrastructure cost. A minimum gas price applies to all transactions — [Linea gas fees](https://docs.linea.build/network/how-to/gas-fees)
- **Linea finality:**
  - Soft finality takes about 1 s (the block time), and "it will not be removed or reordered by Linea".
  - Hard finality needs the ZK proof verified on L1 and that L1 block finalized. The current median is about 2 h, the target is under 30 min, and it "should never exceed 16 hours".
  - The `finalized` RPC tag points at the latest hard-finalized block. It is supported on mainnet and Sepolia, except for `eth_call` (per the how-to page).
  - Sources: [Linea transaction finality](https://docs.linea.build/network/overview/transaction-finality); [Linea finalized block](https://docs.linea.build/network/how-to/finalized-block)
- **L2BEAT maturity:** Arbitrum One is Stage 1 (optimistic). Base is Stage 1 (OP Stack). Linea is Stage 0 (ZK rollup). The page was undated and fetched 2026-10-23 — [L2BEAT summary](https://l2beat.com/scaling/summary)

### Inferences
- **Estimated ETH transfer cost on Arbitrum at the floor:** 21,000 gas × 0.02 gwei = 4.2e-7 ETH, which is well below $0.01. ERC-20 transfers use about 45–65k gas, so they cost about 2–3× more. These are my calculations, not quoted figures.
- **Estimated ETH transfer cost on Base at the minimum base fee:** 21k gas is about $0.0002 of L2 fee, plus the L1 data fee. The total is still sub-cent.
- **In viem, `waitForTransactionReceipt({ confirmations })`** using L2 blocks gives fast UX. Server-side verification should re-read the receipt by hash and check `status`, the `to` address and the decoded Transfer log. Polling for the `finalized` tag before marking a payment "final" adds about 20 min on Base and about 2 h on Linea.

### Gaps
- No live 2026 median fees per chain: growthepie did not render chain values, and its page was last updated 2026-10-23.
- The official Arbitrum block time and time-to-`finalized` were not documented on the pages fetched.

## 3. Safe{Wallet}

### Takeaway
Arbitrum and Base have full Safe support (deployments, Transaction Service, app.safe.global). Linea has been on app.safe.global since Safe's official launch post, but its Transaction Service listing and gas-sponsorship coverage could not be confirmed this session.

### Cited Findings
- Safe's API supported-networks list shows Transaction Service hosts for Arbitrum and Base. In the search snippet, no Linea host appeared — [Safe API supported networks](https://docs.safe.global/api-supported-networks) (a direct fetch returned only a partial list, so this is unconfirmed)
- Safe announced that "Safe{Wallet} and Safe{Core}" are live on Linea and selectable on app.safe.global, mobile app included. The post is undated, probably 2024. The old safe.linea.build fork was being sunset — [Safe blog: Safe now live on Linea](https://safe.global/blog/safe-now-live-on-linea)
- Safe's gas FAQ (updated 2026-04-13) says gas abstraction is rolling out on Ethereum, Base, BNB and Arbitrum. Linea is not named — [Safe gas FAQ](https://help.safe.global/articles/9993850744-safewallet-gas-fees-faq)
- Gelato gas sponsorship covers Arbitrum, Optimism, Base, Polygon zkEVM, Gnosis and Polygon. Linea is not listed — [Safe sponsorship](https://help.safe.global/articles/6461820093-gas-fee-sponsorship-on-safe-transactions)

### Inferences
- The same Safe address can exist on several chains if the Safe is deployed with the same factory, singleton, owners, threshold and salt nonce. Safe{Wallet} offers "add another network" for this. This is from training knowledge and was not re-verified.
- Safe addresses are counterfactual, so a Safe deployed on one chain is not deployed on another until someone actually deploys it there.

### Gaps
- The Safe client-gateway chain config (safe-client.safe.global) returned 403, so Transaction Service URLs for Linea and Linea Sepolia, and Safe UI support for Arbitrum Sepolia, Base Sepolia and Linea Sepolia, are UNVERIFIED.

## 4. Oracles and randomness (raffles)

### Takeaway
Chainlink Data Feeds (ETH/USD, USDC/USD) exist on all three chains. Chainlink VRF v2.5 is on Arbitrum and Base (mainnet and Sepolia) but not on Linea. On-chain randomness opcodes are weak on all three: on Arbitrum `prevrandao` is the constant 1, on Base it is a lagged L1 value, and on Linea it is a sequencer-derived value. A commit-reveal raffle must not rely on blockhash or prevrandao alone.

### Cited Findings
- **Chainlink Linea mainnet:** ETH/USD proxy `0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA` (heartbeat 86400 s, deviation 0.5%, 8 decimals). USDC/USD proxy `0xAADAa473C1bDF7317ec07c915680Af29DeBfdCb5` (86400 s, 0.3%, 8 decimals) — [Chainlink reference data directory, Linea](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-linea-1.json)
- **Chainlink Base mainnet:** ETH/USD proxy `0x50015f8b17fb2C290Dde41fDc246ed0dcEE93a8b` (path eth-usd-shared-svr-2, 1200 s, 0.15%, 8 decimals). USDC/USD proxy `0x458138Fc0D67027E9A6778ef40a6ffC318c69061` (path usdc-usd-svr, 86400 s, 0.3%, 8 decimals). There is also a non-SVR USDC/USD at `0x68bE4C50235205Ede361ac8244B1ee221CDDA5E2` — [Chainlink RDD, Base](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json). The "svr" paths are Smart Value Recapture variants, so check on docs.chain.link which feed is recommended for reads.
- **Chainlink VRF v2.5:**
  - Supported on Arbitrum mainnet, Arbitrum Sepolia, Base mainnet and Base Sepolia. Linea is not listed.
  - Coordinators: Arbitrum `0x3C0Ca683b403E37668AE3DC4FB62F4B29B6f7a3e`, Base `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634`.
  - Source: [Chainlink VRF supported networks](https://docs.chain.link/vrf/v2-5/supported-networks)
- **Pyth Entropy:** fees are dynamic (`getFeeV2()`), and the provider reveals after a per-chain block delay to protect against reorgs. The per-chain table did not render, so deployment on each of the three chains is unconfirmed here — [Pyth Entropy chainlist](https://docs.pyth.network/entropy/chainlist)
- **Arbitrum opcodes:**
  - `blockhash` "Returns a cryptographically insecure, pseudo-random hash", and the docs say L2 block hashes "should not be relied on as a secure source of randomness".
  - `block.prevrandao` and `block.difficulty` return "the constant 1".
  - `block.coinbase` is `0xA4b000000000000000000073657175656e636572` for sequencer messages.
  - Source: [Arbitrum Solidity support](https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/solidity-support)
- **OP Stack / Base opcodes:** PREVRANDAO returns the L1 RANDAO value "at the current L1 origin block". COINBASE is the sequencer fee wallet — [Optimism differences](https://docs.optimism.io/stack/differences)
- **Linea opcodes and EVM differences:**
  - PREVRANDAO: the docs say "Use a formula similar to Ethereum, e.g. `L2_prevrandao XOR hash(signed(slot_id))`". Older docs said it returned a fixed value of 2.
  - BLOCKHASH "Returns the correct value, but the value is not guaranteed by the proof".
  - BLOBHASH returns 0.
  - No type-3 (blob) transactions.
  - MODEXP is limited to 1024-byte arguments.
  - Precompiles cannot be a transaction `to`.
  - Linea upgraded to the Fusaka fork in Beta v4.4.
  - Source: [Linea Ethereum differences](https://docs.linea.build/network/overview/ethereum-differences)

### Inferences
- On all three chains, a single centralized sequencer chooses ordering and block contents. On Base, the L1-origin PREVRANDAO is known ahead of time. On Arbitrum it is constant. On Linea it is derived by the sequencer. Each of these is predictable or influenceable by the sequencer and visible to users before inclusion.
- For verifiable raffles, there are two sound options:
  - Use VRF, on Arbitrum or Base only.
  - Use commit-reveal where the seed is `hash(serverSecretCommittedEarlier ‖ futureBlockHash or L1 data)` and the server commitment is published before entries close. Even then, the sequencer could theoretically grind the blockhash, so include a secret that is committed before entries close.

### Gaps
- Chainlink Arbitrum ETH/USD and USDC/USD proxy addresses were not extracted (the file was truncated), so take them from docs.chain.link.
- Pyth Entropy addresses per chain were not obtained.

## 5. Wallets, AA, paymasters, EIP-7702

### Takeaway
EIP-7702 is live on all three chains: Arbitrum since ArbOS 40 "Callisto" (2025), Base since Isthmus (2025-05-09), Linea since Beta v5.0. Base Account (the Coinbase smart wallet) supports Arbitrum and Base but not Linea. CDP Paymaster only works on Base and Base Sepolia, so other chains need Pimlico, Alchemy or another ERC-7677 provider.

### Cited Findings
- Arbitrum ArbOS 40 "Callisto" brings Pectra execution-layer EIPs to Arbitrum One and Nova, including EIP-7702. The governance proposal was executed — [Arbitrum forum AIP](https://forum.arbitrum.foundation/t/constitutional-aip-arbos-version-40-callisto/28436); [Tally](https://tally.xyz/gov/arbitrum/proposal/13108804573775967668959825241666341617107666532012387058509418598838035461528)
- Base Isthmus activated on mainnet 2025-05-09 16:00:01 UTC and on Sepolia 2025-04-17. It includes EIP-7702, 2537, 2935 and 7623 — [Base Isthmus overview](https://docs.base.org/base-chain/specs/upgrades/isthmus/overview.md)
- "Linea supports EIP-7702 type `0x04` transactions as of Beta v5.0" — [Linea differences](https://docs.linea.build/network/overview/ethereum-differences)
- CDP Paymaster supports only Base Mainnet and Base Sepolia. For other chains, use any ERC-7677 paymaster with CDP Smart Accounts. The networks reference shows Paymaster unavailable on Arbitrum — [CDP Paymaster](https://docs.cdp.coinbase.com/paymaster/introduction/welcome.md); [CDP networks](https://docs.cdp.coinbase.com/api-reference/networks)
- Base Account has full support on Base, Arbitrum, Optimism, Zora, Polygon, BNB, Avalanche and Ethereum. Its testnets are Base Sepolia and Sepolia. Linea is not listed — [Base Account docs](https://docs.base.org/base-account/overview/what-is-base-account.md)
- The MetaMask Smart Accounts Kit lists Linea and Arbitrum One among its supported mainnets — [MetaMask Smart Accounts Kit networks](https://docs.metamask.io/smart-accounts-kit/1.7.0/get-started/supported-networks.md)

### Inferences
- MetaMask, OKX Wallet and Rabby are EOA wallets that work on any EVM chain. They can add a chain via `wallet_addEthereumChain`, and MetaMask ships Linea as a built-in network because Consensys builds both. These are training-knowledge claims, not re-verified.
- viem and wagmi export `arbitrum`, `arbitrumSepolia`, `base`, `baseSepolia`, `linea` and `lineaSepolia`, and Reown AppKit accepts any viem chain. This is training knowledge and should be checked against the project's installed `viem/chains`.
- Alchemy's Smart Wallets supported-chains page exists ([Alchemy](https://www.alchemy.com/docs/docs/wallets/supported-chains.md)), but its coverage of Linea was not fetched.

### Gaps
- Exact Pimlico and Alchemy paymaster coverage for Linea and Linea Sepolia was not verified.
- No authoritative Reown page was fetched.

## 6. RPC, explorers, indexers

### Takeaway
The Etherscan V2 API covers all six networks with one key, but **Base and Base Sepolia require a paid plan** (shown as "Paid Plan required"). Arbitrum and Linea are "Free-tier available". This is a concrete cost difference.

### Cited Findings
- Etherscan V2 chainlist (all status 1 "Ok"):
  - Arbitrum One and Arbitrum Sepolia: "Free-tier available", explorers arbiscan.io and sepolia.arbiscan.io.
  - Base and Base Sepolia: "Paid Plan required", explorers basescan.org and sepolia.basescan.org.
  - Linea and Linea Sepolia: "Free-tier available", explorers lineascan.build and sepolia.lineascan.build.
  - Source: [Etherscan V2 chainlist](https://api.etherscan.io/v2/chainlist)
- On 2025-11-22, Etherscan cut free-tier chain coverage by about 10% and added a cheaper "Lite" plan. Verified-contract endpoints (source, ABI, verification) stay free on all chains — [Etherscan KB](https://kb.etherscan.com/whats-changing-in-the-free-api-tier-coverage-and-why)

### Inferences
- For Base, the app can avoid Etherscan by using RPC `eth_getTransactionReceipt` plus logs, which is enough for verifying tips and bounties. Blockscout (base.blockscout.com) is a free alternative explorer, but this was not verified this session.

### Gaps
- Public RPC URLs and rate limits for each chain, and Alchemy, Infura and QuickNode free-tier coverage, were not fetched. DexScreener and CoinGecko support for all three is widely known but was not re-verified this session.

## 7. Naming

### Takeaway
Basenames (`*.base.eth`) are ENS-native (ENSIP-19) and already demonstrate L2 primary names on Arbitrum, Base, Linea, OP and Scroll. Linea has `*.linea.eth` subnames through names.linea.build. Arbitrum has no native naming service of its own beyond ENS reverse records under ENSIP-19.

### Cited Findings
- Basenames follow ENSIP-19. Resolve them with viem `getEnsName` and the Base coin type. Resolution is delayed after registration while state proofs are generated. Resolution uses an L1 resolver with CCIP-Read to a Base gateway — [Base docs: Basenames with wagmi](https://docs.base.org/base-account/framework-integrations/wagmi/basenames.md)
- ENS: L2 primary names can appear when connected to Arbitrum, Base, Linea, OP Mainnet or Scroll — [ENS blog: L2 primary names](https://ens.domains/blog/post/l2-primary-names)
- ENS governance executable: reverse namespaces `8000a4b1.reverse` for Arbitrum and `80002105.reverse` for Base, with reverse resolvers listed. This is a draft or executable proposal, so verify the addresses before use — [ENS forum](https://discuss.ens.domains/t/executable-enable-l2-reverse-registrars-and-new-eth-registrar-controller/20969)
- linea.eth subnames are registered and managed at names.linea.build, not in the ENS app, and can be set as primary on mainnet ENS — [ENS support](https://support.ens.domains/en/articles/11549790-how-can-i-get-and-manage-a-linea-eth-subname)

### Inferences
- Multichain name display: resolve with viem `getEnsName({ address, coinType: toCoinType(chainId) })` against an Ethereum mainnet client, and fall back to the mainnet primary name. This works for all three chains.

### Gaps
- The current official Base L2 resolver address could not be confirmed, because third-party sources give conflicting addresses.

## 8. Supabase Auth Web3 (SIWE)

### Takeaway
Supabase `signInWithWeb3({ chain: 'ethereum' })` accepts **any positive integer chain id**, so Arbitrum, Base and Linea ids all pass. One Supabase user maps to one address regardless of chain. Domain and URI are checked against the Redirect URLs allow-list, and the message must be issued within 10 minutes.

### Cited Findings
- Validation steps: message structure, signature, timestamp ("created within 10 minutes"), and URI and domain against the project's Redirect URLs (the trailing slash matters, or use a glob). The example config `web3 = 30` limits Web3 logins per 5 minutes per IP. CAPTCHA is recommended. Accounts have no email or phone, so identities can be linked later — [Supabase Auth Web3](https://supabase.com/docs/guides/auth/auth-web3)
- In the parser source, the `Chain ID` line is rejected only if `!isValidEthereumNetwork(value)`. That helper parses an int and returns true when it is greater than 0, citing EIP-155. Chain ID is *optional*: if the line is absent, there is no error. Version must be "1", and Issued At and URI are required. Nonce is not checked for presence by the parser — [supabase/auth parser.go](https://raw.githubusercontent.com/supabase/auth/master/internal/utilities/siwe/parser.go); [helpers.go](https://raw.githubusercontent.com/supabase/auth/master/internal/utilities/siwe/helpers.go)

### Inferences
- There is no multichain limitation. The SIWE chainId is informational, so the app should not treat it as the chain where tips happen. The identity is the address, which is the same on all EVM chains. Smart-contract wallets (Base Account, Safe) sign via ERC-1271/6492, and whether Supabase verifies those signatures (EOA-only ecrecover?) was not verified. That is important for Base Account users.

### Gaps
- Supabase support for ERC-1271 or ERC-6492 smart-wallet signatures is unknown.

## 9. Chain-specific gotchas (summary)

### Takeaway
- **Arbitrum:** `block.number` is the L1 block number, `prevrandao` is 1, and there is legacy USDC.e.
- **Base:** the Etherscan API needs a paid plan, but CDP Paymaster, Base Account and EURC are Base-native advantages.
- **Linea:** no VRF, no Base Account, no CDP paymaster, no EURC. Safe sponsorship is uncertain, it is Stage 0, and hard finality is slow (about 2 h median). Use `linea_estimateGas`, and note there are no blob transactions and MODEXP limits.

### Cited Findings
- Arbitrum: `block.number` returns an estimate of the L1 block number — [Arbitrum docs](https://docs.arbitrum.io/build-decentralized-apps/arbitrum-vs-ethereum/block-numbers-and-time)
- Base: Etherscan needs a paid plan — [Etherscan chainlist](https://api.etherscan.io/v2/chainlist). Base has the only CDP Paymaster coverage — [CDP](https://docs.cdp.coinbase.com/paymaster/introduction/welcome.md)
- Linea: no VRF — [Chainlink VRF](https://docs.chain.link/vrf/v2-5/supported-networks). Stage 0 — [L2BEAT](https://l2beat.com/scaling/summary). EVM differences — [Linea](https://docs.linea.build/network/overview/ethereum-differences)

### Inferences
- **Recommendation signal:** Base plus Arbitrum covers VRF raffles, Safe with sponsorship, Base Account, CDP gas sponsorship (Base) and EURC (Base). Linea mainly adds MetaMask-native users (Consensys) and free Etherscan access. It is a reasonable third chain only if MetaMask/Linea user acquisition matters, and raffles there would need commit-reveal or a non-Chainlink RNG.

### Gaps
- Pyth Entropy on Linea, if it exists, would close the randomness gap. Its availability is unverified.
