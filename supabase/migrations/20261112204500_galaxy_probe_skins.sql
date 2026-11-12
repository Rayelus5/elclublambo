-- Galaxy Survivor, plan «banda sonora, skins, perfil y entorno», part C: probe skins. A skin is a cosmetic like an
-- avatar or a frame (won, or bought in the «Estilo» shop), and each probe wears one of its own or none (its base
-- drawing). Only drawing: runs never depend on it. The API checks the skin is the player's and of that probe; taking a
-- skin away (a refund) also takes it off the probe.
alter table galaxy.cosmetics drop constraint cosmetics_kind_check;
alter table galaxy.cosmetics add constraint cosmetics_kind_check check (kind in ('title', 'frame', 'avatar', 'skin'));

alter table galaxy.probe_levels add column skin text check (skin is null or skin ~ '^skin-[a-z0-9-]{1,40}$');
