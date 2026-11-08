# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m6d2-estadisticas.md
Spec: games/galaxy/docs/GDD.md §16.6, §16.1
Pre-flight: T1→T2 AdminStats type, STATS_PERIODS/STATS_SECTIONS and the two endpoints consumed by the web — consistent.
Task 1: Ruling: runs are counted by start time (started_at) in the bucket where they began; outcomes count the runs started in the period (open = not finished yet); buckets are UTC hours/days rendered by Postgres (to_char) so the process's time zone never shifts them — cost if wrong: a run that started before the window but ended in it is not counted.
Task 1: Ruling: «pending reports» counts messages with reports newer than their last review (the queue's own rule); pulls compare all banners together against the standard config's expected shares (one banner in the beta) — cost if wrong: misleading expected shares once event banners exist.
Task 1: Ruling: integration tests measure deltas or invariants (the local DB is shared), and the CSV quoting is tested on a crafted AdminStats via statsCsv — cost if wrong: none.
Task 1: complete (commits 4ac7ffb..de5182f, tests: bash -c 'cd games/galaxy/apps/server && pnpm exec vitest run test/integration/admin-stats.test.ts test/integration/chat.test.ts' →    Duration  3.95s (tests 56%, import 31%, transform 13%))
Task 2: Ruling: charts follow the dataviz method — runs as one-series SVG bars (≤24 px, 4 px rounded data end, hairline grid, per-bar tooltip on hover and focus, each bar named «13 h, 5 partidas», a hidden table); flows in blue #3b86d4 / out amber #c98314 and rarities real (blue bar) vs expected (ink tick), a palette validated with validate_palette.js on the panel #181a3d (all checks PASS; green/red failed CVD and was dropped); every value written next to its mark; numbers es-ES with compact notation from 100 000 — cost if wrong: none.
Task 2: Ruling: every panel section is live now, so the side nav's «Próximamente» list is gone (the old sidebar test updated) — cost if wrong: none.
Task 2: complete (commits de5182f..9c20904, tests: bash -c 'cd games/galaxy && pnpm exec vitest run --project web apps/web/test/admin-stats.test.tsx apps/web/test/admin.test.tsx' →    Duration  5.71s (tests 52%, environment 23%, import 11%, setup 9%, transform 6%))
Task 3: e2e admin-stats.spec (open from the side nav, own session counted online, 24 bars, 7 days → 7 bars, runs CSV downloaded) and admin-players.spec passed locally. Rendered and looked (dataviz step 7): fixed the y labels hidden under the last bar (a 36 px left gutter), the currency table breaking because its cells were display:grid (the grid moved inside the cell), and ungrouped numbers in the copy's sentences (fmt) — the stats web tests stayed green.
Task 3: scoped verification: typecheck 0, lint 0, vitest unit+web+integration (no config.test.ts) 1667 passed (no migration, pgTAP unchanged).
Final review: fresh opus reviewer — no Critical; 5 Important; 13 Minor; verdict "with fixes".
Final: fixed the 24 h window starting before its first hourly bar (runs of that first part-hour counted in outcomes but in no bar or tile) — from = the first bucket — test 'la ventana de 24 horas empieza donde empieza su primera barra' RED→GREEN.
Final: fixed «Conectados ahora» dropping active players (a 5 min window equal to the sessions' 5 min touch) — 10 min window; DEPLOY_PRE says what it counts — test 'un jugador cuya sesión se vio hace 7 minutos…' RED→GREEN.
Final: fixed (re-graded Minor→Important: the 24 h screenshot showed «916 en curso», mostly dead runs) — open = unfinished and younger than runs.expireHours, «sin terminar» after — test 'una partida sin terminar que ya caducó…' RED→GREEN (server), web unfinished copy shown.
Final: fixed the expected rarities misleading while welcome luck skews legendaries — a note under the table (the deeper fix, recording welcome pulls, is deferred below) — web test asserts the note (written with the fix; RED not watched separately).
Final: fixed no time indexes on the tables read every 30 s — migration *_galaxy_stats_indexes (BRIN on ledger/gacha_pulls created_at, btree runs.started_at, partial market_listings.sold_at, trades.closed_at) with pgTAP 990_galaxy_stats_indexes RED→GREEN.
Final: fixed test gaps (added; pass on the code): a sale adds a sale, its price and its commission.
Final: Ruling: the plan said «No migration»; the review's index finding makes one worth it now (tiny, append-only BRIN) — cost if wrong: none.
Final: minor (deferred): record welcome on gacha_pulls (migration) to compare welcome pulls apart (the note covers it for now).
Final: minor (deferred): «Cuentas activas» undercounts accounts whose sessions were deleted (logout); union with runs/ledger/account_ips.
Final: minor (deferred): hour labels in local time vs day labels and CSV in UTC (two «2 h» on the autumn DST day).
Final: minor (deferred): the svg role=img wraps focusable bars (nested-interactive) and adds 24–30 tab stops; use role=group or a roving tabindex.
Final: minor (deferred): currency bars share one scale across units (dust/signal invisible next to coins).
Final: minor (deferred): material/components/signal:<id> currencies show raw names.
Final: minor (deferred): market figures in compact notation have no exact value on the page.
Final: minor (deferred): while switching period, the old data shows with the new pill pressed and CSV links build from the old period (no busy cue).
Final: minor (deferred): CSV cells are not neutralised against a leading = + - @ (not exploitable today: reasons are server constants).
Final: minor (deferred): pulls CSV has a raw float for «esperado» and no «real» column.
Final: minor (deferred): the run-bucket test can flake at the turn of an hour.
Final: minor (deferred): «Exportar CSV» after the session expired saves the 401 JSON as a .csv.
Final: minor (deferred): the reason rows are always expanded (plan said expandable) and their cells are td, not th scope=row.
Final: e2e admin-stats.spec rerun after the fix pass: passed locally. Suites: server admin-stats 11/11, web stats 6/6, pgTAP PASS, typecheck 0, lint 0.
Task 3: complete (commits 9c20904..f8e3efb, tests: bash -c 'cd games/galaxy && pnpm exec vitest run --project web apps/web/test/admin-stats.test.tsx && cd apps/server && pnpm exec vitest run test/integration/admin-stats.test.ts' →    Duration  2.44s (tests 52%, import 35%, transform 13%))
Final: full suite (TZ=UTC vitest run) 1735/1736 — the one failure, clans.test.ts 'la búsqueda no distingue tildes ni eñes' (409 on create: a random 4-char tag meeting an earlier run's clan in the shared local DB), is M5b-1's and unrelated; rerun of the file 17/17.
Merged: PR #57 → develop (merge 1de5215) on green CI, 2026-11-08.
