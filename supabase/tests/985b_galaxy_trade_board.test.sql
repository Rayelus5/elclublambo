-- Galaxy Survivor (20261114160000_galaxy_trade_board): the public trade board. A post gives galaxies and/or coins and
-- names what it is after; nothing of it is held; a short note; a trade can name the post it answers. Only galaxy_api
-- reaches them, and posts are never deleted.
begin;
select plan(11);

select has_table('galaxy', 'trade_posts', 'the board''s posts');
select has_table('galaxy', 'trade_post_items', 'the galaxies a post gives');
select has_column('galaxy', 'trades', 'post_id', 'a trade can answer a post');
select ok(has_table_privilege('galaxy_api', 'galaxy.trade_posts', 'select, insert, update')
      and not has_table_privilege('galaxy_api', 'galaxy.trade_posts', 'delete')
      and not has_table_privilege('anon', 'galaxy.trade_posts', 'select'),
  'galaxy_api posts and closes; nothing is deleted and nobody else reaches them');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'galaxy' and c.relname = 'trade_posts'), 'row level security on posts');
select has_index('galaxy', 'trade_posts', 'trade_posts_board', 'the board reads the newest open posts by an index');

insert into galaxy.accounts (id, username, password_hash) values ('00000000-0000-4000-8000-0000000002a1', 'pgtap_board_a', 'x');
insert into galaxy.galaxies (id, owner_id, seed, engine_version, traits, dna, name, designation, tier, score, finish, origin) values
  ('00000000-0000-4000-8000-00000000c0a1', '00000000-0000-4000-8000-0000000002a1', 21, '1.0.0', '{}', repeat('c', 64), 'Del tablón', 'GX-ABCDE3', 2, 1, 'normal', 'pull');

select lives_ok($$insert into galaxy.trade_posts (id, author_id, wants, note, expires_at)
                  values ('00000000-0000-4000-8000-0000000075a1', '00000000-0000-4000-8000-0000000002a1', '{"tiers": ["legendary"], "coins": true}', 'Busco algo rojo', now() + interval '7 days')$$,
  'a post with what it is after and a note');
select lives_ok($$insert into galaxy.trade_post_items (post_id, galaxy_id) values ('00000000-0000-4000-8000-0000000075a1', '00000000-0000-4000-8000-00000000c0a1')$$,
  'it gives a galaxy');
select throws_ok($$insert into galaxy.trade_posts (author_id, note, expires_at)
                   values ('00000000-0000-4000-8000-0000000002a1', repeat('x', 141), now() + interval '7 days')$$,
  '23514', null, 'a note is short');
select throws_ok($$update galaxy.trade_posts set status = 'closed' where id = '00000000-0000-4000-8000-0000000075a1'$$,
  '23514', null, 'a closed post says when');
select throws_ok($$insert into galaxy.trade_posts (author_id, coins, expires_at)
                   values ('00000000-0000-4000-8000-0000000002a1', -5, now() + interval '7 days')$$,
  '23514', null, 'no negative coins');

select * from finish();
rollback;
