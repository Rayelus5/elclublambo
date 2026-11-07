-- Galaxy Survivor: the Laboratorio's node icons (GDD §10.6, §17.5; M4b-2 Task 6).
-- Paints each node's effect at 24×24 in two frames (a glow that breathes), in editable layers (fondo, icono, brillo),
-- in its branch's ramp (probe ice, relics ultraviolet, station solar, extraction terminal), saves the .aseprite and
-- exports the strip the Laboratorio plays with CSS steps(). Run from games/galaxy:
--   aseprite -b --script-param out=art/lab --script-param web=apps/web/src/lab/icons --script art/lab/paint-lab.lua
local W, H, FRAMES = 24, 24, 2
local OUT = app.params['out']
local WEB = app.params['web']
local ONLY = app.params['only']

local R = {
  steel = { '#0b0c24', '#1f2350', '#3a4278', '#6670b0', '#b9bfe6' },
  space = { '#070a1c', '#0d1130', '#151a44' },
  ice = { '#101a4a', '#3a58e0', '#6fb7ff', '#bfe3ff', '#f3f5ff' },
  uv = { '#1c1450', '#3a2a9a', '#7259ee', '#b39dff', '#e0d6ff' },
  solar = { '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#fff1b8' },
  term = { '#06302a', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9' },
}

local BAYER = { { 0, 8, 2, 10 }, { 12, 4, 14, 6 }, { 3, 11, 1, 9 }, { 15, 7, 13, 5 } }
local function bayer(x, y) return (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16 end

local function layer()
  local t = {}
  for y = 0, H - 1 do t[y] = {} end
  return t
end
local function put(L, x, y, c)
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  if c and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
end
local function rect(L, x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(L, x, y, c) end end
end
local function disc(L, cx, cy, r, c)
  for y = math.floor(cy - r) - 1, math.ceil(cy + r) + 1 do
    for x = math.floor(cx - r) - 1, math.ceil(cx + r) + 1 do
      if (x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2 <= r * r and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
    end
  end
end
local function ring(L, cx, cy, r, c, width)
  width = width or 0.7
  for y = math.floor(cy - r) - 2, math.ceil(cy + r) + 2 do
    for x = math.floor(cx - r) - 2, math.ceil(cx + r) + 2 do
      if math.abs(math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2) - r) < width and x >= 0 and y >= 0 and x < W and y < H then L[y][x] = c end
    end
  end
end
local function line(L, x0, y0, x1, y1, c)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do put(L, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c) end
end
--- A dithered halo of the ramp's dark colour around a point, on the background only.
local function halo(B, cx, cy, r, c, amount)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local d = math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2) / r
      if d < 1 and bayer(x, y) < (1 - d) * amount then B[y][x] = c end
    end
  end
end

local function background(ramp, f)
  local B = layer()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local d = math.sqrt((x + 0.5 - 12) ^ 2 + (y + 0.5 - 12) ^ 2) / 15
      B[y][x] = (d < 0.7 and bayer(x, y) < (0.7 - d) * 1.6) and R.space[3] or R.space[1]
    end
  end
  halo(B, 12, 12, 11, ramp[1], f == 0 and 0.55 or 0.8)
  return B
end

-- ── The icons ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Each paints its picture (I) and its glow (G, frame 1 brighter) with the branch ramp.
local P = {}

P.hull = function(I, G, f, r)
  -- An armour plate: a shield with rivets and a bright rim.
  for y = 4, 19 do
    local half = y < 13 and 7 or 7 - (y - 13) * 1.1
    for x = math.floor(12 - half), math.ceil(12 + half) - 1 do
      local edge = math.abs(x + 0.5 - 12) > half - 1.2 or y == 4
      put(I, x, y, edge and r[4] or (x < 12 and r[3] or r[2]))
    end
  end
  put(I, 9, 7, r[5]); put(I, 15, 7, r[5]); put(I, 12, 11, r[5])
  line(I, 8, 6, 8, 11, r[5])
  if f == 1 then put(G, 8, 5, r[5]); put(G, 9, 6, r[5]) end
end

P.thrusters = function(I, G, f, r)
  -- A thruster nozzle pointing down with its flame.
  rect(I, 8, 3, 15, 10, R.steel[4]); rect(I, 8, 3, 15, 3, R.steel[5]); rect(I, 9, 4, 10, 9, R.steel[5])
  for y = 11, 13 do local h = 3 + (y - 11) * 1.3; rect(I, math.floor(12 - h), y, math.ceil(12 + h) - 1, y, R.steel[3]) end
  local flame = f == 0 and 5 or 7
  for k = 0, flame do
    local h = math.max(0.5, 4 - k * 0.6)
    rect(I, math.floor(12 - h), 14 + k, math.ceil(12 + h) - 1, 14 + k, k < 2 and r[5] or k < 4 and r[4] or r[3])
  end
end

P.targeting = function(I, G, f, r)
  -- A crosshair locked on a dot.
  ring(I, 12, 12, 7.5, r[3], 0.7)
  ring(I, 12, 12, 4, r[4], 0.6)
  line(I, 12, 1, 12, 7, r[4]); line(I, 12, 17, 12, 22, r[4]); line(I, 1, 12, 7, 12, r[4]); line(I, 17, 12, 22, 12, r[4])
  disc(I, 12, 12, f == 0 and 1.2 or 1.8, r[5])
end

P.reactor = function(I, G, f, r)
  -- A reactor core: a glowing sphere inside a ring with fins.
  for k = 0, 7 do
    local a = k * math.pi / 4
    line(I, 12 + math.cos(a) * 8, 12 + math.sin(a) * 8, 12 + math.cos(a) * 10, 12 + math.sin(a) * 10, R.steel[4])
  end
  ring(I, 12, 12, 7.5, R.steel[4], 0.8)
  disc(I, 12, 12, 5.5, r[2]); disc(I, 11.4, 11.4, 4, r[3]); disc(I, 10.8, 10.8, 2.4, r[4]); disc(I, 10.5, 10.5, 1.1, r[5])
  if f == 1 then ring(G, 12, 12, 6.3, r[4], 0.4) end
end

P.resonance = function(I, G, f, r)
  -- An elemental crystal, faceted, with a spark.
  local pts = { { 12, 2 }, { 18, 9 }, { 15, 21 }, { 9, 21 }, { 6, 9 } }
  for y = 2, 21 do
    for x = 5, 18 do
      local inside = true
      for i = 1, #pts do
        local a, b = pts[i], pts[i % #pts + 1]
        if (b[1] - a[1]) * (y + 0.5 - a[2]) - (b[2] - a[2]) * (x + 0.5 - a[1]) < 0 then inside = false break end
      end
      if inside then put(I, x, y, x < 12 and (y < 10 and r[4] or r[3]) or r[2]) end
    end
  end
  line(I, 12, 3, 12, 20, r[5]); line(I, 7, 9, 17, 9, r[4])
  if f == 1 then put(G, 19, 4, r[5]); put(G, 18, 4, r[4]); put(G, 20, 4, r[4]); put(G, 19, 3, r[4]); put(G, 19, 5, r[4]) end
end

P.fortune = function(I, G, f, r)
  -- A four-point star with smaller ones around it.
  local function star(cx, cy, s, c, core)
    for k = 0, s do
      put(I, cx + k, cy, c); put(I, cx - k, cy, c); put(I, cx, cy + k, c); put(I, cx, cy - k, c)
    end
    disc(I, cx, cy, s * 0.35, core)
  end
  star(12, 12, 8, r[4], r[5])
  disc(I, 12, 12, 2.2, r[5])
  star(5, 5, 2, r[3], r[4])
  star(19, 18, f == 0 and 2 or 3, r[3], r[5])
end

P.recycling = function(I, G, f, r)
  -- A bright galaxy whose outer arm comes apart into dust.
  for arm = 0, 1 do
    for i = 0, 24 do
      local t = i / 24
      local a = arm * math.pi + t * 3.2 + f * 0.25
      local x, y = 10 + math.cos(a) * (1 + t * 7), 10 + math.sin(a) * (1 + t * 5.5)
      local c = t < 0.35 and r[5] or t < 0.7 and r[4] or r[3]
      put(I, x, y, c)
      if t < 0.7 then put(I, x + 1, y, t < 0.35 and r[4] or r[3]) end
    end
  end
  disc(I, 10, 10, 2.2, r[4]); disc(I, 10, 10, 1.2, r[5])
  for k = 0, 8 do
    local x, y = 14 + (k * 3) % 8, 14 + (k * 5) % 8 + (f == 1 and 1 or 0)
    put(I, x, y, k % 3 == 0 and r[5] or r[4])
  end
end

P['stable-fusion'] = function(I, G, f, r)
  -- Two orbs meeting in a bright seam.
  local d = f == 0 and 5 or 4
  disc(I, 12 - d, 12, 5, r[2]); disc(I, 11 - d, 11, 3.4, r[3]); disc(I, 10.4 - d, 10.4, 1.4, r[5])
  disc(I, 12 + d, 12, 5, r[2]); disc(I, 13 + d, 11, 3.4, r[3]); disc(I, 13.4 + d, 10.4, 1.4, r[5])
  line(I, 12, 6, 12, 18, r[5]); line(I, 11, 9, 11, 15, r[4]); line(I, 13, 9, 13, 15, r[4])
end

P.throughput = function(I, G, f, r)
  -- A gear with a flow arrow through it.
  local teeth = 8
  for k = 0, teeth - 1 do
    local a = k * 2 * math.pi / teeth + f * math.pi / teeth
    disc(I, 12 + math.cos(a) * 7.5, 12 + math.sin(a) * 7.5, 1.6, r[3])
  end
  disc(I, 12, 12, 7, r[3]); disc(I, 11.4, 11.4, 5.6, r[4]); disc(I, 12, 12, 2.4, R.space[1])
  line(I, 2, 20, 21, 20, r[5]); line(I, 19, 18, 21, 20, r[5]); line(I, 19, 22, 21, 20, r[5])
end

P.silos = function(I, G, f, r)
  -- A silo with a dome and its level window.
  rect(I, 6, 7, 17, 21, R.steel[3]); rect(I, 6, 7, 8, 21, R.steel[4]); rect(I, 15, 7, 17, 21, R.steel[2])
  for x = 6, 17 do local h = math.sqrt(math.max(0, 36 - (x + 0.5 - 12) ^ 2)) * 0.6; rect(I, x, math.floor(7 - h), x, 6, R.steel[4]) end
  rect(I, 10, 9, 13, 20, R.space[1])
  local top = f == 0 and 13 or 11
  rect(I, 10, top, 13, 20, r[3]); rect(I, 10, top, 13, top, r[5]); rect(I, 10, top + 1, 10, 20, r[4])
  line(I, 4, 22, 19, 22, R.steel[4])
end

P.receiver = function(I, G, f, r)
  -- A dish facing up and to the right on its mast, its focus lit, waves leaving it.
  rect(I, 8, 15, 9, 21, R.steel[4]); rect(I, 5, 21, 12, 22, R.steel[4])
  local cx, cy, a = 9, 13, -0.6
  local ca, sa = math.cos(a), math.sin(a)
  for i = -14, 14 do
    local u = i / 14
    local lx, ly = u * 7, -3 * u * u
    for d = 0, 2 do
      local x, y = cx + lx * ca - (ly + d) * sa, cy + lx * sa + (ly + d) * ca
      put(I, x, y, d == 0 and r[5] or d == 1 and r[4] or R.steel[4])
    end
  end
  local fx, fy = cx + 3 * sa, cy - 3 * ca
  line(I, cx, cy, fx, fy, R.steel[5])
  disc(I, fx, fy, 1.1, r[5])
  for k = 0, 1 do
    local rr = 4 + k * 4 + (f == 1 and 1 or 0)
    for t = -0.55, 0.55, 0.07 do
      local th = math.atan(-ca, sa) + t
      put(I, fx + math.cos(th) * rr, fy + math.sin(th) * rr, k == 0 and r[5] or r[4])
    end
  end
end

P.salvage = function(I, G, f, r)
  -- A scrap magnet lifting junk.
  line(I, 12, 1, 12, 5, R.steel[4])
  rect(I, 6, 5, 17, 9, r[3]); rect(I, 6, 5, 17, 5, r[5]); rect(I, 6, 9, 17, 9, r[2])
  local lift = f == 0 and 0 or -1
  rect(I, 7, 13 + lift, 10, 16 + lift, R.steel[4]); put(I, 7, 13 + lift, R.steel[5])
  rect(I, 13, 12 + lift, 17, 15 + lift, R.steel[3]); put(I, 13, 12 + lift, R.steel[5])
  rect(I, 9, 18, 14, 21, R.steel[4]); put(I, 9, 18, R.steel[5])
  for x = 7, 16, 3 do put(I, x, 11, r[4]) end
end

P.magnet = function(I, G, f, r)
  -- A horseshoe magnet pulling fragments.
  for y = 4, 14 do
    put(I, 5, y, r[3]); put(I, 6, y, r[4]); put(I, 7, y, r[3])
    put(I, 15, y, r[3]); put(I, 16, y, r[4]); put(I, 17, y, r[3])
  end
  for x = 5, 17 do
    local d = math.sqrt((x + 0.5 - 11.5) ^ 2) / 6.5
    local y = 14 + math.floor(math.sqrt(math.max(0, 1 - d * d)) * 5)
    put(I, x, y, r[4]); put(I, x, y - 1, r[3])
  end
  rect(I, 5, 4, 7, 6, R.steel[5]); rect(I, 15, 4, 17, 6, R.steel[5])
  local pull = f == 0 and 0 or 2
  put(I, 9, 1 + pull, r[5]); put(I, 13, 2 + pull, r[5]); put(I, 11, 0 + pull, r[4])
end

P.ledger = function(I, G, f, r)
  -- A coin over an open book.
  rect(I, 3, 14, 11, 20, R.steel[5]); rect(I, 12, 14, 20, 20, R.steel[4]); line(I, 11, 14, 11, 20, R.steel[3])
  for y = 16, 19, 2 do line(I, 5, y, 9, y, R.steel[3]); line(I, 14, y, 18, y, R.steel[3]) end
  local lift = f == 0 and 0 or -1
  disc(I, 12, 8 + lift, 5, r[2]); disc(I, 11.5, 7.5 + lift, 4, r[3]); disc(I, 11, 7 + lift, 2.4, r[4])
  line(I, 12, 5 + lift, 12, 10 + lift, r[5])
end

P.sieve = function(I, G, f, r)
  -- A sieve with dust falling through.
  for x = 3, 20 do local y = 8 + math.floor(((x + 0.5 - 11.5) / 8.5) ^ 2 * 3); put(I, x, y, R.steel[5]); put(I, x, y + 1, R.steel[4]) end
  for x = 4, 19, 2 do put(I, x, 7, r[3]) end
  for k = 0, 7 do
    local x = 6 + (k * 5) % 12
    local y = 13 + ((k * 3 + f * 2) % 9)
    put(I, x, y, k % 2 == 0 and r[5] or r[4])
  end
end

P.study = function(I, G, f, r)
  -- A closed book with a star on its cover.
  rect(I, 6, 4, 18, 20, r[2]); rect(I, 6, 4, 8, 20, r[3]); rect(I, 18, 5, 19, 20, R.steel[5])
  for y = 6, 19, 3 do put(I, 19, y, R.steel[3]) end
  local s = f == 0 and 3 or 4
  for k = 0, s do put(I, 13 + k, 11, r[5]); put(I, 13 - k, 11, r[5]); put(I, 13, 11 + k, r[5]); put(I, 13, 11 - k, r[5]) end
  disc(I, 13, 11, 1.2, r[5])
end

local BRANCH = {
  hull = 'ice', thrusters = 'ice', targeting = 'ice', reactor = 'ice',
  resonance = 'uv', fortune = 'uv', recycling = 'uv', ['stable-fusion'] = 'uv',
  throughput = 'solar', silos = 'solar', receiver = 'solar', salvage = 'solar',
  magnet = 'term', ledger = 'term', sieve = 'term', study = 'term',
}
local ORDER = { 'hull', 'thrusters', 'targeting', 'reactor', 'resonance', 'fortune', 'recycling', 'stable-fusion', 'throughput', 'silos', 'receiver', 'salvage', 'magnet', 'ledger', 'sieve', 'study' }

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

local NAMES = { 'fondo', 'icono', 'brillo' }
for _, id in ipairs(ORDER) do
  if not ONLY or ONLY == id then
    local ramp = R[BRANCH[id]]
    local spr = Sprite(W, H, ColorMode.RGB)
    local layers = { spr.layers[1] }
    layers[1].name = NAMES[1]
    for i = 2, #NAMES do
      layers[i] = spr:newLayer()
      layers[i].name = NAMES[i]
    end
    for f = 1, FRAMES do
      if f > 1 then spr:newEmptyFrame() end
      spr.frames[f].duration = 0.6
      local B, I, G = background(ramp, f - 1), layer(), layer()
      P[id](I, G, f - 1, ramp)
      local out = { fondo = B, icono = I, brillo = G }
      for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
    end
    spr:saveAs(OUT .. '/' .. id .. '.aseprite')
    local sheet = Image(W * FRAMES, H, ColorMode.RGB)
    for f = 1, FRAMES do
      local frame = Image(W, H, ColorMode.RGB)
      frame:drawSprite(spr, f)
      sheet:drawImage(frame, Point((f - 1) * W, 0))
    end
    sheet:saveAs(WEB .. '/' .. id .. '.png')
    spr:close()
  end
end
