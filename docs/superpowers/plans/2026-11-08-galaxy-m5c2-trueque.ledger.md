# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m5c2-trueque.md
Spec: games/galaxy/docs/GDD.md §14.5, §14.7
Pre-flight: T1 types (TradeView/TradeSide/MyTrades, schemas, errors) → T3 routes and T4 web; T3 extends M5c-1's escrow.ts (isTraded) and market lock — consistent
Pre-flight: Ruling: «1:1» read as one galaxy for one galaxy between two players (barter, no coins) — the market already covers coins; GDD §14.5 says «intercambio 1:1» — cost if wrong: a later variant (galaxy for coins/dust) is a new kind of side, the version/escrow model stays
Task 1: Ruling: both sides of a trade show as PublicGalaxy (card + level), and MyTrades.rules extends MarketRules with openTrades/tradesLeft/tradeDays — one gate notice for market and swaps — cost: none
Task 1: complete (commits d6ec831..HEAD, tests: vitest packages/shared/test/market.test.ts → 11/11; typecheck clean)
Task 2: Ruling: a galaxy is held only when its owner offers it (*_offered): the proposer's from the start; the other side's once its owner puts it or confirms it. A galaxy only asked for («want») is not held — otherwise anyone could freeze someone else's galaxies for 3 days — cost: the asked-for galaxy may be spent meanwhile; confirming then answers that it is no longer available
Task 2: Ruling: trade_alerts gains trade_id (alerts for swaps reuse the table: shared_ip, unbalanced) — cost: none
Task 2: complete (commits 779a2b5..HEAD, tests: supabase test db 985_galaxy_trades → 12/12, watched RED first; typecheck clean)
Task 3: Ruling: the open-trade limit counts both parties (a proposal to an account with 5 open is refused) — nobody can be flooded with proposals — cost: a popular trader cannot receive a sixth until one closes
Task 3: Ruling: proposing to an account that cannot trade yet is allowed; its gates are checked when it changes or confirms — the profile already shows its level, and the 3-day expiry cleans up — cost: a proposal that can never be accepted until it expires
Task 3: Ruling: changing and confirming are plain transactions (not idempotent operations): the version they name answers a retry (trade_changed or trade_gone) — cost: a lost answer to a confirm shows an error while the trade is in fact done (the list re-read shows it)
Task 3: Ruling: the swap keeps level and «Destacada», re-checks both sides not banned, both galaxies theirs, alive and held by nothing else; alerts reuse trade_alerts (shared_ip via account_ips, unbalanced at a tier gap ≥ tradeAlertTierGap, 3) with seller_id = proposer, buyer_id = the other — cost: the alert's column names read oddly for swaps until M6 shows them
Task 3: Ruling: MyTrades.rules.openTrades is how many more may be open now (limit minus open), not the limit — what the web needs to say — cost: none
Task 3: complete (commits 4a38261..HEAD, tests: vitest integration trades.test.ts → 15/15 ×3; pnpm test → 1524 passed, 7 skipped; lint clean)
Task 4: Ruling: swaps live in a fourth market tab «Trueques» (not a screen of their own) and are proposed from another player's profile — where a player sees what someone has — cost: none
Task 4: Ruling: one composer for proposing and changing; «Doy» lists my free galaxies (the one I already offer in this trade stays pickable), «Quiero» their public collection — cost: none
Task 4: Ruling: closed trades say «Diste/Recibiste» (done) or «Ofrecías/Pedías» (cancelled, expired) — the first shots showed two bare names — cost: none
Task 4: complete (commits 24ee2e7..HEAD, tests: vitest web trades.test.tsx → 9/9; pnpm test green; lint clean; local shots reviewed)
Task 5: e2e trades.spec 1/1; full e2e 30/30
Final review: opus, Ready to merge with fixes — 1 Critical, 3 Important, 9 Minor
Final: fixed (Critical) saving the composer unchanged left both sides confirmed with no swap — the swap is a helper run whenever both end up confirmed (confirm, or a change that changes nothing after the other confirmed); the web disables «Guardar cambios» with no change — integration «guardar el trato tal cual lo acepta…» RED→GREEN, web composer test RED→GREEN, suite green
Final: fixed a galaxy offered in a swap the instant its listing expired could still be bought — buyListing re-checks isTraded — integration «una galaxia que acabó ofrecida en un trueque no se vende» RED→GREEN
Final: fixed griefing by proposals — one open trade per pair (unique index trades_pair_open, migration 20261108042617 cancels pre-existing duplicate open pairs, keeping the newest), outgoing (trade_limit) and incoming (trade_limit_them) limits apart, both traders locked in id order — integration «un trueque abierto por pareja…» and «las propuestas que recibes no te impiden proponer…» RED→GREEN, pgTAP 13/13
Final: fixed missing concurrency tests for focus 1 and 3 — «dos confirmaciones a la vez», «la misma galaxia en dos trueques a la vez», «proponer y poner en venta… a la vez» added (they passed: the behaviour was already right)
Final: fixed (re-graded Minor→Important: the versions are the GDD's point) the composer sent the live version, silently overwriting a counter-offer — it keeps the version seen at open — web test RED→GREEN
Final: fixed (re-graded Minor→Important: wrong info to every changer) change mode promised «caduque en 3 días» — now the real date — same web test
Final: Ruling: confirm does not take the market locks the plan named — confirm uses no daily cap; the trade row and the galaxy locks serialize it — cost: none
Final: minor (deferred): a banned other side makes confirm answer trade_gone while the trade stays open (rolled back); proposing to a banned account is allowed
Final: minor (deferred): myTrades takes open trades from the latest 60 rows (with the per-pair index, flooding needs many accounts)
Final: minor (deferred): cancelTrade marks an expired-but-open trade «cancelled»; the expiry write in lockOpen is undone by its throw
Final: minor (deferred): the DB cannot stop a galaxy offered as a_galaxy in one trade and b_galaxy in another; only the galaxy row locks do
Final: minor (deferred): the stale-trade expiry UPDATE in holdable may deadlock (40P01 → 500) with a change/confirm at the expiry instant
Final: minor (deferred): «Proponer trueque» shows even without the gates; useTrades runs on every profile visit
Final: minor (deferred): «Confirmar trato» has no second step; its disabled state is not described; the sections' aria-label repeats their h4; card h3s come before the h2 «Cerrados»
Final: minor (deferred): «Falta una galaxia en algún lado» is vague; «Ha cambiado el trato» shows only as the 409 text
Final: merged PR #51 (merge 1412d38) on green CI (15m7s); calibration 20 files/308 tests; PRE check pending at archive time
