# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m3b2-sondas.md

Spec: games/galaxy/docs/GDD.md (§6, §12.2, §5.6, §19) + DESIGN_SYSTEM.md. Plan self-approved under the 2026-11-06/07 autonomy grant.
Branch: feature/galaxy-m3b2, cut from feature/galaxy-m3b1 while PR #37 waits for CI; develop is merged in after #37 lands.

## Pre-flight (shared interfaces)
| Producer → consumer | Produces / consumes | Found |
|---|---|---|
| T1 → T2, T5, T7 | probe ids (lumen, bastion, spark, sentinel, anchor, prism, comet, echo), ProbeDef.quirk, probe sprite ids `probe-<id>` | consistent |
| T3 → T4, T6, T7 | PROBE_TEST, scoreTest, unlockedProbes/probeProgress, RunStats, ProbeCard {unlocked, condition, progress}, config key `probes` | consistent |
| T4 → T6, T7 | POST /galaxy/api/probe-test, PUT /galaxy/api/hangar/probe, HangarView.test {taken, probe}, 409 probe_test_required | consistent |
Pre-flight: no conflicts needing a ruling. Note: content ids keep the [a-z0-9-] regex (M3b-1 ruling): the probe ids above already comply.
- Task 1: Ruling: quirk state lives in p.fx under a 'quirk' prefix (quirkDashT…) — the relic comet already used dashT — cost if wrong: none
- Task 1: Ruling: thorns reflect only contact damage that actually landed (after armor, shield, dodge and invulnerability) — a dodged or blocked touch returns nothing — cost if wrong: one comparison
- Task 1: Ruling: the M3b-1 reaction replay test now uses ×10 enemy life (Lumen's magnet changed that run and it saw no reaction at all) — cost if wrong: none
Task 1: complete (commits ab005d5..7eee6cd, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  27.75s (tests 83%, import 12%, transform 5%))
- Task 5 (pulled forward after Task 1): Ruling: the 7 probe sprites land right after Task 1 (the content→sprite guard would stay red); Cometa reads thin at 1× — polish in M8 — cost if wrong: sprite data
- Task 2: Ruling: the magnet quirk gains a radius (every 60 s, 160 u) — pulling every fragment on screen every 30 s took the bot to layer 7 at level 60 — cost if wrong: one quirk field
- Task 2: Ruling: starter balance — Bastión hp 140→130, armor .12→.1, regen .2→0, thorns .6→.5; Chispa hp 80→68, speed 104→92, bonus {cooldown .06} (no crit), dash every 8→20 s, 60→50 u, 0.5→0.3 s — the bot (speed-sensitive) made Chispa reach layer 5 — cost if wrong: live-config retune
- Task 2: Ruling: the starter calibration uses the median of 8 seeds, not the mean of 5 — bot runs are chaotic and one in a few reaches the 40-min cap (means jumped ±3 min between near-identical tunings); medians: lumen 16.1, bastion 19.1, spark 17.4 min, all layer 3 — cost if wrong: an outlier-heavy starter passes
Task 2: complete (commits 6a44931..f276a69, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  27.71s (tests 85%, import 10%, transform 4%))
- Task 3: Ruling: the answer→probe order rotates between questions (A is not always Lumen) — otherwise a player could game the test by always picking the same letter; the copy lists the answers in that order — cost if wrong: copy order
- Task 3: Ruling: on a tie, the tiebreak answer decides outright (even for a probe outside the tie), and a sixth answer with no tie is ignored — the plan's 'gana la sonda de la respuesta de desempate' for the three-way case, applied to every tie for one simple rule — cost if wrong: one branch
- Task 3: Ruling: the ProbeCard contract changes (unlocked/condition/progress) land with the server in Task 4, so the server keeps compiling between tasks — cost if wrong: none
Task 3: complete (commits f276a69..5ed5327, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared →    Duration  2.10s (import 41%, tests 39%, transform 20%, worker 1%))
- Task 4: Ruling: the probe test needs no Idempotency-Key — it is idempotent by design (one per account, serialized with an advisory lock; a second answer returns the first result) — cost if wrong: none
- Task 4: Ruling: before the test every probe card is locked with no condition (the test gives the first one) — cost if wrong: copy
Task 4: complete (commits 5ed5327..5b7cdd8, tests: pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration/probes.test.ts apps/server/test/integration/runs.test.ts apps/server/test/integration/hangar.test.ts →    Duration  6.13s (tests 58%, import 38%, transform 4%))
Task 5: complete (commit 6a44931, pulled forward right after Task 1; tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/sprites.test.ts → Tests 6 passed (6); sheet reviewed in a screenshot)
- Task 6: Ruling: «Saltar el test» answers at random (crypto) and still reveals the probe — GDD §12.2 lets onboarding be skipped, and the probe is discovered, never chosen — cost if wrong: one button
- Task 6: Ruling: the reveal reads the probe's numbers from DEFAULT_CONTENT, like the M3a hangar — the test endpoint returns only the probe id — cost if wrong: a live-config retune shows stale stats on the reveal until a deploy
- Task 6: Ruling: fixed button.lip's font:inherit beating .launch (the Hangar's «Lanzar incursión» rendered in small sans since M3a) with :is(button, a).launch — found in the screenshots — cost if wrong: none
Task 6: complete (commits 5b7cdd8..49e3ff7, tests: pnpm -C games/galaxy exec vitest run --project web → 27 files, 157/157 pass; screenshots reviewed)
- Task 7: Ruling: ProbeCard gains `quirk` (its kind), sent by the server from live content — the panel tells each probe's quirk, and the web should not read it from DEFAULT_CONTENT when the server already sends the card — cost if wrong: one contract field
- Task 7: Ruling: the picker is a grid of horizontal tiles (min 220 px) under the chosen probe's detail, not a carousel — all eight and their conditions visible at once, no hidden state — cost if wrong: layout
- Task 7: Ruling: a locked tile's count is round(progress × value), capped at value − 1 — the card carries the fraction, not the stat; a locked probe never shows a full bar — cost if wrong: an off-by-one in a label
- Task 7: Ruling: the «runs» condition reads «Juega N incursiones» — every finished, non-suspicious run counts (extracted, lost or abandoned) — cost if wrong: copy
- Task 7: Ruling: the probe column widens (minmax(360px, 1.15fr) vs .85fr) so two columns of tiles fit at 1920 — the relics column narrows from 1.6fr to 1.5fr — cost if wrong: layout
Task 7: complete (commits 49e3ff7..4f8162b, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/hangar.test.tsx → 20/20 pass; web suite 160/160, server hangar+probes 10/10, screenshots 1280/1920 reviewed)
- Task 8: Ruling: the e2e found sign-up landing on home, not /sonda — RR7 navigations are transitions, so GuestOnly re-rendered first with the new session and its <Navigate to="/"> won; GuestOnly takes a `to` and /crear-cuenta aims at /sonda from both places; pinned by a real-browser test (jsdom's act() hides the race; the jsdom version passed vacuously and was dropped) — cost if wrong: none
- Task 8: Ruling: /sonda with the test already taken (Back after the reveal, /crear-cuenta with a session) redirects to the hangar from the intro — the test is once, and re-taking it silently returns the first probe — cost if wrong: one redirect
- Task 8: Ruling: e2e specs other than the incursion skip the test with a shared skipProbeTest helper; the incursion takes it for Bastión with the keyboard and checks the hangar picker — cost if wrong: none
- Task 8: Ruling: SIM_VERSION 1.1.0 → 1.2.0 — the quirks and the starters' retune make the same seed and inputs play differently (version.ts's own rule); the plan did not list it — cost if wrong: a version label
Task 8: verification — galaxy typecheck + lint clean; pnpm -C games/galaxy test → 102 files, 1103 passed | 5 skipped (env-gated); pgTAP 104 files 4849 PASS; root TZ=UTC test:unit 425 files 5410/5410; Galaxy e2e 19/19 (18.3 min); Docker image galaxy-m3b2:local built and smoke-tested (health db up, /galaxy/sonda 200, probe-test without session 401)
Final review: opus reviewer on review-a4e9c98..865ee6e — 0 Critical, 4 Important, 9 Minor; all 4 Important kept at Important after re-grading by effect
- Final: fixed held key / double click / stray «Saltar» sending the permanent test — a confirm step («Descubrir mi sonda», «¿Saltar el test?»), e.repeat and modifiers ignored, second click of a double click ignored, focus on each step's title — probe-test.test.tsx 5 new tests RED→GREEN (10 red incl. the flows that now confirm), web suite 166/166
- Final: fixed instant abandons farming «Juega N incursiones» — runStats counts runs of probes.minRunSeconds (60) or more — probes.test.ts «las partidas de menos de un minuto o sin terminar no cuentan» RED→GREEN, server 27/27
- Final: fixed dead and dangerous live-config `probes.starters` — removed from the schema (strict: setting it is refused), probeStatus uses STARTERS; DEPLOY_PRE wording fixed — shared probes.test.ts «las iniciales son las del test, no un ajuste» RED→GREEN
- Final: fixed Chispa not being fast (92 vs 90) — speed 100; to stay in the starter calibration: hp 68→56, pickup 36→30, no cooldown bonus, dash every 20→30 s (copy follows); description no longer says «ultrarrápida» or «el primer golpe» — content.test.ts «cada inicial destaca en su estadística fuerte» RED→GREEN; GALAXY_CALIBRATE starter calibration passes (needed four tunings: medians bimodal, 22.8 → 21.4 → 20.9 → 20.07 → pass)
- Final: full galaxy suite after the pass 102 files, 1112 passed | 5 skipped
- Final: minor (deferred): startRun does not re-check the unlock, so raising a threshold leaves a chosen-but-now-locked probe launchable
- Final: minor (deferred): the DB check on probe_tests.answers lets an empty or multi-dimensional array through (the API's Zod check stops it first)
- Final: minor (deferred): quirk copy hard-codes numbers («Cada minuto», «la mitad», «cada 30 s», «Cada 30 bajas») that live config can change; send the quirk numbers in ProbeCard
- Final: minor (deferred): the reveal reads DEFAULT_CONTENT instead of the hangar's live probe cards
- Final: minor (deferred): `quirk` sim events have no visual or sound cue (dash teleport, second wind, salvage drop)
- Final: minor (deferred): schema allows dash invuln ≥ every and second-wind hp 0; the 2 s post-revive invulnerability is hard-coded
- Final: minor (deferred): useProbeTest only invalidates the hangar; a failed refetch could bounce «Ir al hangar» back to /sonda (the screen's own useHangar makes the refetch immediate)
- Final: minor (deferred): no arrow-key navigation in the test (plan Task 6), no reduced-motion test for the reveal
- Final: minor (deferred): no server test for two concurrent first submissions (advisory-lock path)
- Final: Ruling: account deletion is blocked by the append-only trigger on probe_tests under `on delete cascade` — the existing pattern of ledger/operations/runs; account deletion is its own future work — cost if wrong: a support deletion needs the trigger disabled
- Final: Ruling: unlock stats come from client-claimed, plausibility-clipped runs — replay verification is M5; a forger can earn probes early, nothing economic — cost if wrong: early unlocks for cheaters until M5
- Final: Ruling: an invalid stored `content` silently falls back to DEFAULT_CONTENT — existing config/service behaviour, documented in DEPLOY_PRE step 7 — cost if wrong: a stale admin edit is ignored
- Final: Ruling: the five non-starter probes have no balance check — the plan calibrates the starters; the earned ones get their own pass with M3b-3's sectors — cost if wrong: one earned probe stronger than the rest until then
- Final: Ruling: choosing a probe and launching inside the same PUT round-trip returns 400 — pre-existing equality check, practically unreachable from the UI — cost if wrong: one retry
- Final: e2e after the fix pass 19/19 (21.7 min); Docker smoke was before the fix pass (code-only changes since; CI builds the image on merge)
Task 8: complete (commits 4f8162b..4077ad7, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/probe-test.test.tsx apps/web/test/hangar.test.tsx → 33/33 pass; galaxy suite 1112 passed, e2e 19/19, pgTAP 4849, root unit 5410/5410, Docker smoke)
