# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m6a-admin-jugadores.md
Spec: games/galaxy/docs/GDD.md §16.1, §16.2
Pre-flight: T1 types/schemas → T3 routes and T4 web; T2 column → T3 leaderboard filters — consistent
Pre-flight: Ruling: M6 split into M6a (players + audit), M6b (live config editor, switches, simulator), M6c (moderation console), M6d (mailbox, notices, stats) — §16 is four subsystems; each its own PR — cost if wrong: more PRs
Task 1: Ruling: a player's histories are generic table sections (AdminSection: rows with the same keys per section) rather than one type per section — the web renders them all with one table, labels from copy — cost: weaker typing of the rows
Task 1: Ruling: adding currency needs only a reason; taking it away (amount < 0) also needs the password (schema refine) — §16.1 «acciones destructivas» — cost: none
Task 1: complete (commits fbf3f19..HEAD, tests: vitest packages/shared/test/admin.test.ts → 6/6; typecheck clean)
Task 2: complete (commits dd8b0df..HEAD, tests: supabase test db 986_galaxy_admin_players → 3/3, watched RED first; typecheck clean)
Task 3: Ruling: revoking a galaxy marks it disintegrated (no dust paid) after taking it out of the loadout, the planetarium, the market and any open trade (also trades that only ask for it); the audit's before lists where it was — cost: none
Task 3: Ruling: a ban's end uses the DB's now() (permanent = 9999-12-31) like the session checks, never the app clock — cost: none
Task 3: Ruling: the password rate limit counts only wrong passwords (10 per 10 minutes); changes in general have a 60-per-minute limit — cost: none
Task 3: Ruling: issuing a reset code needs the password too (it hands an account over) and takes the admin's reason into the existing audit row — cost: none
Task 3: Ruling: the «market» section mixes listings (sold or bought) and trades, newest first, from the latest 200 of each — cost: a very old history is cut
Task 3: complete (commits 03da742..HEAD, tests: vitest integration admin-players.test.ts → 12/12 ×2; pnpm test → 1559 passed, 7 skipped; lint clean)
Task 4: Ruling: the admin area is its own layout (/admin, side nav), reached by a shield icon on the top bar for admins with an MFA session; the profile badge stays a badge — a link inside the profile link would nest links — cost: none
Task 4: Ruling: one generic ActionDialog (fields, reason, password when destructive, optional result) drives every change; histories render through one DataTable with labels from copy — cost: less tailored layouts per section
Task 4: complete (commits df13ead..HEAD, tests: vitest web admin.test.tsx → 8/8; pnpm test → 1567 passed, 7 skipped; lint clean)
Task 5: e2e admin-players.spec 1/1 (TOTP sign-in, grant, ban with password, audit, CSV download); local shots reviewed
Task 5: full e2e 30/31 — admin-players.spec failed once on strict mode (unfiltered audit rows kept while the filtered page loaded); fixed with toHaveCount(1), passes
Final review: opus, Ready to merge with fixes — 0 Critical, 5 Important, 13 Minor
Final: fixed the password limit let the right guess through after it tripped — past ten wrong ones in ten minutes every session of that admin closes (TOTP again) — integration «diez contraseñas equivocadas cierran la sesión del admin…» RED→GREEN
Final: Ruling + fixed staff-on-staff powers — nobody acts on a superadmin from the panel (CLI only), only a superadmin acts on other staff (staff_target), nobody targets themselves for economy, xp, rename, revoke, ban or leaderboard (self_target; closing one's own sessions is allowed) — integration «al equipo solo lo toca un superadmin…» RED→GREEN — cost if wrong: a superadmin who wants to test on their own account uses a second account
Final: fixed ban and closed sessions left chat sockets open — ChatHub.dropAccount (4401) called after commit — integration «banear o cerrar sesiones corta también el chat en vivo» RED→GREEN
Final: fixed CSV formula injection — cells starting with = + - @ tab CR get a leading apostrophe — integration CSV test RED→GREEN
Final: fixed renaming left the player page on a dead name — the page navigates to the new name — web «cambiar el nombre lleva a la ficha con el nombre nuevo» RED→GREEN
Final: minor (deferred): invalidateLeaderboard runs inside the ban transaction (a ranking computed before commit can cache the banned player 30 s); rename and xp never invalidate
Final: minor (deferred): plan deviations — taking more than the balance answers 402 (the wallet's error), the ledger ref holds {by} not the audit id
Final: minor (deferred): ban and leaderboard audit rows have no «before»; re-banning overwrites a permanent ban silently
Final: minor (deferred): the reset-code dialog closes on Escape or a veil click (the code is lost); earlier codes stay valid 24 h after a reissue
Final: minor (deferred): a rename race answers 500 instead of 409 (unique violation not caught)
Final: minor (deferred): impossible audit dates (2026-02-31) give a 500
Final: minor (deferred): IP search is an exact text match (IPv6 case, ::ffff: mapped)
Final: minor (deferred): the audit «Objetivo» filter needs a UUID the player page never shows; the CSV cuts at 5000 rows without saying so
Final: minor (deferred): copy — insufficient_funds and galaxy_not_found speak to the admin as a player; a 1-hour ban shows only a date; raw English keys for roles, rooms, lab, probes and statuses; «Semilla» is a pull seed (the stored seed differs)
Final: minor (deferred): accessibility — tabs without aria-controls/arrow keys, empty action column header, destructive dialogs not alertdialog, danger style only on ban and sessions
Final: minor (deferred): test gaps — admin without TOTP, ban with the player as side b of a trade; redeemResetCode does not drop the chat sockets
Final: minor (deferred): lower(username) is redundant (usernames are lowercase) and prevents index use; playerDetail fires 17 queries at once
Final: Ruling: the remaining §16.2 edits (luck counters, probes unlocked, station and lab state, missions, achievements, titles, frames, season score, tickets, season currency, chosen traits, run replay, flagging runs) go to M6c/M6d or the milestone that brings their feature (M7 for missions/achievements/titles) — cost: the admin cannot edit them until then
Final: merged PR #52 (merge 3b91ed0) on green CI (13m31s); PRE check pending at archive time
