begin;
select plan(7);

create function tests.td(p_text text) returns jsonb language sql as $$
  select jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object(
    'type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', p_text)))))
$$;
-- inserts a confirmed intent plus its tip directly (no chain verification involved in a read test)
create function tests.seed_tip(p_from uuid, p_to uuid, p_chain int, p_token text, p_amount numeric, p_msg uuid, p_n int)
returns void language plpgsql as $$
declare v_intent uuid;
begin
  insert into public.payment_intents (member_id, purpose, chain_id, token, amount, fee_bps, min_fee_bps, fee_amount,
                                      recipient_member_id, recipient_address, target_type, target_id, status)
  values (p_from, 'tip', p_chain, p_token, p_amount, 0, 0, 0, p_to, '0x' || lpad('abc', 40, '0'),
          case when p_msg is null then 'profile' else 'message' end, p_msg, 'confirmed')
  returning id into v_intent;
  insert into public.tips (intent_id, chain_id, from_member, to_member, target_type, message_id, token, amount,
                           fee_amount, anonymous, main_tx_hash, block_number)
  values (v_intent, p_chain, p_from, p_to, case when p_msg is null then 'profile' else 'message' end, p_msg, p_token,
          p_amount, 0, false, '0x' || lpad(to_hex(p_n), 64, '0'), 1);
end;
$$;

select set_config('t.a', tests.create_member('0x' || lpad('d6200', 40, '0'), null, true)::text, true);
select set_config('t.b', tests.create_member('0x' || lpad('d6201', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.h', tests.create_member('0x' || lpad('d6202', 40, '0'), current_setting('t.a')::uuid)::text, true);
select set_config('t.ua', (select auth_user_id::text from public.members where id = current_setting('t.a')::uuid), true);
select set_config('t.ub', (select auth_user_id::text from public.members where id = current_setting('t.b')::uuid), true);
select set_config('t.uh', (select auth_user_id::text from public.members where id = current_setting('t.h')::uuid), true);

select set_config('t.cat', tests.create_channel(null, 'category', 'T620cat')::text, true);
select set_config('t.ch', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't620')::text, true);
select set_config('t.hid', tests.create_channel(current_setting('t.cat')::uuid, 'text', 't620hidden')::text, true);
insert into public.permission_overwrites (channel_id, target_type, target_id, allow, deny)
  values (current_setting('t.hid')::uuid, 'member', current_setting('t.h')::uuid, 0, 1);

select tests.authenticate_as(current_setting('t.ub')::uuid);
select set_config('t.m1', public.post_message(current_setting('t.ch')::uuid, tests.td('visible'), 'x', false, null, null, '[]'::jsonb)::text, true);
select set_config('t.m2', public.post_message(current_setting('t.hid')::uuid, tests.td('hidden'), 'x', false, null, null, '[]'::jsonb)::text, true);
select tests.clear_authentication();

-- 150 USDC tips of 1 on chain 59141 (profile tips), more than the 100-row cap of member_tips
select tests.seed_tip(current_setting('t.a')::uuid, current_setting('t.b')::uuid, 59141, 'USDC', 1000000, null, n)
  from generate_series(1, 150) n;
-- other chain, other token, one visible message tip and one in the hidden channel
select tests.seed_tip(current_setting('t.a')::uuid, current_setting('t.b')::uuid, 59144, 'USDC', 7000000, null, 1000);
select tests.seed_tip(current_setting('t.a')::uuid, current_setting('t.b')::uuid, 59141, 'ETH', 12345678901234567890, current_setting('t.m1')::uuid, 1001);
select tests.seed_tip(current_setting('t.a')::uuid, current_setting('t.b')::uuid, 59141, 'USDC', 5000000, current_setting('t.m2')::uuid, 1002);

select tests.authenticate_as(current_setting('t.ua')::uuid);
select is((select t.total_text || '/' || t.tip_count::text from public.member_tips_totals(current_setting('t.b')::uuid, 59141) t where t.token = 'USDC'),
  '155000000/151', 'sums every tip on the chain beyond 100 (150 profile tips + 1 message tip)');
select is((select t.total_text from public.member_tips_totals(current_setting('t.b')::uuid, 59141) t where t.token = 'ETH'),
  '12345678901234567890', 'exact big amounts as text');
select is((select t.total_text from public.member_tips_totals(current_setting('t.b')::uuid, 59144) t where t.token = 'USDC'),
  '7000000', 'filters by chain');
select is((select count(*)::int from public.member_tips_totals(current_setting('t.b')::uuid, 59144)), 1, 'no other tokens on the other chain');
select tests.authenticate_as(current_setting('t.uh')::uuid);
select is((select t.total_text from public.member_tips_totals(current_setting('t.b')::uuid, 59141) t where t.token = 'USDC'),
  '150000000', 'a viewer without access to the channel does not count its message tips');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.member_tips_totals(uuid,int)', 'execute'), 'anon cannot read totals');
select ok(has_function_privilege('authenticated', 'public.member_tips_totals(uuid,int)', 'execute'), 'authenticated can');

select * from finish();
rollback;
