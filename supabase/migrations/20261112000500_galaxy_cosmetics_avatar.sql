-- Galaxy Survivor, November plan C2: profile cosmetics. Players earn or buy avatars as well as titles and frames,
-- choose an avatar, and show one of their galaxies as the banner of their profile (cleared if the galaxy is deleted;
-- the server also stops showing it when the galaxy changes hands).
alter table galaxy.cosmetics drop constraint cosmetics_kind_check;
alter table galaxy.cosmetics add constraint cosmetics_kind_check check (kind in ('title', 'frame', 'avatar'));

alter table galaxy.accounts add column avatar text check (avatar is null or avatar ~ '^[a-z0-9-]{1,32}$');
alter table galaxy.accounts add column banner uuid references galaxy.galaxies (id) on delete set null;
create index accounts_banner_idx on galaxy.accounts (banner) where banner is not null;
