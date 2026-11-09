-- Galaxy Survivor (multiplayer plan, phase 2): the lock on a galaxy. A locked galaxy is one its owner never wants to
-- lose: it cannot be fused (by hand or by the automatic fusion) nor disintegrated until the lock is lifted. It can
-- still be equipped, exhibited, sold or swapped (deliberate acts, each with its own confirmation).

alter table galaxy.galaxies add column locked boolean not null default false;
