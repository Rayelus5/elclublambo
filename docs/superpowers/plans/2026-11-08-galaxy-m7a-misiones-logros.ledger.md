# Ledger — plan: docs/superpowers/plans/2026-11-08-galaxy-m7a-misiones-logros.md

Speed mode (owner, 2026-11-08): develop first, only the touched tests locally, CI as the gate; no separate final review.
- Task 1 (server): config keys missions/achievements (prefault defaults), migration *_galaxy_missions, missions/service.ts (countStats, missionsView, claimMission, claimAchievement, setCosmetics), hooks in runs/gacha/collection routes and refinery collect, routes, profile title/frame. Integration missions.test 2/2.
- Task 2 (web): /misiones (tabs, progress bars, Recoger), MissionsButton (trophy + badge) in the top bar, profile title + CSS frames, «Tu título y tu marco». Web tests 18/18.
- Owner report fixed on the way: «Volver al inicio» always goes home (HomeLink); the hangar says «Volver» and keeps the trail — shipped first as PR #61 (merge 7e2bd52).
- Ruling: frames are CSS rings for now (Aseprite frames later) — cost if wrong: a later art pass.
- Ruling: Profile.title/frame optional in the type (the server always sends them) — avoids touching fixtures.
- CI round 1 failed: social.test profile keys (title/frame) and operations-pool (mission configs read inside the transaction asked the pool for a second connection) → configs read before the transaction (missionConfigs), passed down. Round 2 green.
- Merged: PR #62 → develop (merge 0cc0c54), 2026-11-08.
- PRE check (deploy 0cc0c54 success) with e2e_pre_c6b959: /api/missions 401/200 (3 daily, 3 weekly, 4 season, 10 achievements), trophy → /galaxy/misiones, profile «Volver al inicio» → /galaxy, no CSP, no errors.
