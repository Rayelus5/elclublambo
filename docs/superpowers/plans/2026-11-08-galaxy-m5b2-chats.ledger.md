# SDD ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m5b2-chats.md

Spec: games/galaxy/docs/GDD.md §14.4, §14.3 (reachable).
Pre-flight:
- T1→T3: chat config, maskWords, cleanBody, ChatMessage/ChatHistory/ChatEvent, schemas, errors — consistent.
- T2→T3: chat_messages / chat_reports / chat_mutes — consistent.
- T3→T4: GET history, POST send/report/hide/mutes, the socket's ChatEvent JSON — consistent.
- Task 1: Ruling: ChatHistory also carries minLevel, maxLength and moderator so the panel can say what writing needs, count against the live maximum and show moderator actions without another request — cost if wrong: none
- Task 1: Ruling: line breaks are kept (Shift+Enter in the panel) with at most one blank line in a row; control and invisible format characters (Cc, Cf: zero-width, bidi) are removed — cost if wrong: none
Task 1: complete (commits c79182a..731a44e, tests: pnpm -C games/galaxy exec vitest run --project unit packages/shared/test/chat.test.ts →    Duration  542ms (import 55%, transform 40%, tests 3%, worker 1%))
- Task 2: Ruling: the body's DB check allows 1–1000 characters (a backstop over chat.maxLength, which the config can raise to 1000); hidden_at and hidden_reason go together — cost if wrong: none
- Task 2: complete (commits 731a44e..ff8473a, tests: pnpm exec supabase test db → PASS, 113 files, 4946 tests)
Task 3: Ruling: CSP stays `connect-src 'self'` — CSP3 'self' matches same-origin wss: in every evergreen browser (Safari ≥15.4) — cost if wrong: an old Safari gets no live push; history still loads on open and after each send
Task 3: Ruling: the socket checks origin before session (4403 first) and the hub reads clan members at broadcast time — leaving a clan stops its channel at once without tracking memberships per socket — cost: one indexed query per clan message
Task 3: Ruling: reports cap at 30 per minute per account (bucket chat_report) and a clan message can only be reported by its clan's members (else 404) — not in plan; stops report spam and probing other clans' ids — cost: none visible
Task 3: complete (commits ff8473a..HEAD, tests: vitest integration chat.test.ts → 9/9; pnpm test → 1451 passed, 7 skipped; lint clean)
Task 4: Ruling: the socket only lives while the sheet is open (no unread badge) — keeps idle clients off the server for the beta — cost if wrong: a later unread counter needs it always on
Task 4: Ruling: the sheet sits below the top bar (top 96px), opaque, under the modal dialogs; «Comunidad» toggles it and is tinted Hielo while open — shots showed it covering the balances and Salir, and ghosting — cost: none
Task 4: Ruling: the Clan tab reads only «Clan» (no tag) — the tag broke label-in-name — cost: none
Task 4: Ruling: «Silenciar 1 hora» asks for a reason in a dialog (the API requires one); «Ocultar» acts at once (moderators, reversible in M6) — cost if wrong: an accidental hide until the admin panel can undo it
Task 4: Ruling: older history («Ver anteriores») not offered: the sheet shows the last chat.history (50) messages; the server already accepts `before` — cost: no scrollback in beta
Task 4: Ruling: useChatSocket is .ts (no JSX), not .tsx as the plan listed — cost: none
Task 4: complete (commits deb3fe2..HEAD, tests: vitest web chat.test.tsx → 13/13; pnpm test → 1464 passed, 7 skipped; lint clean; local shots 1280/1600/1920 reviewed)
Task 5: Ruling: the e2e found focus falling to the page after a report (its button is replaced by «Denunciado») — fixed in ChatPanel: if the last focused element leaves the DOM, focus goes to the list; a click elsewhere never pulls it back — unit tests RED→GREEN (report and hide keep focus on the log)
Task 5: Ruling: no tunnel or CSP change for the socket — cloudflared forwards Upgrade to galaxy:8080 natively and CSP3 'self' covers same-origin wss:; DEPLOY_PRE step 16 says what to check if it stays «Reconectando» — cost if wrong: PRE check shows it and the fix is a dashboard toggle
Final review: opus, Ready to merge with fixes — 0 Critical, 4 Important, 17 Minor
Final: fixed chat open during a run takes the arena keyboard — arena test «al entrar en la incursión se cierra el chat…» RED→GREEN (arena closes the chat; arena and LevelUp ignore keys typed in fields), suite 1471/1471
Final: fixed no socket cap — integration «una cuenta tiene tres sockets como mucho» RED→GREEN (3 per account, oldest closed 4008 and final on the client; 5000 total; slow sockets terminated), suite 1471/1471
Final: fixed messages lost around a history read — web «al conectar el socket se relee el canal…» and «un mensaje que llega antes del primer historial…» RED→GREEN (invalidate on every open; queryFn merges pushes from during the read and from before the first one), suite 1471/1471
Final: fixed throwaway accounts hiding messages — integration report test RED→GREEN (only reporters at chat.minLevel or moderators count; the web hides «Denunciar» below the level), suite 1471/1471
Final: fixed (re-graded Minor→Important, players see it) cleanBody broke ZWJ emoji and ZWNJ, and zalgo towers spilled over messages — shared «los emojis compuestos…», «los controles de dirección…» (U+FEFF also became a visible space), «una torre de marcas…» RED→GREEN (NFC, keep ZWJ/ZWNJ/tags, ≤4 marks), suite 1471/1471
Final: fixed (re-graded Minor→Important, the owner hits it first) moderators below level 5 could not write — integration moderator test RED→GREEN, suite 1471/1471
Final: Ruling: Task 3's «else 404» ruling was inaccurate — a reporter without a clan gets 403 clan_forbidden on a clan message; left as is (deferred minor below) — cost: an odd error text for a crafted request
Final: Ruling: Task 1's Cf ruling was wrong (it broke ZWJ emoji); replaced by the fix above
Final: minor (deferred): open sockets outlive logout elsewhere, revokeAllSessions, bans and expiry (only public content), and pongs are not checked — re-check sessions on the ping tick
Final: minor (deferred): the client goes quiet on 4401 (no reconnect, no status) — invalidate `me`
Final: minor (deferred): a reporter with no clan gets 403 clan_forbidden on a clan message; a player kicked with the Clan tab open keeps it until reopening
Final: minor (deferred): `deleted` carries the id as written in the URL (a crafted «0010» is not matched by clients) — tighten the id regex
Final: minor (deferred): mutedUntil shows only HH:MM (only matters for mutes over a day, API only until M6)
Final: minor (deferred): `ol role="log"` with `li` children trips axe's listitem rule — wrap as div[role=log] > ol
Final: minor (deferred): the clan history cache key is just 'clan': after switching clans the old clan's messages flash before the refetch
Final: minor (deferred): blank-looking letters (U+3164, U+2800) pass as non-empty messages
Final: minor (deferred): combining marks outside NFC (e.g. an extra mark on a letter) can still dodge the word filter (\p{M} not in the word pattern)
Final: minor (deferred): a message hidden during a history read can reappear until the next read
Final: minor (deferred): «Denunciado» is forgotten when the sheet closes
Final: minor (deferred): test gaps — rejected sends neither stored nor pushed, quota unspent on rejections, a moderator hide's `deleted` on a socket
Final: merged PR #49 (merge a927a63) on green CI (12m23s); PRE check pending at archive time
