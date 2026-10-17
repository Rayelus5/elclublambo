-- F2a default channel structure. Runs once on a fresh database as the migration owner.
-- created_by stays null; positions follow the listed order.

do $$
declare
  v_comunidad uuid;
  v_mercado uuid;
  v_ayuda uuid;
  v_airdrops uuid;
  v_everyone uuid;
  v_moderador uuid;
  v_readonly uuid;
begin
  select id into v_everyone from public.roles where is_everyone;
  select id into v_moderador from public.roles where name = 'Moderador';
  if v_everyone is null or v_moderador is null then
    raise exception 'seed_channels: missing @everyone or Moderador role';
  end if;

  insert into public.channels (parent_id, kind, name, position) values (null, 'category', 'Comunidad', 0)
    returning id into v_comunidad;
  insert into public.channels (parent_id, kind, name, position) values (null, 'category', 'Mercado', 1)
    returning id into v_mercado;
  insert into public.channels (parent_id, kind, name, position) values (null, 'category', 'Ayuda', 2)
    returning id into v_ayuda;

  -- Comunidad
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_comunidad, 'text', 'General', 'Charla general del club.', 0),
    (v_comunidad, 'text', 'Noticias', 'Noticias del ecosistema.', 3);
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_comunidad, 'text', 'Reglas', 'Normas de convivencia. Léelas antes de participar.', 1);
  select id into v_readonly from public.channels where parent_id = v_comunidad and name = 'Reglas';
  insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
    (v_readonly, 'role', v_everyone, 0, 6),
    (v_readonly, 'role', v_moderador, 6, 0);
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_comunidad, 'text', 'Anuncios', 'Novedades oficiales del club.', 2);
  select id into v_readonly from public.channels where parent_id = v_comunidad and name = 'Anuncios';
  insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
    (v_readonly, 'role', v_everyone, 0, 6),
    (v_readonly, 'role', v_moderador, 6, 0);

  -- Mercado
  insert into public.channels (parent_id, kind, name, topic, position, alpha_enabled) values
    (v_mercado, 'text', 'Trading', 'Análisis y operativa. Publica tesis Alpha aquí.', 0, true);
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_mercado, 'forum', 'Airdrops', 'Airdrops por red.', 1)
    returning id into v_airdrops;
  insert into public.channels (parent_id, kind, name, topic, position, alpha_enabled) values
    (v_airdrops, 'text', 'L1', 'Airdrops en redes L1.', 0, true),
    (v_airdrops, 'text', 'L2', 'Airdrops en redes L2.', 1, true);
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_mercado, 'text', 'Links de referidos', 'Enlaces de referido. Solo dominios de confianza.', 2);

  -- Ayuda
  insert into public.channels (parent_id, kind, name, topic, position) values
    (v_ayuda, 'text', 'Consejos antiscam', 'Cómo detectar estafas.', 0);
  select id into v_readonly from public.channels where parent_id = v_ayuda and name = 'Consejos antiscam';
  insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny) values
    (v_readonly, 'role', v_everyone, 0, 6),
    (v_readonly, 'role', v_moderador, 6, 0);
  insert into public.channels (parent_id, kind, name, topic, position, tickets_enabled) values
    (v_ayuda, 'text', 'Soporte Técnico', 'Abre un ticket privado con el staff.', 1, true),
    (v_ayuda, 'text', 'Ayuda', 'Dudas generales y tickets.', 2, true);
end;
$$;
