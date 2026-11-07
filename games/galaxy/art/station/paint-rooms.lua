-- Galaxy Survivor: the station's rooms (GDD §10, DESIGN_SYSTEM §8 septies).
-- Paints every room at 64×44 in four frames, in editable layers (casco, maquina, efectos, averia), saves the
-- .aseprite and exports the horizontal strip the web plays with CSS steps(). Run from games/galaxy:
--   aseprite -b --script-param out=art/station --script-param web=apps/web/src/station/rooms --script art/station/paint-rooms.lua
-- Optional: --script-param only=<variant> paints just one (e.g. refinery-3, antenna-broken).
local W, H, FRAMES = 64, 44, 4
local OUT = app.params['out']
local WEB = app.params['web']
local ONLY = app.params['only']

-- Ramps, dark to light, hue-shifted: cool shadows, warm lights. The game palette's tokens sit inside them.
local ORDER = { 'steel', 'space', 'ice', 'solar', 'term', 'uv', 'nova', 'coral' }
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350', '#2a2f5e', '#3a4278', '#4b5390', '#6670b0', '#8890c4', '#b9bfe6' },
  space = { '#04050f', '#070a1c', '#0d1130' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
  term = { '#06302a', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9' },
  uv = { '#1c1450', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff', '#e0d6ff' },
  nova = { '#2a0814', '#4a0f22', '#9c2238', '#e8435a', '#ff4d6d', '#ff8fa0' },
  coral = { '#4a1a30', '#c94f7c', '#ff8fb3' },
}
-- The wall lit by a machine: steel panels pulled toward the machine's hue.
local TINT = {
  solar = { '#3a2340', '#5a2d3c', '#7a3a34' },
  ice = { '#1d2e66', '#24438a', '#2c5aa8' },
  term = { '#143c4c', '#13584f', '#17705a' },
  uv = { '#2a2470', '#3a2a9a', '#4a35b8' },
}
local S = R.steel

local WHERE = {}
for _, name in ipairs(ORDER) do
  for i, c in ipairs(R[name]) do
    if not WHERE[c] then WHERE[c] = { name, i } end
  end
end
for name, ramp in pairs(TINT) do
  for i, c in ipairs(ramp) do
    if not WHERE[c] then WHERE[c] = { 'tint-' .. name, i } end
  end
end

--- A colour moved d steps along its ramp (tints fall back to the steel they replaced).
local function shift(c, d)
  local w = WHERE[c]
  if not w then return c end
  if w[1]:sub(1, 5) == 'tint-' then
    local i = math.max(1, math.min(#S, w[2] + 3 + d))
    return S[i]
  end
  local ramp = R[w[1]]
  return ramp[math.max(1, math.min(#ramp, w[2] + d))]
end

local function hash(x, y, s)
  local h = (x * 73856093) ~ (y * 19349663) ~ (s * 83492791)
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return h % 1000
end

local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

-- Layers are tables of hex colours, nil where transparent.
local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  x, y = math.floor(x), math.floor(y)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
end
local function get(L, x, y)
  x, y = math.floor(x), math.floor(y)
  if x >= 0 and y >= 0 and x < W and y < H then return L[y][x] end
end
local function rect(L, x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(L, x, y, c) end end
end
local function hline(L, x0, x1, y, c) rect(L, x0, y, x1, y, c) end
local function vline(L, x, y0, y1, c) rect(L, x, y0, x, y1, c) end
local function disc(L, cx, cy, r, c, sy)
  sy = sy or 1
  for y = math.floor(cy - r * sy) - 1, math.ceil(cy + r * sy) + 1 do
    for x = math.floor(cx - r) - 1, math.ceil(cx + r) + 1 do
      local dx, dy = x + 0.5 - cx, (y + 0.5 - cy) / sy
      if dx * dx + dy * dy <= r * r then put(L, x, y, c) end
    end
  end
end
local function line(L, x0, y0, x1, y1, c)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do put(L, math.floor(x0 + (x1 - x0) * i / n + 0.5), math.floor(y0 + (y1 - y0) * i / n + 0.5), c) end
end
--- Lighten one ramp step where the dither says so (amount 0..1).
local function light(L, x, y, amount)
  local c = get(L, x, y)
  if c and bayer(x, y) < amount then put(L, x, y, shift(c, 1)) end
end
--- A lamp's cone on the wall: a trapezoid, lit at its core and dithered toward its edges.
local function cone(L, cx, top, bottom, w0, w1, amount)
  for y = top, bottom do
    local t = (y - top) / math.max(1, bottom - top)
    local half = (w0 + (w1 - w0) * t) / 2
    for x = math.floor(cx - half), math.ceil(cx + half) - 1 do
      local edge = 1 - math.abs(x + 0.5 - cx) / half
      light(L, x, y, amount * math.min(1, edge * 2) * (1 - t * 0.55))
    end
  end
end
--- A machine's light on the wall: steel panels pulled toward its hue, dithered with the distance.
local function glow(L, cx, cy, r, hue, strength)
  for y = 4, 37 do
    for x = 0, W - 1 do
      local dx, dy = x + 0.5 - cx, (y + 0.5 - cy) * 1.25
      local d = math.sqrt(dx * dx + dy * dy) / r
      if d < 1 then
        local c = L[y][x]
        local w = c and WHERE[c]
        if w and w[1] == 'steel' and w[2] >= 4 and w[2] <= 7 and bayer(x, y) < (1 - d) * strength * 0.75 then
          put(L, x, y, TINT[hue][math.min(3, w[2] - 3)])
        end
      end
    end
  end
end
--- A vertical cylinder shaded across its width, lit from the upper left.
local function cyl(L, x0, y0, x1, y1, ramp, lo, hi)
  for x = x0, x1 do
    local t = (x - x0) / math.max(1, x1 - x0)
    local shade = 1 - math.abs(t - 0.3) * 1.5
    local i = math.max(lo, math.min(hi, lo + math.floor(shade * (hi - lo) + 0.5)))
    vline(L, x, y0, y1, ramp[i])
  end
  vline(L, x0, y0, y1, S[2])
  vline(L, x1, y0, y1, S[2])
end
--- A bevelled box: outline, a lit top and left, a shaded bottom and right.
local function box(L, x0, y0, x1, y1, ramp, i)
  rect(L, x0, y0, x1, y1, ramp[i])
  hline(L, x0 + 1, x1 - 1, y0 + 1, ramp[math.min(#ramp, i + 2)])
  vline(L, x0 + 1, y0 + 1, y1 - 1, ramp[math.min(#ramp, i + 1)])
  hline(L, x0 + 1, x1 - 1, y1 - 1, ramp[math.max(1, i - 1)])
  rect(L, x0, y0, x1, y0, S[2]); rect(L, x0, y1, x1, y1, S[2])
  rect(L, x0, y0, x0, y1, S[2]); rect(L, x1, y0, x1, y1, S[2])
end
--- Space through glass: stars that twinkle by frame and a faint nebula.
local function space(L, x0, y0, x1, y1, f, seed)
  rect(L, x0, y0, x1, y1, R.space[2])
  for y = y0, y1 do
    for x = x0, x1 do
      local h = hash(x, y, seed)
      if h < 26 then
        local tw = (h + f) % 4
        put(L, x, y, tw == 0 and R.ice[7] or tw == 1 and R.ice[6] or tw == 2 and S[8] or S[7])
      elseif h < 70 then
        put(L, x, y, R.space[3])
      end
    end
  end
  local nx, ny = x0 + (seed * 7) % math.max(1, x1 - x0 - 8) + 4, (y0 + y1) / 2
  for y = y0, y1 do
    for x = x0, x1 do
      local d = math.sqrt((x - nx) ^ 2 + ((y - ny) * 2) ^ 2) / 7
      if d < 1 and L[y][x] == R.space[2] and bayer(x, y) < (1 - d) * 0.6 then put(L, x, y, R.uv[1]) end
    end
  end
end

-- The room's shell: ceiling with its pipe, bevelled panels with rivets, a window on space, the grated floor and the
-- bulkheads that close the cell.
local function shell(f, opt)
  local L = layer()
  rect(L, 0, 0, W - 1, H - 1, S[5])
  for y = 4, 37 do
    for x = 0, W - 1 do
      local px = x % 16
      if px == 0 then put(L, x, y, S[3]) elseif px == 1 then put(L, x, y, S[6]) end
    end
  end
  hline(L, 0, W - 1, 20, S[4]); hline(L, 0, W - 1, 21, S[3]); hline(L, 0, W - 1, 22, S[6])
  hline(L, 0, W - 1, 37, S[4])
  for _, ry in ipairs({ 6, 24 }) do
    for x = 0, W - 1 do
      local px = x % 16
      if px == 4 or px == 12 then put(L, x, ry, S[8]); put(L, x, ry + 1, S[3]) end
    end
  end
  if opt.window ~= false then
    local x0, x1, y0, y1 = opt.wx0 or 5, opt.wx1 or 58, opt.wy0 or 9, opt.wy1 or 16
    rect(L, x0 - 1, y0 - 1, x1 + 1, y1 + 1, S[2])
    hline(L, x0 - 1, x1 + 1, y1 + 2, S[7])
    space(L, x0, y0, x1, y1, f, opt.seed or 3)
    for x = x0, x1 do if x % 16 == 0 then vline(L, x, y0, y1, S[3]) end end
  end
  -- Ceiling and its pipe.
  rect(L, 0, 0, W - 1, 3, S[3]); hline(L, 0, W - 1, 0, S[1]); hline(L, 0, W - 1, 3, S[2])
  hline(L, 0, W - 1, 1, S[7]); hline(L, 0, W - 1, 2, S[5])
  for x = 6, W - 1, 12 do put(L, x, 1, S[9]); put(L, x, 2, S[8]) end
  -- Floor.
  hline(L, 0, W - 1, 38, S[9]); hline(L, 0, W - 1, 39, S[7])
  for y = 40, 41 do for x = 0, W - 1 do put(L, x, y, (x + y) % 3 == 0 and S[3] or S[5]) end end
  hline(L, 0, W - 1, 42, S[3]); hline(L, 0, W - 1, 43, S[1])
  -- Bulkheads.
  for y = 0, H - 1 do
    put(L, 0, y, S[1]); put(L, 1, y, S[2]); put(L, W - 1, y, S[1]); put(L, W - 2, y, S[2])
  end
  vline(L, 2, 4, 37, S[4]); vline(L, W - 3, 4, 37, S[4]); vline(L, 3, 4, 37, S[6])
  return L
end

--- The ceiling lamp and its cone (off in a broken room).
local function lamp(L, warm, lit)
  rect(L, 26, 3, 37, 4, S[7]); hline(L, 26, 37, 3, S[9])
  if not lit then hline(L, 27, 36, 5, S[3]); return end
  hline(L, 27, 36, 5, warm and R.solar[6] or R.ice[6])
  put(L, 27, 5, S[8]); put(L, 36, 5, S[8])
  cone(L, 31.5, 6, 37, 11, 46, 0.6)
end

-- ── The rooms ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Each returns { casco, maquina, efectos } for frame f (0..3). `lit` is false for a broken room (no lamp, no glow,
-- the machine frozen on its first frame).

local ROOMS = {}

ROOMS.scanner = function(f, lit)
  local C, M, E = shell(f, { seed = 5 }), layer(), layer()
  lamp(C, false, lit)
  if lit then glow(C, 32, 19, 26, 'ice', 0.9) end
  -- Console on the left with scan bars.
  box(M, 4, 27, 16, 37, S, 6)
  rect(M, 6, 29, 14, 33, R.space[2])
  for k = 0, 3 do
    local len = 2 + (hash(k, f, 21) % 7)
    hline(M, 6, 6 + len, 29 + k + (k > 1 and 1 or 0), k == (f % 4) and R.term[5] or R.term[3])
  end
  for x = 6, 14, 2 do put(M, x, 35, (x + f) % 4 == 0 and R.solar[5] or S[4]) end
  -- Pylon.
  for y = 29, 37 do
    local half = 3 + (y - 29) * 0.4
    for x = math.floor(32 - half), math.ceil(32 + half) - 1 do
      local t = (x + 0.5 - (32 - half)) / (2 * half)
      put(M, x, y, t < 0.3 and S[8] or t < 0.7 and S[6] or S[4])
    end
  end
  hline(M, 28, 35, 29, S[9])
  for k = 0, 2 do put(M, 29 + k * 3, 33, (k + f) % 3 == 0 and R.term[5] or R.term[2]) end
  vline(M, 31, 21, 28, S[8]); vline(M, 32, 21, 28, S[5])
  -- The dish, front on: rim, a bowl darker at the edge, a specular arc, struts to the receiver.
  local cx, cy, r = 32, 18, 11
  for y = cy - r - 1, cy + r + 1 do
    for x = cx - r - 1, cx + r + 1 do
      local dx, dy = x + 0.5 - cx, y + 0.5 - cy
      local d = math.sqrt(dx * dx + dy * dy) / r
      if d <= 1 then
        local a = math.atan(dy, dx)
        local c
        if d > 0.86 then
          c = (dx + dy < 0) and S[9] or S[6]
        elseif d > 0.62 then
          c = bayer(x, y) < (d - 0.62) * 3 and R.ice[2] or R.ice[3]
        else
          c = d < 0.3 and R.ice[4] or R.ice[3]
        end
        if d > 0.5 and d < 0.78 and a > -2.6 and a < -1.7 then c = R.ice[6] end
        put(M, x, y, c)
      end
    end
  end
  line(M, cx - 8, cy + 7, cx, cy, S[9]); line(M, cx + 8, cy + 7, cx, cy, S[8]); line(M, cx, cy - 10, cx, cy, S[9])
  local pulse = lit and (f % 2) or 0
  disc(M, cx, cy, 2 + pulse * 0.7, R.ice[5]); disc(M, cx, cy, 1, R.ice[7])
  -- Scan waves up and to the right.
  if lit then
    local rr = 13 + f * 4
    for y = 4, cy do
      for x = cx, W - 4 do
        local d = math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2)
        if math.abs(d - rr) < 0.7 and bayer(x, y) < 1 - f * 0.22 then put(E, x, y, R.ice[5]) end
      end
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.planetarium = function(f, lit)
  local C, M, E = shell(f, { seed = 11 }), layer(), layer()
  lamp(C, false, false)
  if lit then glow(C, 32, 16, 30, 'uv', 1.0) end
  -- Seats in the dark.
  for _, x0 in ipairs({ 5, 51 }) do
    for k = 0, 1 do
      rect(M, x0 + k * 4, 32, x0 + k * 4 + 2, 37, S[3]); hline(M, x0 + k * 4, x0 + k * 4 + 2, 32, S[5])
    end
  end
  -- Projector.
  box(M, 26, 32, 37, 37, S, 6)
  hline(M, 27, 36, 31, S[9])
  disc(M, 32, 30.5, 3.5, lit and R.uv[5] or R.uv[2], 0.35)
  put(M, 31, 30, lit and R.uv[6] or R.uv[3]); put(M, 32, 30, lit and R.ice[7] or R.uv[3])
  -- The beam and the galaxy: two arms of a log spiral that turn a quarter per frame (seamless: the arms repeat at π).
  local cx, cy = 32, 15
  local rot = lit and f * math.pi / 4 or 0
  if lit then
    for y = cy + 4, 29 do
      local half = 1 + (29 - y) * 0.75
      for x = math.floor(cx - half), math.ceil(cx + half) - 1 do
        if bayer(x, y) < 0.22 then put(E, x, y, R.uv[3]) end
      end
    end
  end
  local function at(r, th) return cx + r * math.cos(th), cy + r * math.sin(th) * 0.5 end
  -- Dust in the disc, thinning outward.
  for k = 0, 160 do
    local r = (hash(k, 5, 33) / 1000) ^ 0.7 * 18
    local th = hash(k, 6, 33) / 1000 * math.pi * 2 + rot
    local x, y = at(r, th)
    if hash(k, 7, 33) / 1000 > r / 22 then put(E, x, y, lit and (r < 7 and R.uv[4] or R.uv[3]) or R.uv[1]) end
  end
  for arm = 0, 1 do
    for strand = -1, 1 do
      for i = 0, 70 do
        local t = i / 70
        local r = 1.5 + t * 17
        local th = arm * math.pi + t * 3.6 + rot + strand * 0.13
        local x, y = at(r, th)
        local c = t < 0.15 and R.uv[6] or t < 0.4 and R.uv[5] or t < 0.75 and R.uv[4] or R.uv[3]
        if strand ~= 0 then c = shift(c, -1) end
        if not lit then c = shift(c, -2) end
        if strand == 0 or hash(i, arm * 3 + strand, 4) % 3 ~= 0 then put(E, x, y, c) end
      end
    end
  end
  disc(E, cx, cy, 3.4, lit and R.uv[5] or R.uv[2], 0.6)
  disc(E, cx, cy, 2.2, lit and R.uv[6] or R.uv[3], 0.6)
  disc(E, cx, cy, 1.1, lit and R.ice[7] or R.uv[3], 0.8)
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.lab = function(f, lit)
  local C, M, E = shell(f, { seed = 17, wx1 = 40 }), layer(), layer()
  lamp(C, false, lit)
  if lit then glow(C, 52, 20, 22, 'term', 0.9) end
  -- Specimen tank: glass, green liquid shaded across, a floating crystal and rising bubbles.
  box(M, 45, 5, 59, 8, S, 6); box(M, 45, 31, 59, 35, S, 6)
  cyl(M, 46, 9, 58, 30, R.term, 2, 4)
  vline(M, 48, 10, 29, R.term[5])
  local bob = lit and ({ 0, -1, -1, 0 })[f + 1] or 0
  disc(M, 52, 19 + bob, 2.5, R.uv[4]); put(M, 51, 18 + bob, R.uv[6]); put(M, 53, 21 + bob, R.uv[2])
  if lit then
    for k = 1, 6 do
      local y = 29 - ((k * 7 + f * 3) % 19)
      put(E, 47 + (k * 5) % 10, y, R.term[5])
    end
  end
  vline(M, 37, 4, 9, S[7]); line(M, 37, 9, 41, 13, S[8]); put(M, 41, 14, R.ice[5])
  -- Bench and glassware.
  hline(M, 4, 42, 30, S[9]); hline(M, 4, 42, 31, S[6]); hline(M, 4, 42, 32, S[3])
  rect(M, 6, 33, 7, 37, S[4]); rect(M, 39, 33, 40, 37, S[4])
  -- Round flask with coral.
  disc(M, 11, 26, 3.6, S[8]); disc(M, 11, 26, 2.8, R.space[2]); rect(M, 8, 27, 14, 29, R.coral[2]); hline(M, 9, 13, 26, R.coral[3])
  rect(M, 10, 20, 12, 22, S[8]); vline(M, 11, 20, 23, R.space[2])
  -- Tall cylinder with ice.
  rect(M, 17, 19, 21, 29, S[8]); rect(M, 18, 19, 20, 29, R.space[2]); rect(M, 18, 23, 20, 29, R.ice[3]); hline(M, 18, 20, 23, R.ice[5])
  -- Erlenmeyer with terminal green.
  for y = 21, 29 do
    local half = 1 + (y - 21) * 0.5
    hline(M, math.floor(28 - half), math.ceil(28 + half), y, S[8])
    if y > 21 then hline(M, math.floor(28 - half) + 1, math.ceil(28 + half) - 1, y, y > 25 and R.term[3] or R.space[2]) end
  end
  hline(M, 26, 30, 26, R.term[5])
  -- Test tubes.
  for k = 0, 3 do
    local x = 34 + k * 2
    rect(M, x, 23, x, 29, S[8])
    rect(M, x, 26, x, 29, ({ R.solar[4], R.uv[4], R.term[4], R.coral[3] })[k + 1])
  end
  hline(M, 33, 41, 27, S[6])
  if lit then
    for k = 0, 2 do
      put(E, 11 + (f % 2), 18 - ((f + k * 2) % 5), R.coral[3])
      put(E, 28 + ((f + 1) % 2), 19 - ((f + k * 3) % 6), R.term[5])
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.hangar = function(f, lit)
  local C, M, E = shell(f, { window = false }), layer(), layer()
  lamp(C, true, lit)
  -- The bay door: ribbed halves, slit windows on space, hazard band at its foot.
  rect(C, 7, 5, 56, 31, S[2])
  for y = 6, 30 do
    for x = 8, 55 do
      local rib = (y - 6) % 4
      put(C, x, y, rib == 0 and S[7] or rib == 3 and S[4] or S[6])
    end
  end
  vline(C, 31, 6, 30, S[2]); vline(C, 32, 6, 30, S[8])
  space(C, 13, 10, 22, 12, f, 41); space(C, 41, 10, 50, 12, f, 43)
  for y = 27, 30 do for x = 8, 55 do put(C, x, y, ((x + y) % 6 < 3) and R.solar[5] or S[2]) end end
  if lit then cone(C, 31.5, 6, 31, 11, 40, 0.45) end
  local blink = lit and f % 2 == 0
  disc(M, 9, 5, 1.2, blink and R.solar[6] or R.solar[2]); disc(M, 54, 5, 1.2, (lit and not blink) and R.solar[6] or R.solar[2])
  -- Clamps.
  for _, side in ipairs({ -1, 1 }) do
    local px = side < 0 and 9 or 51
    box(M, px, 19, px + 3, 34, S, 6)
    for y = 20, 33, 3 do put(M, px + 1, y, R.solar[5]) end
    local ax0, ax1 = side < 0 and px + 4 or 45, side < 0 and 18 or px - 1
    rect(M, ax0, 23, ax1, 24, R.solar[4]); hline(M, ax0, ax1, 23, R.solar[6])
  end
  -- Platform with chasing lights.
  disc(M, 32, 35, 17, S[8], 0.18); disc(M, 32, 35.5, 16, S[5], 0.16)
  rect(M, 15, 35, 48, 37, S[5]); hline(M, 15, 48, 37, S[3])
  for x = 16, 47, 4 do put(M, x, 36, lit and ((x // 4 + f) % 4 == 0) and R.solar[6] or R.solar[3]) end
  -- The probe, floating: an ice body lit from the upper left, a cyan visor, a thruster that flickers.
  local bob = lit and ({ 0, -1, -1, 0 })[f + 1] or 0
  local py = 24 + bob
  disc(M, 32, py, 6.4, S[2])
  for y = py - 6, py + 6 do
    for x = 26, 38 do
      local dx, dy = x + 0.5 - 32, y + 0.5 - py
      local d = math.sqrt(dx * dx + dy * dy)
      if d <= 5.6 then
        local l = -(dx + dy) / 8 + (1 - d / 5.6) * 0.4
        put(M, x, y, l > 0.55 and R.ice[7] or l > 0.2 and R.ice[6] or l > -0.25 and R.ice[4] or R.ice[3])
      end
    end
  end
  rect(M, 33, py - 2, 36, py + 1, R.space[2]); hline(M, 33, 36, py - 2, S[2]); put(M, 34, py - 1, R.ice[5]); put(M, 35, py - 1, R.ice[7])
  put(M, 26, py, R.solar[4]); put(M, 25, py, lit and R.solar[6] or R.solar[3])
  disc(M, 32, 34, 5, S[4], 0.25)
  if lit then
    local flame = ({ 1, 2, 3, 2 })[f + 1]
    for k = 0, flame do
      hline(E, 31, 33, py + 6 + k, k == 0 and R.solar[7] or k < 2 and R.solar[5] or R.solar[4])
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.collider = function(f, lit)
  local C, M, E = shell(f, { seed = 23 }), layer(), layer()
  lamp(C, false, lit)
  if lit then glow(C, 32, 22, 30, 'uv', 0.8) end
  local cx, cy, rx, ry = 32, 22, 23, 9
  for _, x in ipairs({ 13, 49 }) do box(M, x, 28, x + 2, 37, S, 5) end
  -- The ring's back half, then the chamber, then the front half over it.
  local function tube(front)
    for i = 0, 359 do
      local th = math.rad(i)
      local s = math.sin(th)
      if (s >= 0) == front then
        local x, y = cx + rx * math.cos(th), cy + ry * s
        if front then
          put(M, x, y - 1, S[9]); put(M, x, y, S[6]); put(M, x, y + 1, S[4]); put(M, x, y + 2, S[2])
          if lit and ((i // 6) + f * 2) % 8 == 0 then put(M, x, y, R.uv[5]) end
        else
          put(M, x, y - 1, S[6]); put(M, x, y, S[4])
        end
      end
    end
    for k = 0, 7 do
      local th = k * math.pi / 4 + math.pi / 8
      if (math.sin(th) >= 0) == front then
        local x, y = cx + rx * math.cos(th), cy + ry * math.sin(th)
        rect(M, x - 1, y - 2, x + 1, y + 2, R.uv[3]); hline(M, x - 1, x + 1, y - 2, R.uv[5]); put(M, x, y, lit and R.uv[6] or R.uv[2])
      end
    end
  end
  tube(false)
  disc(M, cx, cy, 4.5, S[2]); disc(M, cx, cy, 3.8, S[6]); disc(M, cx - 1, cy - 1, 2, S[8]); disc(M, cx, cy, 2, lit and R.uv[5] or R.uv[2]); put(M, cx, cy, lit and R.ice[7] or R.uv[3])
  vline(M, cx, cy + 5, 37, S[5]); vline(M, cx + 1, cy + 5, 37, S[3])
  tube(true)
  -- Two particles running opposite ways, and the collision on the last frame.
  if lit then
    for p = 0, 1 do
      local dir = p == 0 and 1 or -1
      for k = 0, 3 do
        local th = dir * (f * math.pi / 2 - k * 0.12) + p * math.pi + 0.4
        put(E, cx + rx * math.cos(th), cy + ry * math.sin(th), k == 0 and R.ice[7] or k == 1 and R.uv[6] or R.uv[5])
      end
    end
    if f == 3 then
      disc(E, cx, cy, 5.5, R.uv[5]); disc(E, cx, cy, 3, R.uv[6]); disc(E, cx, cy, 1.5, R.ice[7])
      for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do line(E, cx + d[1] * 6, cy + d[2] * 4, cx + d[1] * 9, cy + d[2] * 6, R.uv[6]) end
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.comms = function(f, lit)
  local C, M, E = shell(f, { window = false }), layer(), layer()
  lamp(C, false, lit)
  if lit then glow(C, 32, 14, 30, 'ice', 0.7) end
  for k = 0, 2 do
    local x0 = 5 + k * 19
    box(M, x0, 6, x0 + 16, 21, S, 5)
    rect(M, x0 + 2, 8, x0 + 14, 19, R.space[2])
    if k == 0 then
      for x = x0 + 2, x0 + 14 do
        local y = 13.5 + 3.5 * math.sin((x + (lit and f * 3 or 0)) * 0.7) * math.sin(x * 0.21)
        put(M, x, y, lit and R.term[4] or R.term[2]); put(M, x, y + 1, R.term[2])
      end
    elseif k == 1 then
      local cxx, cyy = x0 + 8, 13.5
      for i = 0, 359, 6 do put(M, cxx + 5 * math.cos(math.rad(i)), cyy + 5 * math.sin(math.rad(i)), R.term[2]) end
      hline(M, x0 + 3, x0 + 13, 13, R.term[1]); vline(M, cxx, 9, 18, R.term[1])
      local th = (lit and f or 0) * math.pi / 2 - math.pi / 4
      line(M, cxx, cyy, cxx + 5 * math.cos(th), cyy + 5 * math.sin(th), R.term[4])
      put(M, cxx + 2, cyy - 3, (lit and f % 2 == 0) and R.solar[5] or R.solar[3]); put(M, cxx - 3, cyy + 2, R.term[5])
    else
      for row = 0, 4 do
        local len = 4 + hash(row + (lit and f or 0), 3, 61) % 8
        hline(M, x0 + 3, x0 + 3 + len, 9 + row * 2, row == 4 and R.ice[6] or R.ice[4])
      end
      if lit and f % 2 == 0 then put(M, x0 + 13, 17, R.ice[7]) end
    end
  end
  -- Desk, buttons and a microphone.
  hline(M, 5, 58, 28, S[9]); hline(M, 5, 58, 29, S[7]); rect(M, 5, 30, 58, 37, S[5]); hline(M, 5, 58, 37, S[3])
  for x = 8, 56, 3 do
    local h = hash(x, 0, 71) % 3
    local on = lit and (hash(x, f, 73) % 3 ~= 0)
    put(M, x, 32, on and ({ R.term[4], R.solar[5], R.nova[5] })[h + 1] or S[3])
  end
  rect(M, 12, 34, 22, 35, S[3]); rect(M, 41, 34, 51, 35, S[3])
  vline(M, 30, 22, 27, S[8]); disc(M, 30, 21, 1.6, S[9]); put(M, 30, 21, S[6])
  return { casco = C, maquina = M, efectos = E }
end

local function refinery(level)
  return function(f, lit)
    local C, M, E = shell(f, { seed = 29, wy1 = 13 }), layer(), layer()
    lamp(C, true, lit)
    if lit then glow(C, 32, 24, 18 + level * 3, 'solar', 0.65 + level * 0.07) end
    rect(M, 4, 6, 59, 7, S[5]); hline(M, 4, 59, 6, S[8])
    local n = level
    local total = n * 9 + (n - 1) * 2
    local x0 = math.floor((W - total) / 2)
    for k = 0, n - 1 do
      local x = x0 + k * 11
      vline(M, x + 4, 8, 9, S[6])
      box(M, x, 10, x + 8, 12, S, 6)
      cyl(M, x, 13, x + 8, 33, S, 4, 8)
      hline(M, x, x + 8, 18, S[3]); hline(M, x, x + 8, 28, S[3])
      put(M, x + 1, 18, S[9]); put(M, x + 7, 18, S[9]); put(M, x + 1, 28, S[9]); put(M, x + 7, 28, S[9])
      -- The window on the molten material, its surface bubbling.
      rect(M, x + 3, 14, x + 5, 31, R.space[2])
      local top = 19 + ((k + (lit and f or 0)) % 3)
      for y = top, 31 do
        put(M, x + 3, y, R.solar[3]); put(M, x + 4, y, y == top and R.solar[7] or R.solar[5]); put(M, x + 5, y, y == top and R.solar[6] or R.solar[4])
      end
      if lit then put(E, x + 4, top + 2 + ((f * 3 + k * 5) % 8), R.solar[7]) end
      box(M, x - 1, 34, x + 9, 37, S, 5)
      put(M, x + 7, 11, (lit and (f + k) % 2 == 0) and R.term[5] or R.term[2])
      if k < n - 1 then rect(M, x + 9, 24, x + 10, 25, S[6]); hline(M, x + 9, x + 10, 24, S[8]) end
    end
    if lit then
      for k = 0, 5 do
        local hx = x0 + (hash(k, 0, 81) % total)
        local hy = 9 - ((f + k) % 3)
        if bayer(hx, hy) < 0.5 then put(E, hx, hy, R.solar[4]) end
      end
    end
    return { casco = C, maquina = M, efectos = E }
  end
end

local function antenna(level)
  return function(f, lit)
    local C, M, E = shell(f, { window = false }), layer(), layer()
    if lit then glow(C, 26, 12, 22 + level * 2, 'ice', 0.5 + level * 0.08) end
    -- A skylight over the dish.
    space(C, 18, 0, 45, 3, f, 53)
    vline(C, 17, 0, 4, S[8]); vline(C, 46, 0, 4, S[8]); hline(C, 17, 46, 4, S[7])
    -- Lattice mast.
    vline(M, 31, 21, 33, S[8]); vline(M, 34, 21, 33, S[5])
    for y = 21, 31, 4 do line(M, 31, y, 34, y + 2, S[7]); line(M, 34, y + 2, 31, y + 4, S[6]) end
    box(M, 27, 33, 38, 37, S, 6)
    -- Auxiliary dishes, one per level above the first, alternating sides of the mast.
    for k = 1, level - 1 do
      local side = k % 2 == 1 and -1 or 1
      local y = 23 + (k - 1) * 3
      local x = side < 0 and 27 or 38
      hline(M, math.min(x, 32), math.max(x, 33), y + 1, S[6])
      vline(M, x, y - 1, y + 2, lit and R.ice[5] or R.ice[2]); vline(M, x - side, y, y + 1, S[8])
      put(M, x + side, y, lit and R.ice[7] or R.ice[3])
    end
    -- The main dish: a parabolic bowl tilted up and to the left, its lit face, its back, struts to the receiver.
    local cx, cy, a = 33, 19, -0.5
    local ca, sa = math.cos(a), math.sin(a)
    local function at(lx, ly) return cx + lx * ca - ly * sa, cy + lx * sa + ly * ca end
    for i = -40, 40 do
      local u = i / 40
      local lx, ly = u * 13, -5.5 * u * u
      for dpt = 3, 1, -1 do
        local x, y = at(lx, ly + dpt)
        put(M, x, y, dpt == 3 and S[4] or dpt == 2 and S[6] or S[8])
      end
      local x, y = at(lx, ly)
      put(M, x, y, (lit and (u < 0.2 and R.ice[6] or R.ice[5])) or R.ice[2])
    end
    local fx, fy = at(0, -5)
    local r1x, r1y = at(-13, -5.5)
    local r2x, r2y = at(13, -5.5)
    line(M, r1x, r1y, fx, fy, S[8]); line(M, r2x, r2y, fx, fy, S[7])
    local px, py = at(0, 1)
    line(M, px, py, 32, 21, S[7])
    disc(M, fx, fy, 1.4, lit and R.ice[6] or R.ice[2]); put(M, fx, fy, lit and R.ice[7] or R.ice[3])
    local blink = lit and f % 2 == 0
    put(M, r2x, r2y - 1, blink and R.nova[6] or R.nova[2])
    -- Signal waves leaving the focus up and to the left: clean arcs, dashed as they fade.
    if lit then
      local th0 = math.atan(-ca, sa)
      for j = 0, math.min(level, 3) - 1 do
        local rr = 4 + ((f * 4 + j * 6) % 16)
        for t = -0.75, 0.75, 0.03 do
          local th = th0 + t
          local x, y = fx + rr * math.cos(th), fy + rr * math.sin(th)
          if y >= 5 and x >= 4 and (rr < 11 or math.floor(t * 30) % 2 == 0) then
            put(E, x, y, rr < 11 and R.ice[6] or R.ice[4])
          end
        end
      end
    end
    -- Receiver with a meter as tall as the level.
    box(M, 45, 25, 59, 37, S, 6)
    rect(M, 47, 27, 57, 32, R.space[2])
    for k = 0, 4 do
      local hgt = k + 1
      local on = k < level
      for y = 32 - hgt, 32 do put(M, 48 + k * 2, y, on and (lit and R.term[4] or R.term[2]) or S[3]) end
      if on and lit and (f + k) % 4 == 0 then put(M, 48 + k * 2, 32 - hgt, R.term[5]) end
    end
    -- Captured signals waiting in capsules on a shelf.
    hline(M, 4, 16, 31, S[8]); hline(M, 4, 16, 32, S[5])
    for k = 0, level - 1 do
      local x = 5 + k * 2
      rect(M, x, 28, x + 1, 30, lit and R.solar[5] or R.solar[2]); put(M, x, 28, lit and R.solar[7] or R.solar[3])
    end
    return { casco = C, maquina = M, efectos = E }
  end
end

ROOMS.archive = function(f, lit)
  local C, M, E = shell(f, { window = false }), layer(), layer()
  lamp(C, false, lit)
  if lit then glow(C, 32, 20, 30, 'ice', 0.55) end
  for s, by in ipairs({ 14, 23, 32 }) do
    hline(M, 5, 58, by, S[9]); hline(M, 5, 58, by + 1, S[5]); hline(M, 5, 58, by + 2, S[2])
    for x = 6, 57, 13 do vline(M, x, by + 2, by + 4, S[4]) end
    for i = 0, 9 do
      if hash(i, s, 91) % 7 ~= 0 then
        local x = 6 + i * 5
        local on = lit and (i + s * 3 + f * 2) % 8 == 0
        local kind = ({ R.uv, R.uv, R.term, R.coral })[hash(i, s, 97) % 4 + 1]
        local face, side, top = kind[3] or kind[2], kind[2], kind[#kind - 1]
        if kind == R.coral then face, side, top = R.coral[2], R.coral[1], R.coral[3] end
        rect(M, x, by - 5, x + 3, by - 1, on and R.ice[4] or face)
        vline(M, x + 3, by - 5, by - 1, on and R.ice[3] or side)
        hline(M, x, x + 3, by - 5, on and R.ice[6] or top)
        put(M, x + 1, by - 3, on and R.ice[7] or top)
        if on then put(E, x + 1, by - 7, R.ice[5]); put(E, x + 2, by - 6, R.ice[4]) end
      end
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.trophies = function(f, lit)
  local C, M, E = shell(f, { seed = 37 }), layer(), layer()
  rect(C, 26, 3, 37, 4, S[7])
  local cups = { { 14, 30, { R.steel[6], R.steel[8], R.steel[10] } }, { 32, 27, { R.solar[3], R.solar[5], R.solar[6] } }, { 50, 31, { R.solar[2], R.solar[3], R.solar[4] } } }
  for i, cup in ipairs(cups) do
    local cx, top = cup[1], cup[2]
    rect(C, cx - 2, 3, cx + 1, 4, S[8])
    if lit then cone(C, cx - 0.5, 5, top, 4, 14, 0.7) end
    box(M, cx - 6, top, cx + 5, 37, S, 6)
    hline(M, cx - 6, cx + 5, top, S[10])
    -- The cup: a bowl, handles, a stem and a foot, shaded from the left.
    local ramp = cup[3]
    local by = top - 10
    for row, half in ipairs({ 4.5, 4.5, 3.5, 2.5, 1.5 }) do
      for x = math.floor(cx - half), math.ceil(cx + half) - 1 do
        local t = (x + 0.5 - (cx - half)) / (2 * half)
        put(M, x, by + row - 1, t < 0.3 and ramp[3] or t < 0.75 and ramp[2] or ramp[1])
      end
    end
    put(M, cx - 6, by + 1, ramp[2]); put(M, cx - 6, by + 2, ramp[1]); put(M, cx + 5, by + 1, ramp[2]); put(M, cx + 5, by + 2, ramp[1])
    vline(M, cx - 1, by + 5, by + 7, ramp[2]); vline(M, cx, by + 5, by + 7, ramp[1])
    hline(M, cx - 3, cx + 2, by + 8, ramp[2]); hline(M, cx - 3, cx + 2, by + 9, ramp[1])
    if lit and (f % 3) == i - 1 then
      local sx, sy = cx - 3, by + 1
      put(E, sx, sy, R.ice[7]); put(E, sx - 1, sy, R.ice[6]); put(E, sx + 1, sy, R.ice[6]); put(E, sx, sy - 1, R.ice[6]); put(E, sx, sy + 1, R.ice[6])
    end
  end
  return { casco = C, maquina = M, efectos = E }
end

ROOMS.refinery = refinery(1)
ROOMS.antenna = antenna(1)

-- ── The broken state ────────────────────────────────────────────────────────────────────────────────────────────
-- The room with its lights off and its machine frozen, a step darker, plus a layer of damage: a crack, a loose cable
-- sparking, the Static's noise, and a red emergency lamp that blinks and stains the wall.
local function dim(L, steps)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local c = L[y][x]
      if c then
        local w = WHERE[c]
        put(L, x, y, shift(c, (w and w[1] == 'steel') and -steps or -(steps + 1)))
      end
    end
  end
end

local function broken(paint)
  return function(f)
    local base = paint(0, false)
    dim(base.casco, 1)
    dim(base.maquina, 2)
    dim(base.efectos, 2)
    local A = layer()
    -- Emergency lamp.
    local on = f % 2 == 0
    rect(A, 53, 4, 57, 5, S[4]); hline(A, 54, 56, 5, on and R.nova[5] or R.nova[2])
    if on then
      for y = 6, 30 do
        for x = 36, 61 do
          local d = math.sqrt((x + 0.5 - 55) ^ 2 + (y + 0.5 - 6) ^ 2) / 22
          if d < 1 and bayer(x, y) < (1 - d) * 0.32 and not get(base.maquina, x, y) then put(A, x, y, R.nova[2]) end
        end
      end
    end
    -- A crack across the wall.
    local x, y = 6, 8
    while x < 44 do
      local nx, ny = x + 2 + hash(x, y, 101) % 3, y + (hash(x, y, 103) % 3) - (y > 26 and 1 or 0)
      line(A, x, y, nx, ny, S[1])
      line(A, x, y + 1, nx, ny + 1, S[6])
      x, y = nx, ny
    end
    -- A loose cable from the ceiling and its sparks.
    line(A, 46, 3, 44, 9, S[2]); line(A, 44, 9, 41, 13, S[2])
    if f == 1 or f == 3 then
      put(A, 41, 14, R.solar[7]); put(A, 40, 15, R.solar[6]); put(A, 42, 15, R.solar[5]); put(A, 39, 13, R.ice[7])
      if f == 3 then put(A, 43, 16, R.solar[6]); put(A, 38, 16, R.solar[5]) end
    end
    -- The Static: a few glitch streaks that jump between frames, and loose pixels.
    for k = 0, 4 do
      local yy = 5 + hash(k, f, 211) % 32
      local xx = 3 + hash(k, f, 223) % 50
      local len = 3 + hash(k, f, 227) % 7
      hline(A, xx, xx + len, yy, k % 2 == 0 and R.ice[5] or R.nova[5])
      if k == 0 then hline(A, xx + 2, xx + len + 3, yy + 1, R.ice[3]) end
    end
    for yy = 4, 37 do
      for xx = 2, W - 3 do
        local h = hash(xx, yy, 200 + f)
        if h < 5 then put(A, xx, yy, h % 2 == 0 and R.ice[5] or R.nova[5]) end
      end
    end
    return { casco = base.casco, maquina = base.maquina, efectos = base.efectos, averia = A }
  end
end

-- ── Output ──────────────────────────────────────────────────────────────────────────────────────────────────────
local COLOURS = {}
local function colour(c)
  local v = COLOURS[c]
  if not v then
    v = app.pixelColor.rgba(tonumber(c:sub(2, 3), 16), tonumber(c:sub(4, 5), 16), tonumber(c:sub(6, 7), 16), 255)
    COLOURS[c] = v
  end
  return v
end
local function image(L)
  local img = Image(W, H, ColorMode.RGB)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local c = L[y][x]
      if c then img:drawPixel(x, y, colour(c)) end
    end
  end
  return img
end

local NAMES = { 'casco', 'maquina', 'efectos', 'averia' }
local function build(name, paint)
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1] }
  layers[1].name = NAMES[1]
  for i = 2, #NAMES do
    layers[i] = spr:newLayer()
    layers[i].name = NAMES[i]
  end
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 0.18
    local out = paint(f - 1)
    for i, n in ipairs(NAMES) do
      if out[n] then spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
    end
  end
  spr:saveAs(OUT .. '/' .. name .. '.aseprite')
  local sheet = Image(W * FRAMES, H, ColorMode.RGB)
  for f = 1, FRAMES do
    local frame = Image(W, H, ColorMode.RGB)
    frame:drawSprite(spr, f)
    sheet:drawImage(frame, Point((f - 1) * W, 0))
  end
  sheet:saveAs(WEB .. '/' .. name .. '.png')
  spr:close()
end

local VARIANTS = {}
for _, id in ipairs({ 'scanner', 'planetarium', 'lab', 'hangar', 'collider', 'comms', 'archive', 'trophies' }) do
  VARIANTS[#VARIANTS + 1] = { id, function(f) return ROOMS[id](f, true) end }
end
for level = 1, 5 do
  VARIANTS[#VARIANTS + 1] = { 'refinery-' .. level, function(f) return refinery(level)(f, true) end }
  VARIANTS[#VARIANTS + 1] = { 'antenna-' .. level, function(f) return antenna(level)(f, true) end }
end
for _, id in ipairs({ 'scanner', 'planetarium', 'lab', 'hangar', 'collider', 'comms', 'refinery', 'antenna', 'archive', 'trophies' }) do
  VARIANTS[#VARIANTS + 1] = { id .. '-broken', broken(ROOMS[id]) }
end

for _, v in ipairs(VARIANTS) do
  if not ONLY or ONLY == v[1] then build(v[1], v[2]) end
end
