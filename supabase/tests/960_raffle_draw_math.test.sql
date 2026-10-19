-- F4d Task 1: verifiable raffle draw math. _keccak256 (plpgsql Keccak-f[1600], original 0x01 padding), the
-- big-endian uint256 reader, the weighted walk and the service-only raffle_draw_preview. The keccak and draw
-- values are copied literally from tests/fixtures/raffle-draw.json (generated with viem); the same fixture pins the
-- TS mirror (tests/unit/treasury/raffle-draw.test.ts) and the SQL/TS parity test (tests/integration).
begin;
select plan(36);

-- ===== 1. signatures, privileges, definer =====
select has_function('public', '_keccak256', array['bytea'], '_keccak256(bytea) exists');
select has_function('public', '_uint256_be', array['bytea'], '_uint256_be(bytea) exists');
select has_function('public', '_raffle_pick', array['numeric', 'numeric[]'], '_raffle_pick(numeric, numeric[]) exists');
select has_function('public', 'raffle_draw_preview', array['text', 'text', 'numeric[]'],
  'raffle_draw_preview(text, text, numeric[]) exists');
select ok(has_function_privilege('service_role', 'public.raffle_draw_preview(text,text,numeric[])', 'execute')
      and not has_function_privilege('authenticated', 'public.raffle_draw_preview(text,text,numeric[])', 'execute')
      and not has_function_privilege('anon', 'public.raffle_draw_preview(text,text,numeric[])', 'execute'),
  'raffle_draw_preview is executable by service_role only');
select ok(not exists (
    select 1 from unnest(array['public._keccak256(bytea)', 'public._uint256_be(bytea)',
                               'public._raffle_pick(numeric,numeric[])']) f,
                  unnest(array['anon', 'authenticated', 'service_role']) r
     where has_function_privilege(r, f, 'execute')),
  '_keccak256, _uint256_be and _raffle_pick are executable by nobody but the owner');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
            where oid in ('public._keccak256(bytea)'::regprocedure, 'public._uint256_be(bytea)'::regprocedure,
                          'public._raffle_pick(numeric,numeric[])'::regprocedure,
                          'public.raffle_draw_preview(text,text,numeric[])'::regprocedure)),
  'all four are security definer with an empty search_path');
select ok((select bool_and(provolatile = 'i' and proisstrict) from pg_proc
            where oid in ('public._keccak256(bytea)'::regprocedure, 'public._uint256_be(bytea)'::regprocedure)),
  '_keccak256 and _uint256_be are immutable and strict');

-- ===== 2. keccak256 against viem (padding boundaries, F4d-R1) =====
select is(public._keccak256(''::bytea),
  '\xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'::bytea, '_keccak256 of the empty string');
select is(public._keccak256('abc'::bytea),
  '\x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'::bytea, '_keccak256 of ''abc''');
