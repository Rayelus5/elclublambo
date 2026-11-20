-- The collection ordered by name (the owner, 2026-11-14): A–Z and Z–A page through each owner's live galaxies with a
-- keyset cursor on (name, id). Oldest first reads galaxies_owner_live backwards; the star dust order is a computed
-- expression over one owner's galaxies (a few hundred to a few thousand rows), sorted after galaxies_owner_live.
create index if not exists galaxies_owner_name on galaxy.galaxies (owner_id, name, id) where disintegrated_at is null;
