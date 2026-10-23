# Multichain architecture for ElClub. on-chain features (Arbitrum One, Base, Linea), as of 2026-10

Research date: 2026-10-23. Every claim below carries a source. Where a date matters it is noted. All "Inferences" are this researcher's reasoning, not sourced facts.

## Tips and bounties: chain choice, chain_id per record, replay protection, finality, fees, and what products do

### Takeaway
Storing `chain_id` on every on-chain record and making `(chain_id, tx_hash, log_index)` the uniqueness key is the standard, low-risk way to accept tips and bounty payouts on several L2s. The hard part is finality: each L2 has `latest`/`safe`/`finalized` levels with very different latencies (Linea about 2 s soft, hours hard; Arbitrum about 12-15 min to L1 finality). Most social-payment products (Farcaster/Warpcast, Bountycaster) dodged multichain by standardizing on Base.

### Cited Findings
- **Arbitrum finality tiers.** Arbitrum has three tiers: soft (`latest`, sequencer), parent-chain `safe`, and parent-chain `finalized`. Hard finality depends on the batch landing on L1, about 12-15 min to parent-chain finality. L1 withdrawals wait for BoLD challenge periods of days, which is a separate question from deposit confirmation. — [Arbitrum docs: Finality and reorgs](https://docs.arbitrum.io/how-arbitrum-works/reference/finality-and-reorgs)
- **Linea finality.** Soft finality is reached in about 2 s and Linea says it does not reorg after that point. Hard finality needs the batch's ZK proof verified on Ethereum and that L1 block finalized. Linea says CEX deposits should wait for hard finality via the `finalized` RPC tag. Median time to hard finality was under 1 h 40 min in Dec 2025, with a stated expectation of falling toward about 30 min. — [Linea docs: Transaction finality](https://docs.linea.build/network/overview/transaction-finality)
- **Base (OP Stack) finality.** `latest` can reorg, `safe` is tied to an L1 batch submission, and `finalized` is effectively irreversible. This comes from a third-party guide only; I did not find Base's official page. — [OnFinality guide](https://onfinality.io/en/learn/base-op-stack-finality-safe-finalized-blocks-rpc)
- **Circle on confirmations.** Circle Wallets waits for "each blockchain's standard confirmation threshold" and says confirmation times vary by chain. The page gives no per-chain numbers. — [Circle: blockchain confirmations](https://developers.circle.com/w3s/blockchain-confirmations)
- **Farcaster in-app payments.** At launch, Farcaster's in-app USDC payments used only USDC on Base. Other apps in the ecosystem could support other chains. — [The Block](https://www.theblock.co/post/302665/farcaster-is-getting-in-app-usdc-payments)
- **Bountycaster.** It supports "USDC & ETH for payments, as well as a number of other tokens on Base like DEGEN, Higher, and Moxie" — [Base Directory newsletter](https://paragraph.xyz/@basedirectory/19-built-on-base-🔥). Bankless lists payouts in ETH, SOL, USDC, OP, DEGEN and Warps, which suggests settlement happens peer-to-peer outside the app. This is a single, unclear source. — [Bankless](https://www.bankless.com/de/get-started-with-bountycaster)
- **Gitcoin.** Allo moved from Ethereum-only to many EVM networks (Optimism, Arbitrum, Base, Polygon, zkSync, Scroll, Avalanche…). Grants Stack had a "multichain checkout" feature. However, Gitcoin Labs and Grants Stack wound down in May 2025 and Allo is in maintenance mode, so this precedent is historical. — [Gitcoin: Allo Protocol](https://www.gitcoin.co/apps/allo-protocol); [Gitcoin Grants Stack](https://gitcoin.co/apps/gitcoin-grants-stack)
- **Relay fees (reference for any "pay from any chain" tip flow).** Execution fee is a $0.02 flat fee plus a destination gas estimate. The Relay fee is 0.01% for stablecoin swaps and 0% for token bridges. Integrators can add an "app fee". — [Relay docs: fees](https://docs.relay.link/references/api/api_core_concepts/fees)

### Inferences
- **Data model.**
  - Put `chain_id` on `tips`, `bounty_payouts`, `donations` and `withdrawals`.
  - Add a unique constraint on `(chain_id, tx_hash, log_index)`. `tx_hash` alone is almost certainly unique across chains, but the composite key is explicit and cheap.
  - Verify on the server with a per-chain viem `publicClient`, using a server-side RPC per chain and never trusting a chain_id sent by the client.
  - Check that the token address is the canonical USDC for that chain_id, using an allow-list per chain.
- **Finality policy.**
  - Record the tip as "pending" on receipt at `latest` (good UX).
  - Mark it "confirmed" when the block is `safe` or `finalized`, via a cron that re-checks receipts and catches reorgs/drops.
  - For tips, soft finality is acceptable for display. For treasury share minting (money with redemption rights), require `finalized`, or at least `safe` plus N minutes.
- **Platform fee.** Two-transfer tips (one to the recipient, one to the fee wallet) must happen on the same chain. The fee wallet should be an EOA, or a Safe deployed at the same address on all three chains (see the treasury section). Verify both Transfer logs in the same tx (batch/multicall or EIP-5792 `wallet_sendCalls`), or accept two txs and link them.
- **Bounties.** The author promises and later pays via a tip, so the bounty record only needs the payout tip's `(chain_id, tx_hash)`. The bounty itself can stay chain-agnostic (denominated in USD/USDC). Letting the payer pick the chain is low risk because no contract or escrow is involved.

### Gaps
- No primary-source documentation found for how Warpcast tips, Zora, Dework, Layer3, Questbook or Superfluid handle multichain payments. Only Farcaster's Base-only launch is sourced. Superfluid is deployed on many chains, but streams are per-chain (not verified in this session).
- No official Base finality doc retrieved. No published exchange confirmation counts for Base/Arbitrum/Linea found.

## Treasury: one Safe per chain vs a home chain plus bridging; Safe multichain; NAV aggregation; reconciliation; DAO prior art; chain abstraction

### Takeaway
Two realistic designs:

- **(A) One home-chain Safe** (e.g., Base or Arbitrum). Donations arriving from other chains are converted into it via CCTP v2 or an intent bridge (Relay/Across). NAV and reconciliation stay single-chain and simple.
- **(B) The same Safe address deployed on all three chains** via CREATE2. NAV is the sum of per-chain balances, so reconciliation and admin operations are tripled.

The Wintermute incident shows the main risk of any multichain Safe setup: funds sent to a Safe address on a chain where it is not deployed. If you choose design A, either deploy the Safe on the other chains anyway as a safety net, or block sends on other chains in the UI.

### Cited Findings
- **Safe multichain deployment.** Safe{Wallet} lets you reserve and deploy the same Safe address on multiple networks at once, and add a network to an existing Safe later.
  - The new network gets the initial owners, threshold and modules. Changes made after the original deployment are not carried over.
  - Safes on singleton 1.0.0/1.1.1/1.2.0 cannot be replayed.
  - Some Safes created outside Safe{Wallet} may not be compatible.
  - — [Safe Help Center: Deploying a multi-chain Safe](https://help.safe.global/articles/9317165368-deploying-a-multi-chain-safe)
- **Address determinism.** It relies on CREATE2 via the Safe Proxy Factory. The address is identical only if factory, singleton, salt, initializer calldata and proxy bytecode are all identical. — [Safe docs: multichain deployment](https://docs.safe.global/advanced/smart-account-multi-chain-deployment); [Protocol Kit guide](https://docs.safe.global/sdk/protocol-kit/guides/multichain-safe-deployment)
- **Wintermute post-mortem (June 2022).**
  - Wintermute gave the Optimism Foundation the address of an L1 Gnosis Safe that was not deployed on Optimism.
  - It confirmed test transfers (1 OP, then 1M OP) without checking access, and 20M OP were sent.
  - An attacker deployed a contract at that address on L2 "with different initialization parameters" before Wintermute could, and took the tokens.
  - That attack exploited the old non-chain-bound proxy factory/replay. Current Safe CREATE2 binds the address to the initializer, as noted above.
  - — [Forklog](https://forklog.com/en/unknown-hacker-steals-20-million-op-tokens-due-to-wintermutes-market-maker-error/); [rekt.news](https://rekt.news/wintermute-rekt); [DappRadar](https://dappradar.com/blog/optimism-loses-20-million-op-tokens-in-embarrassing-tech-mishap)
- **CCTP V2.** Fast Transfer takes about 8-20 s. Standard Transfer takes about 15-19 min on Ethereum and L2s. For USDC the fee is deducted from the transferred amount. "Hooks" can trigger actions on the destination after arrival. V1 is legacy. — [Circle CCTP docs](https://developers.circle.com/cctp)
- **CCTP V2 on Linea.** On 2025-03-16 Circle upgraded Linea's Bridged USDC Standard in place to native USDC (every USDC.e balance became native USDC, with no migration) and "immediately deployed CCTP V2 on Linea". — [Circle case study: Linea](https://www.circle.com/case-studies/linea)
- **Circle Gateway.** A unified USDC balance across chains, with transfers in under 500 ms once the balance is established, signature-based authorization and a 7-day trustless withdrawal. — [Circle Gateway docs](https://developers.circle.com/gateway)
  - Mainnet chains at launch (Aug 2025) per a third party: Arbitrum, Avalanche, Base, Ethereum, OP, Polygon PoS, Unichain. **Linea not listed.** — [Eco support article](https://eco.com/support/en/articles/12068992). No official 2026 chain list retrieved.
- **Relay deposit addresses.** The user sends funds from any network to a designated address and Relay delivers the destination token/chain without a wallet connection.
  - An address is reusable while origin currency, origin chain, destination currency and destination chain stay the same.
  - The payments product accepts any asset on 85+ chains and settles in e.g. USDC on Base.
  - If the minimum rate cannot be met, the deposit is refunded.
  - — [Relay: deposit addresses](https://docs.relay.link/features/deposit-addresses); [Relay: payment service providers](https://docs.relay.link/solutions/payment-service-providers); [Relay fees](https://docs.relay.link/references/api/api_core_concepts/fees)
- **Juicebox v4 omnichain model.**
  - Each chain gets its own project instance with its own ID, linked by "sucker" contracts.
  - Users burn project tokens on one chain and mint on another, moving the backing funds across the bridge.
  - Claims use merkle proofs (Juicerkle service).
  - V4 runs on Ethereum, Arbitrum, Base and OP Mainnet.
  - Sources are secondary/unofficial: [Gitcoin app listing](https://gitcoin.co/apps/juicebox); [Bananapus/juicerkle](https://github.com/Bananapus/juicerkle); [suckers package](https://mcp.depscope.dev/pkg/npm/@bananapus/suckers-v6)

### Inferences
- **Recommendation for a 2-of-3 Safe with off-chain share accounting:** design A (home chain), with the Safe also deployed at the same address on the other two chains as a "catch net".
  - Shares are minted only for donations verified on the home chain, or for donations arriving via Relay/CCTP into the home Safe, where the server verifies the final Transfer log on the home chain.
  - Anything that lands on the catch-net Safes is recoverable by the same signers and can be bridged and credited manually by admins.
  - Deploy all three Safes before announcing the address, with identical owners/threshold. Note that later owner changes must be replicated per chain.
- **Design B (multi-Safe).**
  - NAV = Σ over chains (USDC balance + ETH balance × price).
  - Snapshots must store per-chain balances.
  - Reconciliation compares the off-chain ledger per chain vs on-chain per chain.
  - Withdrawals need a rule for which chain pays out, which raises liquidity fragmentation: a member asks for 100 USDC on Linea but the Linea Safe holds only 20.
  - Every admin action needs 2-of-3 signatures per chain.
- **Avoid crediting shares on intent-bridge quotes.** Credit on the received amount (Relay can deliver less than quoted, but at least the minimum).
- **Juicebox's sucker model is an omnichain token design, not a fit.** ElClub's shares are off-chain, which makes design A even simpler. No need for bridgeable share tokens.

### Gaps
- No primary sources found on how Nouns forks, Party Protocol or Gnosis/Safe DAOs operationally manage multichain treasuries. The Safe{Core} "multichain" UX facts above are what is confirmed.
- No retrieved list of LI.FI, Across, Socket or Particle fees and chains. Only Relay was checked.
- Official CCTP V2 per-chain Fast Transfer support for Linea is not confirmed (Circle says V2 was deployed on Linea; Fast Transfer availability per chain not retrieved).

## Raffles: is L2 blockhash safe enough; Chainlink VRF v2.5, Pyth Entropy, drand availability and cost

### Takeaway
On Arbitrum, the official docs say L2 block hashes "should not be relied on as a secure source of randomness" and `prevrandao` is constant 1. Base and Linea are also single-sequencer chains, so blockhash is sequencer-influenceable there too (inference).

For a raffle decided off-chain but publicly verifiable, **drand quicknet** is the best fit: chain-agnostic, free, 3 s rounds, verifiable off-chain with existing libraries. The scheme: commit hash(seed) plus a future drand round number at creation, then winner = keccak(seed ‖ drand_randomness(round)) mod total_weight.

On-chain VRFs (Chainlink VRF v2.5: Arbitrum and Base, **not Linea**; Pyth Entropy: Arbitrum and Base, Linea not confirmed) only make sense if the raffle settles in a contract.

### Cited Findings
- **Arbitrum randomness primitives.** `blockhash(x)` "Returns a cryptographically insecure, pseudo-random hash"; "The returned hashes do not come from the parent chain"; `block.difficulty`/`block.prevrandao` "Returns the constant 1"; "⚠️ Arbitrum's child chain block hashes should not be relied on as a secure source of randomness." — [Arbitrum docs: Solidity support](https://docs.arbitrum.io/solidity-support)
- **Chainlink VRF v2.5 mainnets** (subscription and direct funding): Arbitrum, Avalanche, Base, BNB, Ethereum, OP, Polygon, Ronin, Soneium. **Linea is not listed.** Premium on Arbitrum/Base is 60% (native) or 50% (LINK); on Ethereum it is 24%/20%. — [Chainlink VRF supported networks](https://docs.chain.link/vrf/v2-5/supported-networks) (retrieved 2026-10-23)
- **Pyth Entropy fees.** OP-PIP-94 covers protocol fees on 19 EVM chains including Arbitrum and Base (Linea not in that list).
  - Q1 2026: 0.000003 ETH (~$0.01) on Arbitrum/Base.
  - Q2 2026 proposal: 0.000005 ETH.
  - Q3 2026 proposal: 0.00001 ETH (~$0.018).
  - The adoption status of the Q2/Q3 proposals was not verified.
  - — [Pyth forum Q1 2026](https://forum.pyth.network/t/q1-2026-pyth-entropy-onchain-fees/2317); [Q2 2026](https://forum.pyth.network/t/q2-2026-pyth-entropy-onchain-fees/2463); [Q3 2026](https://forum.pyth.network/t/q3-2026-pyth-entropy-protocol-fee-adjustments/2637); [OP-PIP-94](https://forum.pyth.network/t/passed-op-pip-94-q1-2026-entropy-protocol-fee-implementation/2347)
- **drand.**
  - The League of Entropy has run quicknet since 2023 (BLS12-381). evmnet, launched 2024, uses BN254 for broader chain compatibility, and there is "no plan to wind it down while there's interest".
  - On-chain verification gas: about 159k (BN254) or about 131k (BLS12-381 uncompressed, needs EIP-2537).
  - The demo verifier contract is unaudited and not for production.
  - — [drand blog, 2025-08-26](https://docs.drand.love/blog/2025/08/26/verifying-bls12-on-ethereum)
- **Quicknet parameters.** 3 s rounds, unchained mode, signatures on G1. — [DIA docs: randomness](https://www.diadata.org/docs/dia-stack/architecture/data-sources/randomness)
- **Off-chain verification.** The Rust crate drand-verify verifies a round signature against the League's public key and compiles to JS/Wasm. — [docs.rs drand-verify](https://docs.rs/crate/drand-verify/latest)
- **Community verifiers.** MegaETH ships a stateless DrandOracleQuicknet verifier (`verifyNormalized(round, sig)`) — [MegaETH docs](https://docs.megaeth.com/developer-docs/vrf). A non-affiliated "future-drand" contract exists — [github.com/future-drand](https://github.com/future-drand)

### Inferences
- **The current design is weak on an L2.** keccak(seed ‖ blockhash of first block after close) depends on a sequencer-produced blockhash. The server also knows the seed, so a colluding operator who controls neither the sequencer nor the timing has limited power, but the sequencer could grind. More practically, the operator can choose when to "close", which matters if close time is not fixed.
- **drand fixes this:**
  - At creation, publish `commit = keccak(seed)` and `target_round = round_at(close_time) + k`.
  - Since drand rounds are time-deterministic, nobody, including the server, knows the randomness in advance.
  - Anyone can fetch round `target_round` from the public HTTP API (api.drand.sh or mirrors) and verify the BLS signature with drand-verify or drand-client.
  - The result is chain-agnostic and identical regardless of which L2 the raffle's tickets were paid on.
  - Cost: $0.
  - Trust assumption: the League threshold, not a sequencer or a single oracle.
- **VRF/Entropy would require deploying a raffle contract per chain** and paying per request. Linea lacks Chainlink VRF v2.5, which breaks uniformity across the three target chains.

### Gaps
- Pyth Entropy's current support for Linea was not confirmed either way.
- The exact drand quicknet chain hash and public key were not retrieved in this session; fetch them from docs.drand.love before implementing.

## Polls weighted by treasury shares across chains

### Takeaway
Because shares are off-chain (Postgres), poll weights are chain-agnostic by construction. Snapshot the share table at poll creation, regardless of which chain each donation came from. Multichain only matters if shares were tokenized per chain.

### Cited Findings
- **Juicebox contrast.** Omnichain projects keep a separate project/token per chain linked by suckers. Voting power there would be fragmented across chains unless aggregated. — [mcp.directory jb-project (unofficial)](https://mcp.directory/skills/jb-project); [Gitcoin app listing](https://gitcoin.co/apps/juicebox)

### Inferences
- **Keep shares per member, not per chain.** Store the originating donation `chain_id` only for audit. Snapshot `member_id → shares` at poll creation (as already designed).
- **Count only finalized donations.** If you adopt design B (per-chain Safes), include only donations at `finalized` status in snapshots, so a reorged L2 deposit can't inflate votes.

### Gaps
- No external prior art researched for off-chain share-weighted polls across chains. Snapshot.org's multichain strategies were not checked in this session.

## SIWE across chains and smart-contract wallets (EIP-1271, ERC-6492, Coinbase Smart Wallet / Base Account)

### Takeaway
One identity equals one address. The SIWE `chain-id` field binds the session to one chain, but the address is the same EOA on all EVM chains. Smart wallets are the catch:

- Signatures must be verified with an RPC client of a specific chain (ERC-1271 `eth_call`). The wallet may be undeployed (ERC-6492 wrapper) or have different owners/keys on another chain.
- Verify each SIWE signature against the chain in the message's `chain-id`, using viem's `verifySiweMessage`/`verifyMessage` with a `publicClient`.
- Treat the account address as the identity, but remember a smart wallet's signers are per-chain state.

### Cited Findings
- **Coinbase Smart Wallet signatures.** They include an ERC-6492 wrapper when the wallet is undeployed, and viem's `verifyMessage` handles it automatically. Smart wallet addresses are deterministic, which enables signature verification before deployment. — [Base docs: signing and verifying messages](https://docs.base.org/identity/smart-wallet/guides/signing-and-verifying-messages)
- **ERC-6492 verification order.** Check the magic suffix `0x6492…6492` first (run the factory calldata via `eth_call`, then `isValidSignature`), then ERC-1271 if code exists, then `ecrecover`. 1271 must come before ecrecover.
  - The spec warns about cross-network replay: a signature later invalidated (e.g., by key rotation) on one chain may still validate on another network where the wallet can be deployed with the same factory/bytecode. It recommends replay protection.
  - — [EIP-6492](https://eips.ethereum.org/EIPS/eip-6492)
- **Passing a PublicClient matters.** Dynamic's docs say that when you pass a PublicClient, viem automatically validates contract-wallet signatures via ERC-1271 — [Dynamic docs](https://www.dynamic.xyz/docs/javascript/reference/evm/validate-signatures). A community viem SIWE guide warns not to rely on a bare `verifyMessage` (which only works for EOAs) and to use a PublicClient with `verifySiweMessage` — [viem-siwe skill guide](https://cdn.jsdelivr.net/gh/melonask/viem-siwe-skills@main/SKILL.md)
- **Better Auth's SIWE plugin** requires a positive Chain ID in the signed message and validates it. — [Better Auth SIWE docs](https://better-auth.com/docs/plugins/siwe.md)

### Inferences
- **Server-side SIWE verification:**
  - Parse the `chain-id` from the message.
  - Reject it unless it is in {42161, 8453, 59144}.
  - Pick the publicClient for that chain and call `verifySiweMessage({ message, signature })`.
  - Store the user identity keyed by lowercase address, not by (address, chain).
  - Keep nonce, domain and expiration checks as now.
- **Smart wallets can't be assumed to exist on every chain.** A Coinbase Smart Wallet / Base Account deployed on Base may be undeployed on Arbitrum or Linea. Payments from it on another chain require its deployment there, which the wallet handles via a UserOperation, but tips sent *to* such an address on a chain where it isn't deployed are still received (it's a counterfactual address). The real risk is owner divergence: owners changed on one chain may not match on another (same class of issue as Safe "settings not carried over").
- **EIP-7702 EOAs** keep the EOA address. Delegations are per-chain unless signed with chain_id 0 (from the EIP-7702 spec; not re-fetched this session, so treat as a gap to verify).

### Gaps
- EIP-4361 and EIP-7702 spec text was not fetched in this session. No source retrieved on how viem's ERC-6492 path treats a mismatch between the message chain-id and the client chain.

## UX patterns: network selector vs auto-switch, per-chain balances, "pay from any chain", wrong-chain protection

### Takeaway
The proven safety rule (Wintermute lesson) is: never display a receiving address without the chain, and never let the app produce a send on a chain where the destination contract (Safe) doesn't exist. Common patterns:

- Per-action chain selector defaulting to the user's current wallet chain, with an auto-`switchChain` prompt.
- Per-chain balance display.
- A "pay from any chain" option backed by Relay, LI.FI or Across, where the destination is fixed to the home chain.

### Cited Findings
- **Wintermute shows the failure mode.** An address valid on one chain but undeployed on another led to a loss of 20M OP. — [rekt.news](https://rekt.news/wintermute-rekt); [Web3 Is Going Great](https://web3isgoinggreat.com/single/20-million-optimism-tokens-sent-to-nonexistent-address)
- **Relay deposit addresses** are explicitly built for CEX-originated transfers from any network into a chosen destination chain/asset, with refunds when the minimum rate can't be met. — [Relay docs](https://docs.relay.link/features/deposit-addresses)
- **Safe UI.** Safe{Wallet} reworked its network selector to let users add networks to an existing Safe in seconds. — [Safe Help Center](https://help.safe.global/articles/9317165368-deploying-a-multi-chain-safe)

### Inferences
- **For donations to the treasury (highest risk):**
  - Show the Safe address only together with an explicit chain badge (e.g., "Base only"), or better, never show a raw address: always build the tx in-app with `chainId` forced via wagmi `writeContract({ chainId })`, which makes wagmi request a switch.
  - Deploy the Safe on all three chains as a catch net.
- **For tips:** send to the recipient's EOA (valid on all EVM chains), so wrong-chain risk is low. If the recipient is a smart wallet, warn when it isn't deployed on the chosen chain (`getCode` = 0x), because they may not control it there in the same way.
- **Balances:** show per-chain USDC/ETH balances (multicall per chain) and preselect the chain with enough balance.

### Gaps
- No UX research or post-mortems retrieved beyond Wintermute, e.g., aggregated statistics on funds lost to wrong-chain sends.

## Accounting: USDC on several chains as one asset; native vs bridged USDC

### Takeaway
Treat native Circle USDC on Arbitrum, Base and Linea as the same asset (1:1, redeemable via Circle and CCTP-movable), but whitelist token contract addresses per chain. Reject or flag bridged variants (USDC.e/USDbC). Linea's USDC has been native since the 2025-03-16 in-place upgrade.

### Cited Findings
- **Linea's upgrade.** On 2025-03-16, Linea's Bridged USDC Standard contract ownership passed to Circle and was upgraded, so every USDC.e balance automatically became native USDC with no migration. At the time, bridged USDC was over $19M, more than 71% of Linea stablecoin circulation. — [Circle case study](https://www.circle.com/case-studies/linea); [Circle blog](https://www.circle.com/blog/linea-to-become-the-first-bridged-usdc-standard-blockchain-to-upgrade-to-native-usdc)
- **Elsewhere migration was gradual.** On other chains (Arbitrum, Optimism, Polygon, Avalanche) USDC.e→native migration was a per-chain liquidity migration over time (third-party, not primary). — [Eco guide](https://eco.com/support/en/articles/14998924-native-usdc-vs-bridged-usdc-chain-by-chain-guide)
- **CCTP V2 burns and mints native USDC between supported chains,** with the fee deducted from the amount. — [Circle CCTP](https://developers.circle.com/cctp)

### Inferences
- **Ledger design:**
  - Keep the asset key "USDC" with a `chain_id` dimension, and NAV = Σ chains.
  - Keep a config table `allowed_tokens(chain_id, address, symbol, decimals, is_native)` and verify that the Transfer log emitter equals the allowed address.
  - Arbitrum still has legacy USDC.e in circulation, so a user could tip with USDC.e. Decide explicitly whether to reject it or record it as a different asset (not treasury-eligible).
- **Price ETH per chain identically** (same ETH/USD feed). ETH on L2s is bridged canonical ETH, so it is the same asset for NAV purposes.

### Gaps
- Exact canonical native USDC contract addresses per chain were not fetched here. Take them from Circle's "USDC contract addresses" page at implementation time.
