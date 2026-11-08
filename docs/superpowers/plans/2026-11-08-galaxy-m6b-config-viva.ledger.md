# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m6b-config-viva.md
Spec: games/galaxy/docs/GDD.md §16.3, §16.6
Pre-flight: T1 simulateGacha/configIssues/features → T2 routes and T3 web — consistent
Pre-flight: Ruling: global temporary multipliers (§16.3) move to M7 with live events — payouts must read them, which is M7's content work — cost: no «doble polvo» weekends until M7
Pre-flight: Ruling: the gacha simulator runs in the browser on the draft config (pure shared function over drawPull), no server endpoint — cost: 100 000 pulls take a moment on slow machines
Task 1: complete (commits 01df350..HEAD, tests: vitest packages/shared/test/config-tools.test.ts → 5/5; pnpm test green)
Task 1: Ruling: the Task 1 commit (e8e570a) went in with 4 tests still expecting the old exact features object — I chained the commit after the test run without reading it; fixed in the next commit (the expectations gain market/trades/chat) — suite 1575/1575 — cost: one red commit in the branch history
Task 1: complete (commits 01df350..HEAD, tests: vitest packages/shared/test/config-tools.test.ts → 5/5; pnpm test → 1575 passed, 7 skipped)
Task 2: Ruling: the new config-admin tests run on an in-memory config service that keeps versions like the real one (merge onto live, validated) — the auto-mode classifier blocked a test that published live config to the user's local DB, which the user's rule forbids; the existing config.test.ts (M1) still publishes and restores defaults and only gained the password — cost: the M1 test remains the one place that writes live config locally (flagged to the user)
Task 2: Ruling: the switches close only new activity: listing and buying (cancelling a listing stays open so players can get their galaxy back), proposing, changing and confirming swaps (cancelling stays open), and sending chat messages (reading, reporting and moderation stay open) — cost: none
Task 2: Ruling: publishing needs the admin's password (§16.1: changes to the whole game are the most destructive), sharing the M6a lockout — cost: none
Task 2: Ruling: HttpError gained optional details (the body carries `issues` for config_invalid) — cost: none
Task 2: Ruling: admin-players clan tag used 4096 combinations and collided with leftovers (409) — now 4 random base-36 characters — cost: none
Task 2: complete (commits b32e805..HEAD, tests: vitest integration config-admin.test.ts → 4/4; pnpm test → 1579 passed, 7 skipped; lint clean)
Task 3: Ruling: the web tests for ConfigScreen ran for the first time together with the implementation (RED was the missing module, not watched) — the later additions (sidebar link, Spanish issues, action-named button, Spanish decimals) were each watched RED first — cost: the first four tests could pass for a reason the RED would have shown; covered by the screenshots
Task 3: Ruling: configIssues reports in Spanish (Zod's es locale per parse, only for drafts) — the panel and config_invalid are read by Spanish admins — cost: none
Task 3: Ruling: the switch dialog's button says the action («Apagar Mercado») instead of «Publicar» — the button says what happens — cost: none
Task 3: Ruling: the screenshots were read-only (publishing aborted in the browser); the local DB's features key is at version 1361 because of the M1 config.test.ts — flagged to the user
Task 3: complete (commits aa49963..HEAD, tests: vitest --project web --project unit → 1259 passed, 6 skipped; lint clean)
Task 4: Ruling: the e2e does not publish (turning the market off with a wrong password, the draft checks, the history and the simulator only); publishing and the 503 switches are covered by config-admin.test.ts on an in-memory config — the user's rule forbids publishing live config to the local DB — cost: no end-to-end proof of a real publish until the user checks it on PRE (DEPLOY_PRE step 20)
Task 4: Ruling: local verification excludes the M1 config.test.ts (it publishes live config to the local DB and restores defaults); CI runs it on its own database — cost: a regression there shows up in CI, minutes later
Final review: opus, fresh context — 0 Critical, 5 Important, 13 Minor
Final: Ruling: minor 2 (the simulator kept a run after the draft changed) promoted to Important — «Salió» from an old config next to «Esperado» from the new one misleads the admin deciding on the draft — cost: none
Final: fixed I1 (the editor sent the whole stale object, undoing what others published) — web test «publica solo eso, sobre la versión en la que se editó» + server test «publicar sobre una versión que ya no es la viva da 409» RED→GREEN
Final: fixed I2 (a partial draft valid in the panel failed on the server with no issues; events refused without issues) — shared mergeDraft used by the service, the routes (publish and validate) and the web; events in configIssues; server issues shown in the panel — shared «un borrador parcial se junta…», «los banners de evento son un problema…», server «un borrador parcial se junta con lo publicado…», web «los problemas que encuentra el servidor…» RED→GREEN
Final: fixed I3 (removing a record entry showed no change) — recursive diff with «X se quita» — web «quitar una entrada de un registro se ve como un cambio» RED→GREEN
Final: fixed I4 (the «Publicada» message vanished on the keys refetch) — the editor is keyed by its key and keeps its base version — web editor test RED→GREEN
Final: fixed I5 (server tests ran on a fake that skipped the real merge) — config-admin.test.ts runs the real service on a transaction rolled back at the end (nothing committed; verified in the local DB), with Review Focus 3 (401, no version, lockout after ten), market and trades back on
Final: fixed promoted M2 (stale simulator run) — web simulator test RED→GREEN
Final: Ruling: operations-pool.test.ts (M2b) published a gacha version on every run (local gacha reached v70); it now proves the same property with a service that hands out a version the database never had — the user's rule, nothing committed — cost: none
Final: Ruling: the economy simulator of GDD §16.6 is not in M6b; it needs the payout model of M7 and goes to M8 calibration — cost: the admin cannot preview economy changes before M8
Final: minor (deferred): the switch dialog decides on/off at submit time; a refetch can flip it under the cursor, and a stale click publishes a no-op version
Final: minor (deferred): 100 000 simulated pulls block the tab ~1 s with no busy state
Final: minor (deferred): the simulator never applies welcome luck (gacha.welcome edits are not simulated)
Final: minor (deferred): «la racha más larga sin legendaria» counts the hit itself (20 with hard 20)
Final: minor (deferred): refine issues show codes (must_sum_to_1, season_dates, hard_before_soft, lab_cycle) instead of Spanish; root issues show «·»
Final: minor (deferred): the editor hint does not say that a nested object replaces the whole published object
Final: minor (deferred): arrays are diffed whole (lab.nodes, content, banners print the whole array)
Final: minor (deferred): /keys reads every version of every key; /versions is unbounded and the history renders every row
Final: minor (deferred): an unknown key page shows only its heading, no not-found message
Final: fixed in passing (part of I2): /validate now merges the draft onto what is live like publish
Task 4: complete (commits 3c91e41..41eee9b; tests: local e2e admin-config 1/1 before the fix pass; local full verification killed twice by Claude Code under memory pressure, not relaunched; CI on PR #53 green in 17 min — typecheck, lint, full galaxy suite incl. browser and config.test.ts, pgTAP, full e2e)
Merged: PR #53, merge 0285fbb
