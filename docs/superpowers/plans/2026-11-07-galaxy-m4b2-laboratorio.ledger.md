# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m4b2-laboratorio.md
Spec: games/galaxy/docs/GDD.md §10.6, §6, §8.6, §10.2, §11; DESIGN_SYSTEM.md §8 octies (new). Executor: inline (executing-plans), branch feature/galaxy-m4b2 from develop c6410f8.
Pre-flight:
- T1→T3: labEffects/labNodeStatus/labCost and the refinery/antenna boost parameters feed the lab and station services — consistent
- T1→T4: runPayout/runMaterial gain a boost; startRun/finishRun read accountLabEffects (T3) — consistent
- T2→T3: galaxy.lab_nodes — consistent
- T3→T5: GET /lab and POST /lab/nodes/:id/upgrade; the station's lab room repairs through the existing rooms/:id/upgrade { level } — consistent
- T5→T6: LabScreen shows a UI icon until T6's Aseprite icons — consistent
- Task 1: Ruling: the lab node types are spelled out in lab/tree.ts (LabNode, LabEffect, LabConfig) instead of derived from ConfigValue<'lab'>, since the registry imports the default tree from that file (a derived type was circular) — cost if wrong: the two must be kept in step (typecheck passes the config value to labEffects)
- Task 1: Ruling: the M4a tests that used the lab as their «future» room now use comms (shared ten-rooms test, server room_unavailable test), and the server's new-account test expects the lab broken — cost if wrong: none
Task 1: complete (commits c09e08b..43d8a5e, tests: pnpm -C games/galaxy exec vitest run --project unit --project web → 89 files, 1064 passed | 6 skipped (lab 9 + station 2 RED→GREEN; builds under the ceilings with the full lab); station integration 9/9; typecheck, lint)
Task 2: complete (commits 43d8a5e..8a1c4a7, tests: pnpm exec supabase test db → 108 files, 4883 PASS (978 RED→GREEN); server typecheck)
- Task 3: Ruling: labLevels/accountLabEffects live in apps/server/src/lab/levels.ts (no service imports) so the station, the runs and the collection read them without import cycles — cost if wrong: none
- Task 3: Ruling: the node-exists check (400) comes before the lock, then lab_closed, lab_locked, lab_maxed, lab_changed, then the settle and the debit — cost if wrong: which refusal a player sees
- Task 3: Ruling: buying an antenna node does not settle the antenna (its accrued time takes the new rate, at most a fraction of a signal), as the M4a deferred minor for antenna upgrades — cost if wrong: ≤ 1 signal per node level
Task 3: complete (commits 8a1c4a7..7a02023, tests: pnpm -C games/galaxy exec vitest run --project integration → 20 files, 164/164 (lab 9 RED→GREEN); typecheck, lint)
- Task 4: Ruling: the pay push is read from the run's own snapshot (runs.upgrades.payout), clamped to 0–1 and 0 when absent, so runs started before M4b-2 and forged rows pay as before — cost if wrong: none
- Task 4: Ruling: disintegration dust rounds down and the fusion discount rounds up (both for the house); the detail and the fusion recipe show the same numbers the actions charge — cost if wrong: one dust either way
- Task 4: Ruling: the M4b-1 test of runs.upgrades now expects the payout field (zero without a lab) — cost if wrong: none
Task 4: complete (commits 7a02023..2d47175, tests: integration 20 files 166/166 (runs + collection lab tests RED→GREEN), unit+web 89 files 1066 passed | 6 skipped (rewards boost RED→GREEN); typecheck, lint)
- Task 5: Ruling: ui-ux-pro-max had no verified match for a skill tree; the disabled-state guidance was applied (dimmed, different cursor, never like the normal state) and each closed node says what it needs — built-in default, labelled as such — cost if wrong: none
- Task 5: Ruling: the lab's buy button is its own full-width pill (lab-buy) with the cost on a second line in the button's ink; the station's inline cost style overflowed 4-column cards and the node text colour made the cost unreadable on Solar (seen in the 1920 shot) — cost if wrong: none
- Task 5: Ruling: the missing line agrees in number («Te falta 1 componente»), also in the station — found in the shots — cost if wrong: none
- Task 5: Ruling: the M4b-1 weapon cards get a 260 px column minimum (one per row in the narrow probe panel), the polish the PRE check asked for — cost if wrong: none
Task 5: complete (commits 2d47175..6230176, tests: pnpm -C games/galaxy exec vitest run --project web → 34 files, 213/213 (lab 6 + station 2 RED→GREEN); typecheck, lint; lab shots at 1280/1600/1920 reviewed)
- Task 6: Ruling: labIconUrl and the CSS strip were written with the screen in Task 5 (the screen falls back to a UI icon without a strip), so Task 6 only adds the painter, the PNGs and the test — cost if wrong: none
Task 6: complete (commits 6230176..e53e117, tests: lab-art + lab 7/7 (lab-art RED→GREEN); contact sheet and lab shots reviewed)
Final review: fresh opus reviewer on review-c6410f8..7660465 — 0 Critical, 1 Important, 8 Minor; all rulings upheld (settle keyed on the effect called better than the plan)
- Final: fixed the tree drawing nodes under the wrong parent (depth order) — «cada nodo cuelga del que lo abre…» RED→GREEN; nodes now nest inside the item of the node that opens them; e2e locators read the card; web 18/18
- Final: Ruling: re-graded minor «the lab debits dust before components» to Important — the reverse of every other multi-currency debit could deadlock three concurrent requests into a 500 — fixed, «una mejora cobra los componentes antes que el polvo…» RED→GREEN, lab integration 10/10 — cost if wrong: none
- Final: Ruling: the review's doc drift (DESIGN_SYSTEM §8 septies room kinds, RunStart.bonuses comment) is fixed in the same pass since those files changed anyway — cost if wrong: none
- Final: minor (deferred): station/lab services read live config inside the transaction (a second pool connection on a cache miss)
- Final: minor (deferred): the lab schema caps only fusion and payout totals; disintegrate/refinery/antenna sums and absolute stats (projectiles, pierce, regen) are unbounded beyond per-node limits
- Final: minor (deferred): no test parses the default lab tree through the schema (zod defaults skip superRefine)
- Final: minor (deferred): the results screen does not show the lab's pay push in its breakdown
- Final: minor (deferred): the repair panel stays open showing «Al máximo» after repairing the lab
- Final: minor (deferred): repairing the lab does not invalidate the cached lab view (refetch on mount fixes it)
- Final: minor (deferred): DEPLOY_PRE step 11's note about publishing an M4a station value is slightly off (publish merges onto the active value)
- Task 7: Ruling: the station e2e now checks the Laboratorio «Rota» and «En reparación» on Comunicaciones (the lab became repairable) — cost if wrong: none
Task 7: complete (commits e53e117..8b3c75a, tests: full e2e 22 run before the fix pass (20 passed; lab and station failed on the nested tree and the lab's new state, both fixed) then lab+station e2e 3/3; pnpm -C games/galaxy test → 122 files, 1292 passed | 7 skipped; GALAXY_CALIBRATE=1 sim 304/304; pgTAP 4883; root TZ=UTC unit 5410/5410; Docker galaxy-m4b2:local smoke (health db up, /galaxy/laboratorio 200, /api/lab 401, lab icon image/png 200))
