begin;
select plan(22);

-- structure: categories in root order
select results_eq(
  $$ select name from public.channels where parent_id is null order by position $$,
  $$ values ('Comunidad'), ('Mercado'), ('Ayuda') $$,
  'root categories in order'
);
select is((select count(*)::int from public.channels where parent_id is null and kind = 'category' and created_by is null), 3, 'three categories, no created_by');

select results_eq(
  $$ select c.name, c.kind from public.channels c join public.channels p on p.id = c.parent_id where p.name = 'Comunidad' and p.parent_id is null order by c.position $$,
  $$ values ('General','text'), ('Reglas','text'), ('Anuncios','text'), ('Noticias','text') $$,
  'Comunidad children'
);
select results_eq(
  $$ select c.name, c.kind from public.channels c join public.channels p on p.id = c.parent_id where p.name = 'Mercado' and p.parent_id is null order by c.position $$,
  $$ values ('Trading','text'), ('Airdrops','forum'), ('Links de referidos','text') $$,
  'Mercado children'
);
select results_eq(
  $$ select c.name, c.kind from public.channels c join public.channels p on p.id = c.parent_id where p.name = 'Ayuda' and p.parent_id is null order by c.position $$,
  $$ values ('Consejos antiscam','text'), ('Soporte Técnico','text'), ('Ayuda','text') $$,
  'Ayuda children'
);
select results_eq(
  $$ select c.name, c.kind from public.channels c join public.channels p on p.id = c.parent_id where p.name = 'Airdrops' and p.kind = 'forum' order by c.position $$,
  $$ values ('L1','text'), ('L2','text') $$,
  'Airdrops children'
);

-- flags
select results_eq(
  $$ select name from public.channels where alpha_enabled order by name $$,
  $$ values ('L1'), ('L2'), ('Trading') $$,
  'alpha_enabled channels'
);
select results_eq(
  $$ select name from public.channels where tickets_enabled order by name $$,
  $$ values ('Ayuda'), ('Soporte Técnico') $$,
  'tickets_enabled channels'
);
select is((select count(*)::int from public.channels where kind <> 'category' and (topic is null or topic = '')), 0, 'every non-category channel has a topic');

-- overwrites on the read-only channels
select is(
  (select count(*)::int from public.permission_overwrites o join public.channels c on c.id = o.channel_id
    where c.name in ('Reglas', 'Anuncios', 'Consejos antiscam')), 6, 'six overwrites on read-only channels');
select is(
  (select count(*)::int from public.permission_overwrites o join public.channels c on c.id = o.channel_id
    join public.roles r on r.id = o.target_id and o.target_type = 'role'
    where c.name in ('Reglas', 'Anuncios', 'Consejos antiscam') and r.is_everyone and o.deny = 6 and o.allow = 0), 3, '@everyone deny 6');
select is(
  (select count(*)::int from public.permission_overwrites o join public.channels c on c.id = o.channel_id
    join public.roles r on r.id = o.target_id and o.target_type = 'role'
    where c.name in ('Reglas', 'Anuncios', 'Consejos antiscam') and r.name = 'Moderador' and o.allow = 6 and o.deny = 0), 3, 'Moderador allow 6');
select is((select count(*)::int from public.permission_overwrites), 6, 'no other overwrites seeded');

-- effective permissions
select set_config('t.a', tests.create_member('0x00000000000000000000000000000000000b0001', null, true)::text, true);
select set_config('t.m', tests.create_member('0x00000000000000000000000000000000000b0002', current_setting('t.a')::uuid)::text, true);
select set_config('t.mod', tests.create_member('0x00000000000000000000000000000000000b0003', current_setting('t.a')::uuid)::text, true);
insert into public.member_roles (member_id, role_id)
  select current_setting('t.mod')::uuid, id from public.roles where name = 'Moderador';

select set_config('t.reglas', (select id::text from public.channels where name = 'Reglas'), true);
select set_config('t.general', (select id::text from public.channels where name = 'General'), true);
select set_config('t.anuncios', (select id::text from public.channels where name = 'Anuncios'), true);
select set_config('t.antiscam', (select id::text from public.channels where name = 'Consejos antiscam'), true);

select ok((public.channel_permissions(current_setting('t.m')::uuid, current_setting('t.reglas')::uuid) & 1) = 1, 'member views Reglas');
select ok((public.channel_permissions(current_setting('t.m')::uuid, current_setting('t.reglas')::uuid) & 2) = 0, 'member cannot send in Reglas');
select ok((public.channel_permissions(current_setting('t.m')::uuid, current_setting('t.general')::uuid) & 2) = 2, 'member sends in General');
select ok((public.channel_permissions(current_setting('t.m')::uuid, current_setting('t.antiscam')::uuid) & 2) = 0, 'member cannot send in Consejos antiscam');
select ok((public.channel_permissions(current_setting('t.m')::uuid, current_setting('t.anuncios')::uuid) & 2) = 0, 'member cannot send in Anuncios');
select ok((public.channel_permissions(current_setting('t.mod')::uuid, current_setting('t.anuncios')::uuid) & 2) = 2, 'Moderador sends in Anuncios');
select ok((public.channel_permissions(current_setting('t.mod')::uuid, current_setting('t.reglas')::uuid) & 2) = 2, 'Moderador sends in Reglas');
select ok((public.channel_permissions(current_setting('t.mod')::uuid, current_setting('t.antiscam')::uuid) & 2) = 2, 'Moderador sends in Consejos antiscam');
select ok((public.channel_permissions(current_setting('t.m')::uuid, (select id from public.channels where name = 'L1')) & 1) = 1, 'member views L1 through the forum');

select * from finish();
rollback;
