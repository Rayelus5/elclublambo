-- Galaxy Survivor, real-time notices plan (2026-11-12): how notices reach a player, chosen on their profile. 'sound'
-- shows them with their chime, 'silent' shows them without it, 'off' shows none (the lists still update live).
alter table galaxy.social_prefs add column notices text not null default 'sound' check (notices in ('sound', 'silent', 'off'));
