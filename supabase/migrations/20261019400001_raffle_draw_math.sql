-- F4d Task 1: the verifiable raffle draw math (my decision 9). The SQL result is the one that counts; the TS mirror in
-- src/lib/treasury/raffle-draw.ts (viem) powers the public verifier, and tests/fixtures/raffle-draw.json pins both.
--   commit = keccak256(seed)                          seed: 32 bytes
--   random = uint256(keccak256(seed || blockHash))    64 bytes in, read big-endian
--   r      = random mod total weight
--   winner = first 1-based position whose running sum of weights is > r (weight 0 never wins; total 0 -> null)
--
-- _keccak256 is Keccak-256 as Ethereum uses it: Keccak-f[1600], 24 rounds, rate 136 bytes, capacity 512 bits, the
-- original multi-rate padding 0x01 .. 0x80 (NOT SHA3-256's 0x06 domain byte), 32 bytes squeezed. Round constants and
-- rotation offsets are those of the Keccak reference (keccak.team, "Keccak specifications summary", and FIPS 202
-- §3.2.2 / §3.2.5, checked 2026-10-19); the fixture (viem-generated, padding-boundary lengths of F4d-R1) pins them.
-- Lanes are bit(64), not bigint: bigint >> is arithmetic and the top bit cannot be masked without overflow. A lane is
-- 8 input bytes read little-endian: the bytes are reversed, then cast ('x' || hex)::bit(64), so the bit string holds
-- the lane's integer most-significant bit first and rotl(v, n) = (v << n) | (v >> (64 - n)).
-- None of the helpers is granted to any API role; raffle_draw_preview is service-only.

-- ===== keccak256 =====
create function public._keccak256(p_input bytea)
returns bytea
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  -- iota round constants RC[0..23]
  v_rc constant bit(64)[] := array[
    x'0000000000000001', x'0000000000008082', x'800000000000808A', x'8000000080008000',
    x'000000000000808B', x'0000000080000001', x'8000000080008081', x'8000000000008009',
    x'000000000000008A', x'0000000000000088', x'0000000080008009', x'000000008000000A',
    x'000000008000808B', x'800000000000008B', x'8000000000008089', x'8000000000008003',
    x'8000000000008002', x'8000000000000080', x'000000000000800A', x'800000008000000A',
    x'8000000080008081', x'8000000000008080', x'0000000080000001', x'8000000080008008']::bit(64)[];
  -- rho offsets r[x, y] at index x + 5y (+1): rows y = 0..4
  v_rot constant int[] := array[
     0,  1, 62, 28, 27,
    36, 44,  6, 55, 20,
     3, 10, 43, 25, 39,
    41, 45, 15, 21,  8,
    18,  2, 61, 56, 14];
  v_zero constant bit(64) := x'0000000000000000';
  v_a bit(64)[];
  v_b bit(64)[];
  v_c bit(64)[];
  v_d bit(64)[];
  v_msg bytea;
  v_pad int;
  v_h text;
  v_t bit(64);
  v_n int;
  v_out text := '';
  i int; j int; x int; y int; v_round int;
begin
  -- pad: 0x01, zeros, 0x80 (one byte 0x81 when a single byte is left in the block)
  v_pad := 136 - (length(p_input) % 136);
  if v_pad = 1 then
    v_msg := p_input || '\x81'::bytea;
  else
    v_msg := p_input || '\x01'::bytea || decode(repeat('00', v_pad - 2), 'hex') || '\x80'::bytea;
  end if;

  v_a := array_fill(v_zero, array[25]);
  for i in 0 .. length(v_msg) / 136 - 1 loop
    -- absorb 17 little-endian lanes
    for j in 0 .. 16 loop
      v_h := encode(substring(v_msg from i * 136 + j * 8 + 1 for 8), 'hex');
      v_a[j + 1] := v_a[j + 1] # ('x' || substr(v_h, 15, 2) || substr(v_h, 13, 2) || substr(v_h, 11, 2)
                                       || substr(v_h, 9, 2) || substr(v_h, 7, 2) || substr(v_h, 5, 2)
                                       || substr(v_h, 3, 2) || substr(v_h, 1, 2))::bit(64);
    end loop;

    -- Keccak-f[1600]
    for v_round in 1 .. 24 loop
      -- theta
      v_c := array_fill(v_zero, array[5]);
      for x in 0 .. 4 loop
        v_c[x + 1] := v_a[x + 1] # v_a[x + 6] # v_a[x + 11] # v_a[x + 16] # v_a[x + 21];
      end loop;
      v_d := array_fill(v_zero, array[5]);
      for x in 0 .. 4 loop
        v_t := v_c[(x + 1) % 5 + 1];
        v_d[x + 1] := v_c[(x + 4) % 5 + 1] # ((v_t << 1) | (v_t >> 63));
      end loop;
      for j in 0 .. 24 loop
        v_a[j + 1] := v_a[j + 1] # v_d[j % 5 + 1];
      end loop;

      -- rho and pi: B[y, 2x + 3y] = rotl(A[x, y], r[x, y])
      v_b := array_fill(v_zero, array[25]);
      for x in 0 .. 4 loop
        for y in 0 .. 4 loop
          v_t := v_a[x + 5 * y + 1];
          v_n := v_rot[x + 5 * y + 1];
          if v_n <> 0 then
            v_t := (v_t << v_n) | (v_t >> (64 - v_n));
          end if;
          v_b[y + 5 * ((2 * x + 3 * y) % 5) + 1] := v_t;
        end loop;
      end loop;

      -- chi: A[x, y] = B[x, y] xor (not B[x+1, y] and B[x+2, y])
      for y in 0 .. 4 loop
        for x in 0 .. 4 loop
          v_a[x + 5 * y + 1] := v_b[x + 5 * y + 1]
                              # (~v_b[(x + 1) % 5 + 5 * y + 1] & v_b[(x + 2) % 5 + 5 * y + 1]);
        end loop;
      end loop;

      -- iota
      v_a[1] := v_a[1] # v_rc[v_round];
    end loop;
  end loop;

  -- squeeze 32 bytes: lanes 0..3, little-endian
  for j in 1 .. 4 loop
    v_h := lpad(to_hex(v_a[j]::bigint), 16, '0');
    v_out := v_out || substr(v_h, 15, 2) || substr(v_h, 13, 2) || substr(v_h, 11, 2) || substr(v_h, 9, 2)
                   || substr(v_h, 7, 2) || substr(v_h, 5, 2) || substr(v_h, 3, 2) || substr(v_h, 1, 2);
  end loop;
  return decode(v_out, 'hex');
