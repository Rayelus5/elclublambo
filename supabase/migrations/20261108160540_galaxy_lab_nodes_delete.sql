-- Galaxy Survivor M6d-4 (GDD §16.2): an admin can take a player's Laboratorio node back to 0, which deletes its row
-- (levels are 1–10; no row is level 0). The change is audited in admin_audit_log.

grant delete on galaxy.lab_nodes to galaxy_api;