select is(public._keccak256(decode('', 'hex')),
  decode('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'hex'), '_keccak256: empty, 0 bytes');
select is(public._keccak256(decode('616263', 'hex')),
  decode('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', 'hex'), '_keccak256: "abc", 3 bytes');
select is(public._keccak256(decode('030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dcc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b', 'hex')),
  decode('eac4c4d5d947973acaaaf33bad28714e5488451cb88283105a4a9ea1fe0bd915', 'hex'), '_keccak256: seed || blockHash, 64 bytes (the draw shape)');
select is(public._keccak256(decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80818283848586', 'hex')),
  decode('cbdfd9dee5faad3818d6b06f95a219fd290b0e1706f6a82e5a595b9ce9faca62', 'hex'), '_keccak256: 135 bytes: rate - 1, the padding is the single byte 0x81');
select is(public._keccak256(decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f8081828384858687', 'hex')),
  decode('7ce759f1ab7f9ce437719970c26b0a66ff11fe3e38e17df89cf5d29c7d7f807e', 'hex'), '_keccak256: 136 bytes: exactly the rate, the padding takes a whole extra block');
select is(public._keccak256(decode('1114171a1d202326292c2f3235383b3e4144474a4d505356595c5f6265686b6e7174777a7d808386898c8f9295989b9ea1a4a7aaadb0b3b6b9bcbfc2c5c8cbced1d4d7dadde0e3e6e9eceff2f5f8fbfe0104070a0d101316191c1f2225282b2e3134373a3d404346494c4f5255585b5e6164676a6d707376797c7f8285888b8e9194979a9da0a3a6a9', 'hex')),
  decode('0635576b15ae44e5795cb72a97b0d6d973e972d4d8d56c7aa64e9704c72fe7d0', 'hex'), '_keccak256: 137 bytes: rate + 1');
select is(public._keccak256(decode('01060b10151a1f24292e33383d42474c51565b60656a6f74797e83888d92979ca1a6abb0b5babfc4c9ced3d8dde2e7ecf1f6fb00050a0f14191e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5aaafb4b9bec3c8cdd2d7dce1e6ebf0f5faff04090e13181d22272c31363b40454a4f54595e63686d72777c81868b90959a9fa4a9aeb3b8bdc2c7ccd1d6dbe0e5eaeff4f9fe03080d12171c21262b30353a3f44494e53585d62676c71767b80858a8f94999ea3a8adb2b7bcc1c6cbd0d5dadfe4e9eef3f8fd02070c11161b20252a2f34393e43484d52575c61666b70757a7f84898e93989da2a7acb1b6bbc0c5cacfd4d9dee3e8edf2f7fc01060b10151a1f24292e33383d42474c', 'hex')),
  decode('665161ba1657813f5b2cc2c6a14a8ab5751eca8a05dd07951e5acaa96c8600b6', 'hex'), '_keccak256: 272 bytes: exactly two blocks');
select is(public._keccak256(decode('fa05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a65707b86919ca7b2bdc8d3dee9f4ff0a15202b36414c57626d78838e99a4afbac5d0dbe6f1fc07121d28333e49545f6a75808b96a1acb7c2cdd8e3eef9040f1a25303b46515c67727d88939ea9b4bfcad5e0ebf6010c17222d38434e59646f7a85909ba6b1bcc7d2dde8f3fe09141f2a35404b56616c77828d98a3aeb9c4cfdae5f0fb06111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66717c87929da8b3bec9d4dfeaf5000b16212c37424d58636e79848f9aa5b0bbc6d1dce7f2fd08131e29343f4a55606b76818c97a2adb8c3ced9e4effa05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a65707b86919ca7b2bdc8d3', 'hex')),
  decode('922d6f0377c2edb6a49776d937a76f05b721ec7643978c1faacbe02740687a55', 'hex'), '_keccak256: 300 bytes: three blocks');

-- ===== 3. uint256 big-endian =====
select is(public._uint256_be('\xff'::bytea), 255::numeric, '_uint256_be(0xff) = 255');
select is(public._uint256_be('\x0100'::bytea), 256::numeric, '_uint256_be reads big-endian (0x0100 = 256)');
select is(public._uint256_be(decode(repeat('ff', 32), 'hex')), 2::numeric ^ 256 - 1, '32 bytes of 0xff = 2^256 - 1');

-- ===== 4. the weighted walk =====
select is(public._raffle_pick(0, '{0,5,3}'), 2, '_raffle_pick r=0 over {0,5,3} skips the zero weight');
select is(public._raffle_pick(4, '{0,5,3}'), 2, '_raffle_pick r=4 over {0,5,3} = 2');
select is(public._raffle_pick(5, '{0,5,3}'), 3, '_raffle_pick r=5 over {0,5,3} = 3');
select is(public._raffle_pick(8, '{0,5,3}'), 2, '_raffle_pick r=8 over {0,5,3}: 8 mod 8 = 0 -> 2');
select is(public._raffle_pick(7, '{0,0}'), null, '_raffle_pick over all-zero weights is null');
select is(public._raffle_pick(1, '{}'), null, '_raffle_pick over no entries is null');

-- ===== 5. raffle_draw_preview against the fixture draws =====
select is(public.raffle_draw_preview('0x030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc',
    '0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b', '{1,1,1}'::numeric[]),
  '{"commit":"0x04d1b47ed3b04c5ff6a0280293cb2ab55bd297c9c2e0c3449831b419285d7df2","random":"106188867100815727276200137309039438328669808845452583523039833177738565114133","winnerPosition":3}'::jsonb,
  'raffle_draw_preview: equal-3');
select is(public.raffle_draw_preview('0x5c7996b3d0ed0a2744617e9bb8d5f20f2c496683a0bddaf714314e6b88a5c2df',
    '0x0524436281a0bfdefd1c3b5a7998b7d6f51433527190afceed0c2b4a6988a7c6', '{3000000000123456789,0,7000000000000000000,250000000000000000,12000000000000000001}'::numeric[]),
  '{"commit":"0xf590ebd47bda9b5dd50d6fbd8be4211787990bc75da180f0fc4803c1c446a4c6","random":"109566157804373248325890097822659932644069812100743636086461848423543299576369","winnerPosition":3}'::jsonb,
  'raffle_draw_preview: weighted-1e18-zero-middle');
select is(public.raffle_draw_preview('0x4d5e6f8091a2b3c4d5e6f708192a3b4c5d6e7f90a1b2c3d4e5f60718293a4b5c',
    '0x0104070a0d101316191c1f2225282b2e3134373a3d404346494c4f5255585b5e', '{1}'::numeric[]),
  '{"commit":"0x8689a4e89f41699f7ddd1383a5a8957a83667c53ec68e32ff2597c27614c9a71","random":"87900313704199889412769127532395974000283578805991879172466571825541327694300","winnerPosition":1}'::jsonb,
  'raffle_draw_preview: single');
select is(public.raffle_draw_preview('0x2c3f5265788b9eb1c4d7eafd102336495c6f8295a8bbcee1f4071a2d40536679',
    '0x0920374e657c93aac1d8ef061d344b627990a7bed5ec031a31485f768da4bbd2', '{0,0,0}'::numeric[]),
  '{"commit":"0x0ee44280bca718893a1d0f1c470f49822d949e7bf1aad2ac125a1b07c70122ef","random":"14427431682961212886114592013736579216591132391696530625922485471042520859236","winnerPosition":null}'::jsonb,
  'raffle_draw_preview: all-zero');
select is(public.raffle_draw_preview('0xa0c5ea0f34597ea3c8ed12375c81a6cbf0153a5f84a9cef3183d6287acd1f61b',
    '0x022b547da6cff8214a739cc5ee17406992bbe40d365f88b1da032c557ea7d0f9', '{}'::numeric[]),
  '{"commit":"0xc9d55211c0427294dc3297d0e8f6ef3810160faf7260e09cdc5b6b72c4e54737","random":"87173929274308849424806445056748147451906780424199441686171055969892037470472","winnerPosition":null}'::jsonb,
  'raffle_draw_preview: empty');
select is((public.raffle_draw_preview(upper('0x030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc'),
    upper('0xc8d5e2effc091623303d4a5764717e8b98a5b2bfccd9e6f3000d1a2734414e5b'), '{1,1,1}') ->> 'random'),
  '106188867100815727276200137309039438328669808845452583523039833177738565114133',
  'raffle_draw_preview lower()s its inputs');
select throws_ok($$select public.raffle_draw_preview('0x1234', '0x' || repeat('ab', 32), '{1}')$$, 'invalid_input',
  'a short seed is invalid_input');
select throws_ok($$select public.raffle_draw_preview('0x' || repeat('ab', 32), repeat('ab', 33), '{1}')$$, 'invalid_input',
  'a block hash without 0x is invalid_input');
select throws_ok($$select public.raffle_draw_preview(null, '0x' || repeat('ab', 32), '{1}')$$, 'invalid_input',
  'a null seed is invalid_input');

select * from finish();
rollback;
