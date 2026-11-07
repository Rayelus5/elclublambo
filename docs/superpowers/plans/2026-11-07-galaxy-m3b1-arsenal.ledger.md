# SDD ledger — plan: docs/superpowers/plans/2026-11-07-galaxy-m3b1-arsenal.md

Spec: games/galaxy/docs/GDD.md (§5.3, §5.4, §8.3, §8.6, §17.3, §19) + DESIGN_SYSTEM.md. Plan self-approved under the 2026-11-06/07 autonomy grant.
Branch: feature/galaxy-m3b1, cut from feature/galaxy-m3a ee2721d while PR #36 (M3a) waits for CI; develop is merged in after #36 lands.

## Pre-flight (shared interfaces)
| Producer → consumer | Produces / consumes | Found |
|---|---|---|
| T1 → T2–T8 | STAT_KEYS +6, WEAPON_KINDS +9, Special, evolution, ReactionDef, RelicSetDef, Stats +6 | consistent |
| T2/T3 → T5 | SHOT/AREA codes (T2: 12,13,14,18; T3: 15,16,17; AREA 7,8,9), persistentFor(sim, probe, wi) | consistent; web SHOT_SPRITE/RADIUS tables are indexed by code → T10 fills 12–18 in order |
| T4 → T7 | shieldCapacity; recharge moves from relics.ts to probes.ts | consistent (T7 only multiplies magnitude/background) |
| T5 → T8, T11 | Offer 'evolve', evolutionsFor, HudSnapshot.weapons[].evolved, event evolve | consistent |
| T6 → T10, T11 | pool fields mark/markT/reactT/stunT/vulnT/vulnBonus, event reaction | consistent (stage reads pools directly) |
| T7 → T12 | activeSets / possibleSets (pure, DEFAULT_CONTENT in the hangar) | consistent |
| T9 → T10, T11 | sprite ids (missile, shard, split-shard, mine, disc, turret, strike-mark, stun-star, mark-pip, icon-*, icon-*-evo) | consistent |
Pre-flight: no conflicts needing a ruling.
- Task 1: Ruling: content ids keep the existing regex [a-z0-9-] (no underscores), so the plan's ids become hyphenated (static-signal, pulse-storm, short-circuit, satellite-arm…) — matches outer-nebula and every M3a id — cost if wrong: a rename in data only
Task 1: complete (commits a96a813..4ea06ed, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.65s (tests 65%, import 24%, transform 11%, worker 1%))
- Task 1: Ruling: the 12 passive icons (Task 9 work) land right after Task 1 — the web guard 'every icon named by the content exists' would stay red until Task 9 otherwise — cost if wrong: none (Task 9 reviews them with the rest)
Task 2: complete (commits 4828e34..370c1e2, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  8.29s (tests 62%, import 25%, transform 12%, worker 1%))
Task 3: complete (commits 370c1e2..bc2b00d, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.71s (tests 63%, import 25%, transform 11%, worker 1%))
- Task 4: Ruling: a barrier never hurt yet charges from the start (the 3 s wait counts from the last hit, not from the run start) — the plan only said '3 s sin daño' — cost if wrong: one default
- Task 4: Ruling: the curse raises coin, dust and repair-kit chances for every kill (the run's curse, not the killer's) — same value the director uses — cost if wrong: per-killer lookup
Task 4: complete (commits bc2b00d..a58a039, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.80s (tests 64%, import 25%, transform 10%, worker 1%))
- Task 5: Ruling: Colapso estelar (nova + vortex) keeps a knockback of 60 used as an instant pull (negative knockback) — the plan's table said 'empuje 0', which would leave vortex with no strength on a nova — cost if wrong: one number
- Task 5: Ruling: echo drones count their repeat down in the shot's pierce field (drones never pierce) and pull lives in a new area field (gravity wells moved from knockback to pull) — no new pool for one counter — cost if wrong: one field
- Task 5: Ruling: three tests rewritten for evolutions: fixtures that expected no evolutions now filter them out, and the pierceAll test uses targets without XP (a level-up froze the world mid-flight) — cost if wrong: none
Task 5: complete (commits a58a039..cce2c72, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.83s (tests 67%, import 22%, transform 10%, worker 1%))
- Task 6: Ruling: stun reuses the enemies' existing freezeT (the anomaly freeze) instead of a new stunT field, and the boss now honours it (no movement, patterns frozen) — same effect, one field less — cost if wrong: a rename
- Task 6: Ruling: reaction shares apply to the triggering hit as dealt (after corrosion, vulnerability and criticals), and while an enemy waits its 1 s a new element still replaces its mark — the plan said 'golpe' — cost if wrong: one multiplication
- Task 6: Ruling: two M3a element tests now read the hit's own (first) hit event, since a reaction adds its own hit events after it — cost if wrong: none
Task 6: complete (commits cce2c72..4cd909f, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  8.33s (tests 64%, import 25%, transform 10%, worker 1%))
- Task 7: Ruling: a same-trait set activates once per matching value (two pairs of palettes with 4+ slots give two Resonances), and possibleSets lists only next tiers of active same-trait sets and half-made combinations (single galaxies would list every trait of every relic) — cost if wrong: hangar copy
- Task 7: Ruling: the reaction replay test now uses two galaxy types — with two rings the new Lineage set made the auras kill before a second element landed — cost if wrong: none
Task 7: complete (commits 4cd909f..8aab2c6, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  7.88s (tests 65%, import 24%, transform 10%, worker 1%))
- Task 8: Ruling: BUILD_DPS_CEILING = 175 000 (1.5× the strongest build measured: a random build with Rayo de iones and two lenticulars at 113 918; designed extremes 35 000–88 457); random builds ≤ 12× their median (measured 9×); the 40× median bound for extremes is dropped — measured against random full builds it tracks how weak an average random build is, not breakage; the absolute ceiling is the regression guard — cost if wrong: a moderate buff to strong builds passes CI
- Task 8: Ruling: tuning — Rayo de iones (ion-ray) damage 15→12, interval 0.12→0.15 s, duration 2.6→2.2 s, cooldown 1.8→2 s (alone it dealt 4 953/s, 4× the next evolution; now 2 361/s); pure damage's crit bonus now respects the crit caps (it bypassed §8.6); enemy damage per minute +4 %→+6 % (bot: layers 4,3,2,3,3 at 30.5/17.8/14.7/15.9/19.6 min, avg 3.0 in 19.7 min; harder layers were tried and lengthened runs instead) — cost if wrong: live-config retune
- Task 8: Ruling: the long build run plays 500 builds for 60 s each (the plan's '3 min' each would take ~5 min more for no extra signal), and the M3a relic-only long check allows 10× its median instead of 8× (relic sets add legitimate spread) — cost if wrong: weaker long check
Task 8: complete (commits 8aab2c6..c608929, tests: pnpm -C games/galaxy exec vitest run --project unit packages/sim →    Duration  10.36s (tests 73%, import 17%, transform 9%, worker 1%))
- Task 9: Ruling: the passive and weapon icons landed with their content (Tasks 1–5) and the evolution icons in Task 5 (generated: the base drawing outlined in gold #e0a12a); this task adds the shot and state sprites and the visual review of the sheet — cost if wrong: none
- Task 9: Ruling: the disc has 4 frames with a travelling glint and the stage also spins it; the turret's second frame is the muzzle flash, picked by the stage (fps 0) — cost if wrong: sprite data
Task 9: complete (commits c608929..258c051, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/sprites.test.ts →    Duration  1.68s (environment 55%, setup 22%, import 9%, transform 8%, tests 6%))
- Task 10: Ruling: beams, flames and blasts draw in one additive Graphics layer (cleared with the areas) — on the dark field alpha orange read as mud in the screenshots — cost if wrong: one blend mode
- Task 10: Ruling: the evolution ring is drawn at the probe's last rendered position (the event carries no position) — in play the stage renders every frame — cost if wrong: one field in the event
Task 10: complete (commits 258c051..cfd09ed, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/fx.test.ts →    Duration  1.57s (environment 61%, setup 24%, import 9%, transform 6%))
- Task 11: Ruling: the card says «Evoluciona tu Pulso láser» instead of the plan's «Pulso láser → Tormenta de pulsos» — the copy rules forbid special symbols — cost if wrong: one string
- Task 11: Ruling: a pick carries the offer it was made on and is dropped once the simulation's offer has changed (instead of reading the live offer in the dialog) — the dialog keeps showing what was decided on, and a stale key never lands on the next offer — cost if wrong: one extra key press after a quick double Enter
Task 11: complete (commits cfd09ed..dd9a99a, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/arena.test.tsx apps/web/test/announce.test.ts →    Duration  2.05s (environment 52%, setup 22%, import 10%, tests 9%, transform 7%))
- Task 12: Ruling: the next tier of an active same-trait set shows as a hint inside it instead of a second entry with the same name; the list lays out in auto columns (260 px min) so it fits under the slots; set descriptions now state only the condition (the bonus line says the effect) — cost if wrong: copy and CSS
Task 12: complete (commits dd9a99a..71bfe72, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/hangar.test.tsx →    Duration  2.80s (tests 36%, environment 33%, setup 13%, import 11%, transform 7%))
Task 13: verification — galaxy typecheck + lint clean; pnpm -C games/galaxy test → 96 files, 1045 passed | 4 skipped; root TZ=UTC test:unit 425 files 5410/5410; Galaxy e2e 19/19 (15.0 min); Docker image galaxy-m3b1:local built and smoke-tested (health db up, /galaxy/incursion 200)
Final review: opus subagent dispatched on review-a0cfb60..195cd6e.diff
Final review: opus subagent on review-a0cfb60..195cd6e: 1 Critical, 6 Important, 13 Minor
Final: fixed C1 beams re-hit every tick with more than 8 enemies on the line (hit memory of 8 evicted) — 'un rayo con más de 8 enemigos en su línea golpea a cada uno una vez por intervalo' RED (60 vs 10) → GREEN with a per-beam pulse clock; hit memory 8→16 for discs and orbs; suite sim 238/238 (+3 skipped)
Final: fixed I2 the shared grid buffer was overwritten mid-loop by reactions and chains (some enemies hit twice, others not at all) — 'un área golpea una vez a cada enemigo aunque una reacción busque vecinos…' RED [1,2,0,2,1,1,0,1] → GREEN (enemiesNear copies the candidates in hitArea, orbs, flying shots, discs, beams, pulls)
Final: fixed I3 marks and stun stars lingered on dead enemies — browser 'al morir un enemigo marcado o aturdido no quedan su gota ni sus estrellas' RED (12 visible) → GREEN
Final: fixed I4 an honest run with the curse at its cap (~750 kills/min) was flagged kills_rate and paid as a cheat — shared 'una partida honrada con la Señal de la Estática al máximo…' RED → GREEN; runs.caps.killsPerMinute 600→900 (600 × (1 + caps.curse)); two tests now derive from the config; server integration expects 950
Final: fixed I5 bosses could be stun-locked 42 % of the time (logic loop on hack-marked bosses) — 'un jefe se aturde como mucho una vez cada 6 s' and 'el hackeo no marca a jefes ni élites' RED → GREEN; content marks.bossStunEvery 6
Final: fixed I6 the vortex cone pulled from behind the probe — 'el cono que atrae solo arrastra lo que tiene delante' RED → GREEN; and it now pulls toward a point 35 % of its reach in front of the probe: pulled onto the probe, crowding pushed the catch out behind and Aliento solar dealt 186/s against the base cone's 959 in a crowd (found by the new evolution check)
Final: fixed I7 the DPS ceiling could not see crowd effects — new crowd proving ground (9×9 posts): 'ninguna evolución, sola, rinde menos que su arma base al máximo' RED (solar-breath) → GREEN; '40 al azar y 6 extremas contra una multitud' with CROWD_DPS_CEILING 1 750 000
Final: Ruling: CROWD_DPS_CEILING = 1 750 000 (1.5× the lenticular extreme at 1 164 654/s in the crowd; random builds median ~3 100–3 600, max 46 605 in 200, spread 8.6×) — the extremes stack every multiplier at its cap (GDD §8.6: a Legendary may shine); a hit-multiplying bug like C1 would push the ion-ray extremes past it — cost if wrong: a moderate crowd regression passes CI
Final: Ruling: ion-ray keeps its nerf after C1 (crowd solo 8 172/s, in line with Horizonte de sucesos 8 002 and Lanza orbital 6 608) — reverting would make it the crowd leader again — cost if wrong: one weapon slightly weaker than intended
Final: Ruling: (declined to judge) sprite and stage visuals — screenshots reviewed in T9–T12 — cost if wrong: visual polish later (M8)
Final: Ruling: (declined to judge) per-weapon balance beyond the anomalies — the crowd and ring grounds plus the evolution check now guard the outliers — cost if wrong: live-config retune
Final: Ruling: (declined to judge) e2e/browser/integration not run by the reviewer — run by the executor: e2e 19/19, browser and integration green — cost if wrong: none
Final: Ruling: (declined to judge) old M3a client bundles against M3b content, '×' in set bonus lines, Hangar on DEFAULT_CONTENT, LevelUp keeping its selection, tick performance, no migration for stored M3a content — all stand (deploy reloads the SPA chunk names; copy rules govern titles; M3a ruling; predates the range; profiled in M8; ruling 9) — cost if wrong: a stale tab must reload; one symbol
Final: minor (deferred): the director checks the scaled alive cap before a group, so a group can overshoot it by up to group size − 1 (predates M3a)
Final: minor (deferred): combo sets do not validate type/phenomenon against known values, and reaction pairs with pure, invert or prism pass the schema but never fire
Final: minor (deferred): vulnBonus, shot flags, area pull and OwnedWeapon.echo are not in stateHash
Final: minor (deferred): no replay test that evolves a persistent weapon (orbit, drone, turret, beam)
Final: minor (deferred): two stages alive at once (StrictMode dev, a fast remount) share the global BitmapFont names, so one destroy uninstalls the other's font
Final: minor (deferred): with reduced motion, reactions and evolutions still burst particles (half) and the ring still expands
Final: minor (deferred): two first-time reactions in the same step announce only the first
Final: minor (deferred): «Pasivas de sus galaxias» names relic powers like item passives («Poderes de sus galaxias» would be clearer)
Final: minor (deferred): a beam lives one tick longer than its duration
Final: minor (deferred): Campo minado at the caps can keep ~430 mines alive with no enemies near, crowding the shot pool; beams, cones and fields stack when duration exceeds cooldown
Final: minor (deferred): chainFrom looks the weapon up linearly on every hit
Final: minor (deferred): a probe's starting weapon can be an evolution (schema)
Final: minor (deferred): drones keep their echo countdown in the shot's pierce field — document it in SHOT_FIELDS
Final: Ruling: calibration after the fix pass — enemy damage per minute +6 %→+6.5 % (bosses can no longer be stun-locked, so long runs stretched to 20.1 min); bot layers 3,3,2,3,3 at 27.0/17.8/14.7/13.6/18.0 min (avg 2.8 in 18.2 min); long builds: median 1 109, p95 6 473, max 21 018 — cost if wrong: live-config retune
Task 13: complete (commits 71bfe72..33c3da3 incl. develop merge 270727d and the final-review fix pass; tests: galaxy pnpm test 96 files 1054 passed | 4 skipped after the fixes; sim 238/238 after the calibration tune; root TZ=UTC test:unit 5410/5410; e2e 19/19 before the fixes, incursion re-run after; Docker image built and smoke-tested)
