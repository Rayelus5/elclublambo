# Task 1 report: Spike Realtime privado

Status: DONE (gate PASS)

## Built
- supabase/migrations/20261016200000_realtime_spike.sql: SELECT policy on realtime.messages (regex then can_view) + public._spike_emit(uuid) (definer, search_path '', revoked from public/anon/authenticated, granted to service_role).
- tests/integration/realtime-auth.test.ts (node env docblock).
- docs/superpowers/notes/2026-10-16-realtime-spike.md (API + findings).

## TDD
RED (migration absent): 3 failed; subscriptions never reached SUBSCRIBED (status TIMEOUT). Earlier REDs: invalid_tree (text channel needs category parent), jsdom WebSocket Event error (fixed with node env).
GREEN after pnpm db:reset: Tests 3 passed | 1 skipped.

Observations (console):
- A status SUBSCRIBED | B (denied) status TIMEOUT
- after VIEW revoked, same subscription received: true
- resubscribe status after revoke: CHANNEL_ERROR: Unauthorized: You do not have permissions to read from this Channel topic
- resubscribed after revoke received: false

## Other suites
pnpm db:test: PASS (542 tests, 14 files). pnpm test: 386 passed, 3 skipped. typecheck and lint: no errors.

## Concerns
- Revoked VIEW does not cut an open subscription until it resubscribes (policy cached at join). Mitigated by id-only payloads and RLS re-read; Task 5/8 should resubscribe on token refresh/visibility. Whether setAuth on the same socket re-evaluates is untested.
- Denied join surfaces as TIMEOUT at first attempt, CHANNEL_ERROR on resubscribe.
