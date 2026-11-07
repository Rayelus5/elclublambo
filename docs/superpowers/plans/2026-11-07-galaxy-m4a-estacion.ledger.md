# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m4a-estacion.md
Spec: games/galaxy/docs/GDD.md §10, §11.1–§11.4, §4, §19; DESIGN_SYSTEM. Branch feature/galaxy-m4a from develop 28d4fbd.
Pre-flight:
- T1 → T2: T1's Currency adds material/components; T2's CHECK must accept the same two — consistent
- T1 → T3: runMaterial(claim, cfg, factor, penalized) and runs.material/caps.runMaterial feed finishRun — consistent
- T1/T2 → T4: roomStatus/advanceRefinery/antennaAccrued and the three tables back StationView — consistent
- T4 → T6: StationView and the four POSTs back the screen and its panels — consistent
- T5 → T6: room art by RoomId in both states — consistent
- Task 1: Ruling: an empty refinery's clock follows the hour, so idle hours never refine a later load — cost if wrong: none
- Task 1: Ruling: the antenna's accrual window is the last capHours: older time is lost, the paid time leaves the window and the fraction stays — cost if wrong: none
- Task 1: Ruling: a machine's level i+1 entry carries the cost of reaching it, so the antenna's level 1 cost is its repair and the refinery's level 1 cost is 0 (it starts at 1) — cost if wrong: none
Task 1: complete (commits baba4f3..8fbf8df, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared → 11 files, 100/100 pass)
Task 2: complete (commits 8fbf8df..17a4e1d, tests: pnpm exec supabase test db → 106 files, 4864 PASS (976 RED→GREEN))
- Task 3: Ruling: material assertions extend the existing payout tests (extracted 56, died 14, cheating 14, idempotent) instead of the plan's own numbers — same rule, real claims — cost if wrong: none
Task 3: complete (commits 17a4e1d..1ca3717, tests: pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/runs.test.ts → 16/16 pass; web results 5/5; web + integration suites green)
- Task 4: Ruling: «not enough» is the existing 402 insufficient_funds (the plan said 409) — one code for the whole economy — cost if wrong: none
- Task 4: Ruling: the refinery's capacity is checked before the wallet, so a load that both overflows and overdraws answers 409 refinery_full — the concurrency test accepts either refusal — cost if wrong: which message a player sees
- Task 4: Ruling: the GET view advances the refinery and the antenna in memory only; changes persist them under the station lock — cost if wrong: none (lazy, idempotent)
Task 4: complete (commits 1ca3717..2f21e77, tests: pnpm -C games/galaxy exec vitest run --project integration → 18 files, 141/141 pass)
- Task 5: Ruling: the hull is the screen's pixel-art CSS frame, not a sprite; the rooms are 40×28 sprites (the test checks the rooms in both states and the machines by level) — the layout owns the hull's size — cost if wrong: none
- Task 5: Ruling: the station sheet is its own browser test (the arena's sheet is cut at 900 px) — cost if wrong: none
Task 5: complete (commits 2f21e77..0261a98, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/station-art.test.ts apps/web/test/sprites.test.ts → 10/10 pass; rooms sheet reviewed)
- Task 6: Ruling: the amount field follows what fits now (typed value clamped to queue room and material), so after a load it drops to what still fits — cost if wrong: none
- Task 6: Ruling: a disabled upgrade says what is missing («Te faltan 18 componentes»), beyond the brief — ui-ux-pro-max disabled-state rule — cost if wrong: one line of copy
- Task 6: Ruling: focus/Escape tests passed first because the shared Dialog already does it; a mutation check on the antenna test (fullAt removed) failed as expected — cost if wrong: none
- Task 6: Ruling: rooms grow to ×7 snapped to 40 px with CSS round() and the hull is centred in the free height (1920 shot had a large empty band) — cost if wrong: older browsers fall back to width 100%
Task 6: complete (commits 0261a98..1579029, tests: pnpm -C games/galaxy exec vitest run --project web → 30 files, 191/191 pass; shots at 1280/1600/1920 + both panels reviewed)
- Task 7: Ruling: the station e2e found that a button disabled while its request runs drops focus to the page and Escape stopped closing panels; fixed in the shared Dialog (the topmost dialog answers Escape/Tab when focus is lost) with 4 unit tests — cost if wrong: none (only acts when focus is on body)
- Task 7: Ruling: the user reminded mid-milestone to use Aseprite for richer art, so the 40×28 code-painted rooms were replaced by 64×44 four-frame scenes painted by a Lua script run in Aseprite (layered .aseprite sources in games/galaxy/art/station, PNG strips played with CSS steps(), served as files with ?no-inline) — cost if wrong: 268 KB of sources in git; the old painter and its SPRITES entries are gone
- Task 7: Ruling: grant accepts material and components (currencySchema extended; it is only used by the CLI) — cost if wrong: none
- Task 7: Ruling: the Hogar hint «Tu estación y sus lotes» became «Tu estación y sus salas» — copy matches what the station is — cost if wrong: one string
Final review: fresh opus reviewer on review-28d4fbd..098e18d — 0 Critical, 2 Important, 11 Minor; agreed with every ruling
- Final: fixed upgrade with a stale view buying the next level — «mejorar con una vista vieja no compra el nivel siguiente: 409 room_changed y nada cobrado» RED→GREEN (+ web body { level: 1 } RED→GREEN), station integration 9/9
- Final: fixed concurrency tests not exercising the station lock — «dos cargas a la vez con material de sobra…» and «dos recogidas a la vez… pagan una sola vez» green with the lock; with lock() commented out the collect test fails (the load race is timing-dependent and did not show in that run) — station integration 9/9
- Final: Ruling: re-graded minor «Se llena a las HH:MM shows a past time once full» to Important — it is the intended daily-return case — fixed with «Ya está llena» / «mañana» / weekday, and the lead text now interpolates capHours (minor 5, same text, exposed by the new test) — «la Antena llena dice que ya está llena…» RED→GREEN, unit+web 1025 passed | 6 skipped
- Final: minor (deferred): upgrading the antenna applies the new rate to time already accrued (≤ 1 signal per upgrade)
- Final: minor (deferred): an old error stays in the refinery panel after a later success (load.error ?? collect.error)
- Final: minor (deferred): an older or replayed response can overwrite a newer station view until the 60 s refetch (money unaffected)
- Final: minor (deferred): reaching caps.runMaterial does not flag the run as payout_cap like coins/dust
- Final: minor (deferred): two JSDoc comments sit on the wrong code (rewards.ts runMaterial/runPayout, db/schema.ts Hangar/StationRooms)
- Final: minor (deferred): pgTAP misses ready < 0, delete on station_rooms/antenna, and service_role checks
- Final: minor (deferred): station POST validates the body before the session (400 instead of 401 without session)
- Final: minor (deferred): refineryLoadSchema max 1,000,000 below the config queue max 10,000,000
- Final: minor (deferred): no direct test of material from an abandoned run (shares the died rule)
Task 7: complete (commits 1579029..2e90b55, tests: pnpm -C games/galaxy test → 112 files, 1215 passed | 7 skipped; e2e 20/20 before the fix pass and station e2e 2/2 after it; pgTAP 4864; root TZ=UTC unit 5410/5410; Docker galaxy-m4a:local smoke (health db up, /galaxy/estacion 200, /api/station 401, room strip image/png 200))
