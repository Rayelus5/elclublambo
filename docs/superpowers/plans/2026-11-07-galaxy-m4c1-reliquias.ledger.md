# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m4c1-reliquias.md
Spec: games/galaxy/docs/GDD.md §8.4, §8.4 bis, §8.6. Executor: inline (executing-plans), branch feature/galaxy-m4c1 from develop ee8af19.
Pre-flight:
- T1→T3: relicLevelCost/relicRefund/nextSlot and the relics config feed the collection and hangar services — consistent
- T2→T3: galaxies.level_dust — consistent
- T3→T4: level-up and slot routes, GalaxyDetail.levelUp/refund and HangarView.nextSlot — consistent
- Task 1: Ruling: six Legendary level-10 relics of one family broke the crowd ceiling (2.1M vs 1.75M); §8.6's «el mismo efecto rinde menos cuanto más se acumula» is now a sim rule — from the third relic of the same family (slot order) each one's magnitude is ×0.5 the last (content relics.stacking {from 3, decay 0.5}, defaulted so older published content stays valid; SIM_VERSION 1.5.0); two-relic builds are unchanged — cost if wrong: mono-family six-relic builds are weaker than linear
- Task 1: Ruling: with the rule the lenticular extreme still dealt 1.92M in a crowd; the excess is its crit and crit damage within their caps (phenomenon and background measured as not the cause), so the crowd ceiling was re-measured with the same formula (1.5× the strongest measured extreme, now with six slots): 2 900 000; the rings ceiling holds unchanged — cost if wrong: the crowd guard is looser for two-relic regressions (they were at 1.51M)
- Task 1: Ruling: until Task 2's level_dust the server gives refund 0; nextSlot is real from Task 1 — cost if wrong: none
Task 1: complete (commits 084cda5..b1c7bef, tests: unit+web 92 files 1083 passed | 6 skipped (relics-progress + relic stacking RED→GREEN), sim 300/300 with six-relic extremes under the ceilings; integration hangar+collection 13/13; typecheck, lint)
Task 2: complete (commits b1c7bef..045c857, tests: pnpm exec supabase test db → 109 files, 4887 PASS (979 RED→GREEN); server typecheck)
- Task 3: Ruling: the detail moved into detailOf(db, owner, id, configs) so the level-up returns it from its own transaction without reading config inside; the route reads galaxies/lab/relics before the operation — cost if wrong: none
- Task 3: Ruling: the refund is its own ledger credit (reason relic_refund) after the disintegration's or the fusion's own movement, each fused parent rounded down — cost if wrong: one dust of rounding per parent
- Task 3: Ruling: a slot request names the slot it opens; the check order is maxed → changed → locked → debit (a stale request at six answers slot_maxed) — cost if wrong: which 409 a player sees
Task 3: complete (commits 045c857..7277dea, tests: integration 21 files 175/175 (relics 8 RED→GREEN); typecheck, lint)
- Task 4: Ruling: the M4b Hangar test now counts 3 closed slots plus the next one (its fixture carries nextSlot), and the open-slot test waits for 3 «Elegir reliquia» instead of findAll (which resolves on the first match) — cost if wrong: none
- Task 4: Ruling: the next slot gets a ready state (solid solar rim, slow pulse, still with reduced motion) and its button wraps its cost to a second line so it fits a 175 px slot — found in the shots — cost if wrong: none
Task 4: complete (commits 7277dea..4497fe7, tests: vitest --project web → 35 files 220/220 (collection 2 + hangar 3 RED→GREEN); typecheck, lint; shots at 1280/1600/1920 reviewed)
- Task 5: Ruling: the e2e meets slot 3's milestone by inserting five finished runs for its own e2e_* account with the server's pg driver (a real run counts only from 60 s); no live config is touched — cost if wrong: the e2e does not exercise finishing runs (incursion.spec does)
Final review: opus, ee8af19..022a9ff — 2 Important, 6 Minor. Re-graded by effect: Minor 4 (Hangar stale after a level-up, the common flow right after buying), Minor 5 (the max-level test never rendered its case) and Minor 6 (progressbar name/value and «Te faltan» not linked; accessibility is critical in this project) raised to Important.
- Final: fixed the Hangar's stacked power (rank by id; the Hangar described copies, so indexOf gave -1 and no stacking) and the rule explained in the Hangar — sim «la reliquia se reconoce por su id…» and web «la tercera reliquia de una familia dice la mitad…» RED→GREEN
- Final: fixed the Hangar not refreshed after a level-up — web «subir de nivel marca el Hangar para leerlo de nuevo» RED→GREEN
- Final: fixed the max-level test that never rendered its case — web «en el 10, Nivel máximo y ningún botón para subir» (passes; it was the test that lied)
- Final: fixed the slot bar's name/value text and «Te faltan…» as the disabled buttons' description — web hangar and collection a11y asserts RED→GREEN
- Final: minor (deferred): fusion debits the recipe before crediting the refund, so a player short of the recipe but net positive after the refund gets 402 (rare: needs levelled parents and almost no dust)
- Final: minor (deferred): unlockSlot and hangarView read live config through the pool inside the transaction (same as levelUpProbe; the collection avoids it)
- Final: minor (deferred): relics.slots is .max(4) without a minimum (a 3-entry config makes slot 6 unreachable and slot_maxed's copy false) and levels are not checked to grow
- Final: fixed the loosened crowd ceiling — two-relic builds back under 175k/1.75M (measured 108 056 / 1 509 878); six-slot builds (6 single-family, 5 mixed incl. 2+2+2, 8 random) under their own 262k/2.885M (1.5× the measured 174 673 / 1 923 192); builds.test 4/4
- Final: Ruling: the six-slot builds are a separate set instead of randomBuild drawing 2–6 relics — the random set's 12× spread was calibrated on two relics; mixed 2+2+2 extremes cover the case stacking does not touch — cost if wrong: random three-to-five-relic builds are not sampled (the extremes bound them)
- Final: Ruling: the stacking decay stays ×0.5 from the third (the reviewer called it steep); the Hangar now says it and shows it in each card's power — cost if wrong: a content tweak of relics.stacking, no migration
- Final: note: Task 1's 2 900 000 crowd-ceiling ruling is superseded by the split ceilings above
