-- Complete skin packs in the shop (2026-11-17): a `set` product gives several pieces at once, only the ones the
-- player does not have yet. A refund or a dispute takes back exactly those, never a piece the player already had.
--   granted_pieces  the pieces a paid purchase gave, as [{ "kind": "skin", "id": "skin-…" }, …] (null: none).

alter table galaxy.shop_purchases add column granted_pieces jsonb;
