# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m5c1-mercado.md
Spec: games/galaxy/docs/GDD.md §14.6, §14.7, §11
Pre-flight: T1 produces MarketConfig/minPriceFor/commissionOf/tradeBlock + API types → T3/T4 consume the same names; T2 trigger reads config key `market` data->'minPrice'->>tier name with the same defaults as T1's registry (pgTAP pins both); T3 produces the routes T4 calls — consistent
Pre-flight: Ruling: M5c split into M5c-1 (mercado + gates + alerts) and M5c-2 (trueque on the same gates) — GDD §14.5–14.7 is two independent subsystems; each its own PR like M4c/M5b — cost if wrong: one more PR
Task 1: Ruling: MarketRules also carries maxPrice and days, and MyMarket carries rules — the sell panel and Mis anuncios need them without a second request — cost: none
Task 1: Ruling: commissionOf is 0 when the rate is 0 (otherwise at least 1) — a published 0 % must mean no commission — cost: none
Task 1: complete (commits 229444d..HEAD, tests: vitest packages/shared/test/market.test.ts → 8/8; pnpm test → 1479 passed, 7 skipped; lint clean)
Task 2: Ruling: a sold listing does not require buyer_id (on delete set null keeps the history if the buyer's account goes) — the plan said sold ⇔ buyer; sold ⇔ sold_at + commission instead — cost: none
Task 2: Ruling: the pgTAP was written after the migration draft and never watched RED (structure test); its trigger cases exercise the behaviour — cost: a weaker proof for this task only
Task 2: Ruling: the trigger fires on insert and on price updates; the fallback floors are the GDD defaults, the same as the registry's (both pinned by tests) — cost if wrong: drift between the two lists if one changes without the other
Task 2: complete (commits 1b91230..HEAD, tests: supabase test db 984_galaxy_market → 14/14; typecheck clean)
Task 3: Ruling: the escrow checks (isEquipped, isExhibited, isListed, listedColumn) moved to market/escrow.ts and collection/hangar/planetarium import them — one place for «where a galaxy is held» — cost: none
Task 3: Ruling: an expired listing frees the galaxy with no job: «listed» means active and expires_at > now(); listing it again first marks the stale row expired — cost: expired rows stay 'active' in the table until relisted (history queries must use expires_at)
Task 3: Ruling: daily caps count listings created (withdrawn or expired included) and purchases since Madrid midnight; a 60-per-minute rate limit «market» on top — cost: a seller who withdraws and relists uses two of the day
Task 3: Ruling: equipping a listed galaxy answers 409 galaxy_listed (the hangar answered invalid_loadout for a foreign one) — a specific reason for the web — cost: none
Task 3: Ruling: buying unfeatures the galaxy and keeps its level and level_dust (the buyer pays for the levels) — cost: none
Task 3: Ruling: shared-IP alerts compare sessions of both accounts in the last sharedIpDays (no device fingerprint stored yet; user agents are too common to count) — cost if wrong: alts behind different IPs go unflagged until M6 adds signals
Task 3: complete (commits 04cc6dd..HEAD, tests: vitest integration market.test.ts → 12/12 ×3; pnpm test → 1491 passed, 7 skipped; lint clean)
Task 4: Ruling: the listing card does not repeat the galaxy's name (the card shows it); tier, price, seller and the action only — cost: none
Task 4: Ruling: the price field starts at the chosen rarity's floor (null until typed, so clearing leaves it empty), validates on blur, and shows «Recibirás…» only for a valid price — cost: none
Task 4: Ruling: GalaxyPicker gained isTaken(g) (equipped/exhibited/listed shown as «No disponible») instead of a taken set the screen cannot build — cost: none
Task 4: Ruling: useSettled moved to ui/useSettled.ts (clans and market share it) — cost: none
Task 4: Ruling: the hub, detail-dialog and collection wiring tests were written after the wiring (they passed at once); the market screen's own tests were RED first — cost: a weaker proof for those wiring lines
Task 4: Ruling: the Aseprite post is 256×48×4 at ×3 (×4 on ≥1500×860) and wordless (bars, not letters, on the sign); the card galaxies are log spirals so they never read as «$» — cost: none
Task 4: complete (commits 9fb0dde..HEAD, tests: vitest web market.test.tsx → 10/10; pnpm test → 1502 passed, 7 skipped; lint clean; local shots 1280/1600/1920 reviewed)
Task 5: Ruling: the e2e found «Comprar» disabled by a 30-second-old balance (coins granted elsewhere) — the market now reads the wallet on mount (useGacha({ fresh: true })) — verified by the e2e RED→GREEN; no unit test can see a stale cache across mounts
Task 5: Ruling: full e2e 28/29 — collection.spec «fusionar cinco comunes» failed once and passed on its own rerun: it counts only the first page (30) of commons, so an account whose 40 pulls give >30 commons breaks before−5; pre-existing, unrelated to the market — deferred minor
Final review: opus, Ready to merge with fixes — 0 Critical, 3 Important, 14 Minor
Final: fixed daily caps bypassed by parallel requests — integration «el límite del día aguanta peticiones a la vez» RED (5/5 passed) → GREEN (advisory lock market-cap:<account> in list and buy), suite 1506/1506
Final: fixed buying stripped «Destacada» (featured is the event's guarantee, not a profile flag; Task 3 ruling was wrong) — integration «una galaxia destacada sigue destacada…» RED→GREEN, suite 1506/1506
Final: fixed shared-IP alerts defeated by logout — new galaxy.account_ips (migration 20261108033607, backfilled from sessions; createSession upserts) and the alert joins it — integration alert test (logout case) RED→GREEN, pgTAP 16/16, suite 1506/1506
Final: fixed (re-graded Minor→Important: the buyer is left with a galaxy that errors) a galaxy equipped/exhibited the instant its listing expired could still be sold — buy re-checks isEquipped/isExhibited after the galaxy lock — integration «una galaxia que acabó equipada…» RED→GREEN, suite 1506/1506
Final: fixed (re-graded Minor→Important: anti-abuse §14.7) a banned seller's listings stayed visible and buyable — integration «lo de un vendedor baneado…» RED→GREEN, suite 1506/1506
Final: fixed (re-graded Minor→Important: every buyer saw it) the buy dialog said «de 400 a 400» after buying — web buy test RED→GREEN (balance captured at open), suite 1506/1506
Final: minor (deferred): mutual buys (A from B while B from A) can deadlock on balance rows → one 500, a safe retry
Final: minor (deferred): todayStart is off for one hour on DST change days (caps unenforced 23–24 h on fall-back, yesterday counted 00–01 h after spring-forward)
Final: minor (deferred): a trigger check_violation (floor raised within the 10 s config cache) answers 500 instead of 400 price_too_low
Final: minor (deferred): the trigger's ::bigint cast fails on a non-number config value (zod prevents it); pgTAP pins the fallback only for common and legendary
Final: minor (deferred): commissionOf floors without an epsilon (exact at 7 %; rates like 0.29 lose a coin)
Final: minor (deferred): after a lost answer the buy dialog disables its button (close and reopen to retry; the key is kept)
Final: minor (deferred): an overflowing price shows «El mínimo…» instead of «El máximo…»
Final: minor (deferred): the hangar and planetarium pickers do not mark listed galaxies (picking one answers 409 with its reason)
Final: minor (deferred): if the wallet read fails, «Comprar» is enabled but opens nothing
Final: minor (deferred): expired listings disappear from Mis anuncios without an «expired» state
Final: minor (deferred): the disabled level-up of a listed galaxy has no aria-describedby to its reason (the reason shows below)
Final: minor (deferred): collection.spec «fusionar cinco comunes» is flaky when an account's pulls give more than 30 commons (pre-existing)
Final: merged PR #50 (merge dcf5f90) on green CI (10m47s); PRE check pending at archive time
