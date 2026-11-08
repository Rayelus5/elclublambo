# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m6d5-economia-viva.md
Spec: games/galaxy/docs/GDD.md §16.3, §16.6, §11.3 bis.
Pre-flight: Task 2 consumes Task 1 GET /boosts and breakdown.boosts; Task 3 consumes Task 1 boostFactor and the boosts schema plus runPayout/runMaterial/dailySegments — consistent.
PRE: M6d-4 checked with e2e_pre_3e9567 once the tunnel was back.
Task 1: Ruling: the boosts key holds `{ list: [...] }` (config values are objects; mergeDraft works on top-level fields); refine messages are written in Spanish so the config editor shows them as they are — cost if wrong: none.
Task 1: Ruling: the per-run cap case is tested on runPayout in shared, not through the API: plausibility clips a claim's loot (dust cap from kills) long before the run cap — cost if wrong: none (same function the server calls).
Task 1: Ruling: breakdown.boosts is optional in the type — a resent finish answers the stored result, and results stored before M6d-5 have none; the web reads it as `?? []` — cost if wrong: none.
Task 1: INCIDENT: a verification command named integration/config.test.ts, which publishes live config locally (forbidden). Checked the local DB: live features/auth values identical to before (defaults); 15 features + 5 auth history rows added (left in place: history is append-only). The session's first full-suite run (13:47 UTC) had done the same. Memory updated; the owner is told. Its parallel run also flipped features under config-admin (false failure; 8/8 alone).
Task 1: complete (commits 69b2535..1d3f133, tests: bash -c 'cd games/galaxy && pnpm exec vitest run --project unit packages/shared/test/boosts.test.ts packages/shared/test/runs-rewards.test.ts && cd apps/server && pnpm exec vitest run test/integration/boosts.test.ts test/integration/runs.test.ts' →    Duration  4.82s (tests 60%, import 30%, transform 10%))
Owner request (2026-11-08): the 3D inspector falls back to the classic (pre-M6d-1) view when the pro one fails, with a notice and the concrete reason; flat card (with reason) without WebGL2 — browser tests 8/8.
Owner request: cards in a visited planetarium open in 3D by clicking the card itself (gcard-hit overlay; no extra button).
Owner request: go faster to PRE — fewest tests, CI as the gate. Ruling: Tasks 2–4 shipped with one or two targeted tests each, no local e2e (Task 4 e2e skipped), no separate final review: CI's full suite + e2e gate the merge — cost if wrong: a defect found on PRE instead of locally.
Task 2: boost chips on the title screen and in the hangar; results list the boosts that paid (breakdown.boosts ?? []).
Task 3: simulateEconomy (shared) + EconomySimulator under runs/boosts editors (3 bot runs in slices, stop, live vs draft table).
Merged: PR #60 → develop (merge 72b3d51) on green CI (second run; the first failed on the planetarium e2e that expected no buttons on a visit), 2026-11-08.
