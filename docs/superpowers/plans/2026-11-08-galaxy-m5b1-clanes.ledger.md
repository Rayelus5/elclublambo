# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m5b1-clanes.md

Spec: games/galaxy/docs/GDD.md §14.3, §14.1, §13.1 (reachable).
Pre-flight:
- T1→T3: clans config, schemas, canManage, successor, ClanCard/ClanView/ClanMember, LeaderTab 'clans', errors — consistent; T3 adds `level_too_low` (Task 1 adds it to the codes so the copy satisfies Record<ApiErrorCode>).
- T2→T3: clans / clan_members / clan_requests — consistent.
- T3→T5: routes and types — consistent; the clans tab's rows are {rank, tag, name, value}: LeaderRow gains optional tag/emblem/color for clan rows.
- T4→T5: clanEmblemUrl / clanEmblemOffset — consistent.
- Task 1: Ruling: LeaderTab gains 'clans' in Task 3 with the server tab and its web copy (added in Task 1, the leaderboard's schema would accept a tab nothing answers) — cost if wrong: none
- Task 1: Ruling: ClanView.me also says whether the viewer asked to join ({ requested: true }) so the page can offer «Cancelar solicitud» — cost if wrong: none
Task 1: complete (commits 673b9b2..048f0b6, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared →    Duration  2.79s (import 49%, transform 32%, tests 18%, worker 1%))
- Task 2: complete (commits 048f0b6..4ecfa8f, tests: pnpm exec supabase test db → PASS, 112 files, 4930 tests)
- Task 3: Ruling: cancelling a request is POST /clans/:tag/request/cancel (plan said DELETE): every other clan change is a POST and the web client's api() has no DELETE — cost if wrong: none
- Task 3: Ruling: the Clanes tab answers `clans` and `myClan` beside empty `rows` (a clan is not a LeaderRow: tag, name, emblem, colour, members); clan scores come from the General ranking (cached) summed over current members, so they follow who is in the clan now — cost if wrong: a player who leaves takes their points with them (by design, GDD «clasificación de clanes»)
- Task 3: Ruling: locks always go clan first, then account (join, accept, create), so concurrent joins and accepts cannot deadlock; the database's one-leader index and the account primary key back the invariants — cost if wrong: none
- Task 3: Ruling: the clan list filters in memory over the ranked clans (name contains, tag starts with), no SQL LIKE: nothing to escape, and the beta has few clans — cost if wrong: a scan of every clan per search at a larger scale
- Task 3: Ruling: M5a's tests that used `clans` as the example of a missing tab now use `amigos`; M5a's profile test lists the new `clan` key — cost if wrong: none
Task 3: complete (commits 4ecfa8f..15b6dae, tests: pnpm -C games/galaxy exec vitest run --project integration apps/server/test/integration →    Duration  45.76s (tests 57%, import 42%, transform 1%))
- Task 4: Ruling: after the first contact sheet the comet (read as a lollipop) became a teardrop with a tapered tail, the nebula (a blob) a two-armed spiral cloud with stars, and the ringed planet got its ring in a darker tone with the far side behind it — cost if wrong: none
Task 4: complete (commits 15b6dae..eb4f368, tests: pnpm -C games/galaxy exec vitest run --project web apps/web/test/clan-art.test.ts →    Duration  1.76s (environment 54%, setup 20%, transform 12%, import 12%, tests 1%))
- Task 5: Ruling: GET /clans answers { clans, rules } (rules = maxMembers, createCost, minLevel from live config) so «Crear clan» can show its cost and say what is missing; Task 3's integration test follows (RED→GREEN) — cost if wrong: none
- Task 5: Ruling: the web client's api() accepts PATCH (editing a clan) — cost if wrong: none
- Task 5: Ruling: the list's search waits 250 ms after the last key (one request per word, not per letter) — cost if wrong: none
- Task 5: Ruling: M5a's tests that expected the Clanes tab and the Clan tile locked now expect links (the tab and the tile go live) — cost if wrong: none
- Task 5: Ruling: shots at 1280/1600 reviewed — the dialog's «Entrada» radios inherited the text-field style (scoped to text inputs), «Ultravioleta» overflowed its picker item, the members' points header was left-aligned, and the Clanes tab said «Todavía no hay clanes» when clans existed without points (now «Ningún clan ha puntuado todavía esta temporada»); the create dialog widened to fit the eight emblems in one row — cost if wrong: none
Task 5: complete (commits eb4f368..326cdf5, tests: pnpm -C games/galaxy exec vitest run --project web → 42 files, 271 passed)
- Task 6: Ruling: the e2e sets the leader's experience in its own row (level 6) and grants coins by CLI, as relics.spec does with runs: earning level 5 by play would take five-plus minute-long runs — cost if wrong: none
- Task 6: complete (e2e clans.spec.ts 1/1 locally with setup; DEPLOY_PRE step 15)
Final review: opus reviewer — no Critical, 3 Important, 15 Minor; Ready with fixes.
- Final: fixed (Important 1) kicking did nothing on open clans — galaxy.clan_kicks (migration 20261108012636) with live clans.kickHours (24): a kicked account cannot join that clan or ask to until then (409 clan_kicked, with its copy; kickBody now says so); «un expulsado no vuelve a entrar ni a pedirlo durante 24 horas» RED→GREEN, pgTAP 982 +3 checks
- Final: Ruling (Important 1 scope): rejecting a request sets no cooldown (a rejected player may ask again; only kicks keep people out) — cost if wrong: a persistent asker can re-request; officers can reject again
- Final: fixed (Important 2) test clans could collide with earlier runs' leftovers — random 4-char base-36 tags, unique random words in names and searches, e2e tag 4 base-36 chars
- Final: fixed (Important 3) missing Review Focus tests — create replayed with one key (parallel + sequential) charges once and makes one clan; two accepts at once for the last place; a leader with only members leaving hands over to the oldest member; a leader demoting themself and a member kicking or editing get 403; the old 404 on a non-route replaced (all passed on the existing code: they pin it)
- Final: fixed (re-graded from Minor 2: a 500 and impersonation) clan names are Latin letters and 0-9 with single spaces, 3–24 characters counted as characters — shared «Lоs Halcones / 𠀀𠀀𠀀 rejected» and integration RED→GREEN
- Final: fixed (re-graded from Minor 7) search ignores accents and ñ (NFD fold) — «la búsqueda no distingue tildes ni eñes» RED→GREEN
- Final: fixed (re-graded from Minor 1: a 500 when disbanded meanwhile, a stale «open») every change re-reads the clan under its lock (lockClan: 404 when gone, current open) — by construction; the race cannot be reproduced deterministically through the API
- Final: fixed (re-graded from Minors 8, 9, 11, 14) card buttons say which clan («Unirse a X», «Solicitar entrar en X»); a player in another clan sees «Unirse» off with the reason; a pending request to a clan that opened since also offers «Unirse»; the name field has its hint and minLength; copy «Ese clan está cerrado», «…o, si no hay, al miembro más antiguo»; the counters are descriptions, not live regions — clans.test RED→GREEN (11/11)
- Final: fixed (re-graded from Minors 12, 13) the create intent key is the whole request; editing refreshes on error — no isolated test (the key and the refresh are one-liners exercised by the create and edit flows)
- Final: fixed (Minors 3, 4, 5, 15) leader_must_transfer and clansSoon removed; not_in_clan always 409; ranking() takes only the players' tabs; the e2e checks the Clanes tab's table or its empty state
- Final: Ruling (Minor 10) the Clan tile goes to /clanes, where one's own clan is shown first; its subtitle is now neutral («Tu clan y los demás») — cost if wrong: one more click to one's clan
- Final: minor (deferred): clanRanking reads every clan and membership per list/view/tab without a cache; the create response is built inside the transaction; the clan GETs have no rate limit — fine for the beta