end;
$$;

-- ===== big-endian bytes as an unsigned integer =====
create function public._uint256_be(p_bytes bytea)
returns numeric
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v numeric := 0;
  i int;
begin
  for i in 0 .. length(p_bytes) - 1 loop
    v := v * 256 + get_byte(p_bytes, i);
  end loop;
  return v;
end;
$$;

-- ===== the weighted walk: first 1-based position whose running sum is > random mod total =====
create function public._raffle_pick(p_random numeric, p_weights numeric[])
returns int
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_total numeric := 0;
  v_sum numeric := 0;
  v_r numeric;
  i int;
begin
  if p_random is null or p_random < 0 or p_weights is null
     or exists (select 1 from unnest(p_weights) w where w is null or w < 0) then
    raise exception 'invalid_input';
  end if;
  for i in 1 .. coalesce(array_length(p_weights, 1), 0) loop
    v_total := v_total + p_weights[i];
  end loop;
  if v_total = 0 then
    return null;
  end if;
  v_r := mod(p_random, v_total);
  for i in 1 .. array_length(p_weights, 1) loop
    v_sum := v_sum + p_weights[i];
    if v_sum > v_r then
      return i;
    end if;
  end loop;
  return null; -- unreachable: the full sum is the total, which is > r
end;
$$;

revoke execute on function public._keccak256(bytea), public._uint256_be(bytea), public._raffle_pick(numeric, numeric[])
  from public, anon, authenticated, service_role;

-- ===== the draw, for the parity test and server-side checks (service role) =====
create function public.raffle_draw_preview(p_seed text, p_block_hash text, p_weights numeric[])
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_seed text := lower(p_seed);
  v_hash text := lower(p_block_hash);
  v_random numeric;
begin
  if v_seed is null or v_seed !~ '^0x[0-9a-f]{64}$' or v_hash is null or v_hash !~ '^0x[0-9a-f]{64}$'
     or p_weights is null then
    raise exception 'invalid_input';
  end if;
  v_random := public._uint256_be(public._keccak256(decode(substr(v_seed, 3) || substr(v_hash, 3), 'hex')));
  return jsonb_build_object(
    'commit', '0x' || encode(public._keccak256(decode(substr(v_seed, 3), 'hex')), 'hex'),
    'random', v_random::text,
    'winnerPosition', public._raffle_pick(v_random, p_weights));
end;
$$;

revoke execute on function public.raffle_draw_preview(text, text, numeric[]) from public, anon, authenticated, service_role;
grant execute on function public.raffle_draw_preview(text, text, numeric[]) to service_role;
