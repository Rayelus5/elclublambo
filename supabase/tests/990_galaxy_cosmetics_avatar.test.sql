-- Galaxy Survivor, November plan C2 (migration *_galaxy_cosmetics_avatar): avatars as cosmetics, the chosen avatar and
-- the profile banner.
begin;
select plan(6);

select has_column('galaxy', 'accounts', 'avatar', 'accounts.avatar');
select has_column('galaxy', 'accounts', 'banner', 'accounts.banner');

insert into galaxy.accounts (id, username, password_hash) values
  ('00000000-0000-4000-8000-0000000000c2', 'pgtap_cosmetics', 'x');

select lives_ok($$insert into galaxy.cosmetics (account_id, kind, value)
                  values ('00000000-0000-4000-8000-0000000000c2', 'avatar', 'portrait-hive')$$,
  'an avatar is a cosmetic');
select throws_ok($$insert into galaxy.cosmetics (account_id, kind, value)
                   values ('00000000-0000-4000-8000-0000000000c2', 'badge', 'x')$$,
  '23514', null, 'only titles, frames and avatars');
select throws_ok($$update galaxy.accounts set avatar = 'Crew Pilot' where id = '00000000-0000-4000-8000-0000000000c2'$$,
  '23514', null, 'an avatar id is lowercase letters, digits and dashes');
select throws_ok($$update galaxy.accounts set banner = '00000000-0000-4000-8000-00000000dead' where id = '00000000-0000-4000-8000-0000000000c2'$$,
  '23503', null, 'the banner is a galaxy that exists');

select * from finish();
rollback;
