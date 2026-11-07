-- Galaxy Survivor: the starting weapons and their variants (GDD §6, §17.5; M4b-1 Task 6).
-- Paints each weapon in action at 32×32 in four looping frames, in editable layers (fondo, arma, efectos), saves the
-- .aseprite and exports the horizontal strip the Hangar's cards play with CSS steps(). Run from games/galaxy:
--   aseprite -b --script-param out=art/weapons --script-param web=apps/web/src/hangar/weapons --script art/weapons/paint-weapons.lua
-- Optional: --script-param only=<id> paints just one.
local W, H, FRAMES = 32, 32, 4
local OUT = app.params['out']
local WEB = app.params['web']
local ONLY = app.params['only']

-- Ramps, dark to light (hue-shifted). A weapon paints with one ramp; an elemental variant swaps it for its element's.
local R = {
  steel = { '#0b0c24', '#1f2350', '#3a4278', '#6670b0', '#b9bfe6' },
  space = { '#04050f', '#070a1c', '#0d1130', '#151a44' },
  solar = { '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#fff1b8' },
  ice = { '#101a4a', '#3a58e0', '#6fb7ff', '#bfe3ff', '#f3f5ff' },
  cyan = { '#0d2a4a', '#1f7aa8', '#3fc8e8', '#9ff0ff', '#f3f5ff' },
  lilac = { '#2a1c6a', '#5a43d6', '#8f7cff', '#c9bcff', '#f3f0ff' },
  uv = { '#1c1450', '#3a2a9a', '#7259ee', '#b39dff', '#e0d6ff' },
  frost = { '#1d3a6a', '#3a78c8', '#7fd4ff', '#cff4ff', '#ffffff' },
  burn = { '#5a1d10', '#d2401c', '#ff8a2c', '#ffc94a', '#fff1b8' },
  shock = { '#3a3410', '#a08a1c', '#f2d84a', '#fff7a8', '#ffffff' },
  leech = { '#3a0a18', '#8a1430', '#d8334f', '#ff7a8a', '#ffd0d6' },
  corrosion = { '#123a14', '#2a7a22', '#6fd23c', '#c4ff7a', '#f0ffd0' },
  breach = { '#2a0f3a', '#6a2a9a', '#b04ae8', '#e09cff', '#ffe6ff' },
  hack = { '#06302a', '#0b7352', '#17b07e', '#45e3a6', '#a6ffd9' },
}
local PRISM = { R.frost, R.burn, R.corrosion, R.uv }

local function hash(x, y, s)
  local h = (x * 73856093) ~ (y * 19349663) ~ (s * 83492791)
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return h % 1000
end
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
      if (x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2 <= r * r then L[y] = L[y] or {}; if x >= 0 and x < W and y >= 0 and y < H then L[y][x] = c end end
    end
  end
end
local function ring(L, cx, cy, r, c, width)
  width = width or 0.75
  for y = math.floor(cy - r) - 2, math.ceil(cy + r) + 2 do
    for x = math.floor(cx - r) - 2, math.ceil(cx + r) + 2 do
      if math.abs(math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2) - r) < width and x >= 0 and x < W and y >= 0 and y < H then L[y][x] = c end
    end
  end
end
local function line(L, x0, y0, x1, y1, c)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do put(L, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c) end
end
--- A soft halo: dithered dark ramp colour around a point, only on empty or background pixels.
local function halo(L, B, cx, cy, r, c, amount)
  for y = math.floor(cy - r), math.ceil(cy + r) do
    for x = math.floor(cx - r), math.ceil(cx + r) do
      local d = math.sqrt((x + 0.5 - cx) ^ 2 + (y + 0.5 - cy) ^ 2) / r
      if d < 1 and x >= 0 and y >= 0 and x < W and y < H and not L[y][x] and bayer(x, y) < (1 - d) * (amount or 0.6) then L[y][x] = c end
    end
  end
end

-- The background: deep space with a lighter heart and a few twinkling stars.
local function background(f, seed)
  local B = layer()
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local d = math.sqrt((x + 0.5 - 16) ^ 2 + (y + 0.5 - 16) ^ 2) / 22
      local c = R.space[2]
      if d < 0.55 then c = bayer(x, y) < (0.55 - d) * 2.2 and R.space[4] or R.space[3]
      elseif d < 0.9 then c = bayer(x, y) < (0.9 - d) * 1.6 and R.space[3] or R.space[2] end
      B[y][x] = c
      local h = hash(x, y, seed)
      if h < 14 then
        local tw = (h + f) % 4
        B[y][x] = tw == 0 and R.ice[5] or tw == 1 and R.ice[4] or R.steel[4]
      end
    end
  end
  return B
end

-- ── The weapons ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Each paints (A = arma, E = efectos) for frame f with its ramp and its options.

local P = {}

--- A probe's nozzle on the left edge, the emitter of bolts and beams.
local function emitter(A, y)
  rect(A, 1, y - 2, 4, y + 2, R.steel[3]); rect(A, 1, y - 2, 4, y - 2, R.steel[4]); rect(A, 5, y - 1, 6, y + 1, R.steel[4])
  put(A, 1, y + 2, R.steel[2]); put(A, 6, y, R.steel[5])
end

P.pulse = function(A, E, f, ramp, o)
  local lanes = o.twin and { 10, 22 } or { 16 }
  for _, y in ipairs(lanes) do
    emitter(A, y)
    if f % 2 == 0 then disc(E, 8, y, 2.2, ramp[3]); put(A, 8, y, ramp[5]) end
    for k = 0, 1 do
      local x = 9 + ((f * 6 + k * 12) % 24)
      -- A bolt: a fading tail, a hot body and a white head, with a dithered glow.
      halo(E, A, x + 3, y, 5, ramp[2], 0.5)
      for t = 0, 3 do put(E, x - 4 + t, y, t < 2 and ramp[2] or ramp[3]) end
      rect(A, x, y - 1, x + 5, y + 1, ramp[3])
      rect(A, x + 1, y - 1, x + 5, y, ramp[4])
      rect(A, x + 4, y - 1, x + 6, y, ramp[5])
      put(A, x, y - 1, ramp[2]); put(A, x, y + 1, ramp[2])
    end
  end
end

P.nova = function(A, E, f, ramp, o)
  local s = o.wide and 1.35 or 1
  disc(A, 16, 16, 2.2, ramp[4]); disc(A, 16, 16, 1.2, ramp[5])
  local r = (4 + f * 3) * s
  ring(A, 16, 16, r, ramp[4], 0.8)
  ring(A, 16, 16, r - 1, ramp[3], 0.6)
  if r > 6 then ring(E, 16, 16, r - 3.5, ramp[2], 0.5) end
  if r < 14 then ring(E, 16, 16, r + 1.2, ramp[2], 0.4) end
  halo(E, A, 16, 16, 6, ramp[2], 0.5)
end

P.arc = function(A, E, f, ramp, o)
  local nodes = o.chain and { { 4, 24 }, { 11, 9 }, { 17, 22 }, { 23, 8 }, { 28, 20 } } or { { 4, 24 }, { 13, 9 }, { 21, 23 }, { 28, 10 } }
  for i = 2, #nodes do
    local n = nodes[i]
    disc(A, n[1], n[2], 2.6, R.steel[2]); disc(A, n[1], n[2], 1.9, R.steel[3]); put(A, n[1] - 1, n[2] - 1, R.steel[4])
  end
  -- The bolt jumps along the nodes, jagged differently each frame, bright core over a coloured shadow.
  local hit = (f % (#nodes - 1)) + 2
  for i = 1, hit - 1 do
    local a, b = nodes[i], nodes[i + 1]
    local steps = 4
    local px, py = a[1], a[2]
    for k = 1, steps do
      local t = k / steps
      local jx = (k < steps) and ((hash(i, k, f + 7) % 5) - 2) or 0
      local jy = (k < steps) and ((hash(k, i, f + 11) % 5) - 2) or 0
      local nx, ny = a[1] + (b[1] - a[1]) * t + jx, a[2] + (b[2] - a[2]) * t + jy
      line(E, px + 1, py + 1, nx + 1, ny + 1, ramp[2])
      line(A, px, py + 1, nx, ny + 1, ramp[3])
      line(A, px, py, nx, ny, ramp[5])
      px, py = nx, ny
    end
    disc(E, b[1], b[2], 3.6, ramp[2])
    if i == hit - 1 then disc(A, b[1], b[2], 2, ramp[4]) end
    put(A, b[1], b[2], ramp[5])
  end
  disc(A, nodes[1][1], nodes[1][2], 2.2, ramp[4]); put(A, nodes[1][1], nodes[1][2], ramp[5])
end

local function droneBody(A, x, y, ramp)
  -- A small craft: a steel hull, two wings and a glowing eye.
  rect(A, x - 2, y - 1, x + 2, y + 2, R.steel[4]); rect(A, x - 2, y - 1, x + 2, y - 1, R.steel[5])
  rect(A, x - 4, y, x - 3, y + 1, R.steel[3]); rect(A, x + 3, y, x + 4, y + 1, R.steel[3])
  put(A, x - 4, y, R.steel[4]); put(A, x + 4, y, R.steel[4])
  rect(A, x - 1, y, x + 1, y + 1, ramp[4]); put(A, x, y, ramp[5])
end

P.drone = function(A, E, f, ramp, o)
  -- The probe in the middle, lit from the upper left, inside a faint dotted orbit.
  for i = 0, 359, 12 do put(E, 16 + math.cos(math.rad(i)) * 10, 16 + math.sin(math.rad(i)) * 10, R.space[4]) end
  disc(A, 16, 16, 4.4, R.steel[2]); disc(A, 16, 16, 3.6, ramp[2]); disc(A, 15.4, 15.4, 2.4, ramp[3]); disc(A, 14.8, 14.8, 1.2, ramp[5])
  local count = o.twin and 2 or 1
  for k = 0, count - 1 do
    local a = f * math.pi / 2 + k * math.pi - math.pi / 4
    local x, y = 16 + math.cos(a) * 10, 16 + math.sin(a) * 10
    for t = 1, 3 do
      local b = a - t * 0.26
      put(E, 16 + math.cos(b) * 10, 16 + math.sin(b) * 10, t == 1 and ramp[4] or ramp[3])
    end
    droneBody(A, x, y, ramp)
    -- A shot leaving the drone outward.
    for t = 4, 6 do put(A, x + math.cos(a) * t, y + math.sin(a) * t, t == 6 and ramp[5] or ramp[4]) end
  end
end

P.field = function(A, E, f, ramp, o)
  local s = o.wide and 1.3 or 1
  local rot = f * math.pi / 4
  for arm = 0, 2 do
    for i = 0, 26 do
      local t = i / 26
      local r = (2 + t * 11) * s
      local a = arm * 2 * math.pi / 3 + t * 3.2 + rot
      local c = t < 0.3 and ramp[5] or t < 0.6 and ramp[4] or t < 0.85 and ramp[3] or ramp[2]
      put(A, 16 + math.cos(a) * r, 16 + math.sin(a) * r, c)
    end
  end
  ring(E, 16, 16, 12 * s, ramp[2], 0.5)
  disc(A, 16, 16, 2.2, R.space[1]); ring(A, 16, 16, 2.4, ramp[4], 0.5)
end

P.beam = function(A, E, f, ramp, o)
  local width = ({ 1, 2, 1, 0 })[f + 1]
  local beams = o.twin and { { 16, -0.18 }, { 16, 0.18 } } or { { 16, 0 } }
  emitter(A, 16)
  for _, b in ipairs(beams) do
    for x = 7, 31 do
      local y = b[1] + (x - 7) * b[2] * 1.2
      for dy = -width - 1, width + 1 do
        local c = math.abs(dy) <= width - 1 and ramp[5] or math.abs(dy) <= width and ramp[4] or ramp[2]
        if math.abs(dy) == width + 1 then
          if bayer(x, math.floor(y + dy)) < 0.6 then put(E, x, y + dy, c) end
        else
          put(A, x, y + dy, c)
        end
      end
    end
  end
  -- Sparks where it hits the edge.
  for k = 0, 2 do put(E, 29 + (hash(k, f, 5) % 3), 13 + (hash(f, k, 9) % 7), ramp[4]) end
end

local function blade(A, E, x, y, f, ramp)
  -- A spinning disc with three blades and a hollow hub.
  disc(A, x, y, 4.2, ramp[2]); disc(A, x, y, 3.4, ramp[3]); disc(A, x - 0.6, y - 0.6, 2, ramp[4]); disc(A, x, y, 1.1, R.space[2])
  for k = 0, 2 do
    local a = f * math.pi / 6 + k * 2 * math.pi / 3
    put(A, x + math.cos(a) * 4.4, y + math.sin(a) * 4.4, ramp[5])
    put(A, x + math.cos(a + 0.35) * 4, y + math.sin(a + 0.35) * 4, ramp[4])
  end
end

P.boomerang = function(A, E, f, ramp, o)
  local count = o.twin and 2 or 1
  for k = 0, count - 1 do
    local a = f * math.pi / 2 + k * math.pi
    local x, y = 16 + math.cos(a) * 9, 16 + math.sin(a) * 6
    for t = 1, 5 do
      local b = a - t * 0.25
      local c = t <= 2 and ramp[3] or ramp[2]
      put(E, 16 + math.cos(b) * 9, 16 + math.sin(b) * 6, c); put(E, 16 + math.cos(b) * 9, 16 + math.sin(b) * 6 + 1, c)
    end
    blade(A, E, x, y, f, ramp)
  end
  if o.pierce then
    for k = 0, 2 do line(E, 6 + k * 9, 26 - (k % 2) * 2, 9 + k * 9, 23, ramp[4]) end
  end
end

P.turret = function(A, E, f, ramp, o)
  -- The base and its barrel, pointing up and to the right; the shells take the weapon's ramp.
  rect(A, 5, 22, 16, 27, R.steel[3]); rect(A, 5, 22, 16, 22, R.steel[4]); rect(A, 4, 27, 17, 28, R.steel[2])
  for x = 7, 15, 3 do put(A, x, 25, R.steel[2]) end
  disc(A, 11, 21, 3.4, R.steel[4]); disc(A, 10.4, 20.4, 1.4, R.steel[5])
  line(A, 12, 19, 19, 12, R.steel[4]); line(A, 13, 20, 20, 13, R.steel[3]); line(A, 13, 19, 20, 12, R.steel[5])
  local n = o.rapid and 4 or 2
  for k = 0, n - 1 do
    local t = ((f / FRAMES) + k / n) % 1
    local x, y = 21 + t * 10, 11 - t * 10
    rect(A, x, y, x + 1, y + 1, ramp[4]); put(A, x + 1, y, ramp[5])
    put(E, x - 1, y + 2, ramp[3]); put(E, x - 2, y + 3, ramp[2])
  end
  if f == 0 or (o.rapid and f == 2) then
    disc(E, 21, 11, 3.2, ramp[2]); disc(A, 21, 11, 1.8, ramp[4]); put(A, 21, 11, ramp[5])
  end
end

-- ── Element particles ───────────────────────────────────────────────────────────────────────────────────────────
local PARTICLES = {
  slow = function(E, f, ramp)
    for k = 0, 4 do
      local x, y = 4 + (hash(k, 1, 3) % 24), (4 + hash(k, 2, 3) % 24 + f * 2) % 30
      put(E, x, y, ramp[5]); put(E, x - 1, y, ramp[4]); put(E, x + 1, y, ramp[4]); put(E, x, y - 1, ramp[4]); put(E, x, y + 1, ramp[4])
    end
  end,
  burn = function(E, f, ramp)
    for k = 0, 6 do
      local x, y = 6 + (hash(k, 1, 5) % 20), 26 - ((hash(k, 2, 5) % 14 + f * 3) % 22)
      put(E, x, y, ramp[4]); put(E, x, y + 1, ramp[3]); if k % 2 == 0 then put(E, x, y - 1, ramp[5]) end
    end
  end,
  shock = function(E, f, ramp)
    for k = 0, 3 do
      local x, y = 5 + (hash(k, f, 7) % 22), 5 + (hash(f, k, 7) % 22)
      put(E, x, y, ramp[5]); put(E, x + 1, y + 1, ramp[4]); put(E, x, y + 2, ramp[3])
    end
  end,
  leech = function(E, f, ramp)
    for k = 0, 4 do
      local a = k * 1.3 + f * 0.4
      local r = 13 - ((f * 3 + k * 2) % 9)
      local x, y = 16 + math.cos(a) * r, 16 + math.sin(a) * r
      put(E, x, y, ramp[4]); put(E, x, y + 1, ramp[3])
    end
  end,
  corrosion = function(E, f, ramp)
    for k = 0, 5 do
      local x, y = 5 + (hash(k, 4, 9) % 22), 28 - ((hash(k, 5, 9) % 12 + f * 4) % 24)
      ring(E, x, y, 1.2, ramp[4], 0.45); put(E, x - 0.4, y - 0.6, ramp[5])
    end
  end,
  breach = function(E, f, ramp)
    for k = 0, 2 do
      local x, y = 4 + (hash(k, f, 13) % 22), 4 + (hash(f, k, 13) % 22)
      line(E, x, y, x + 3, y + 2, ramp[4]); put(E, x + 1, y + 2, ramp[3])
    end
  end,
  hack = function(E, f, ramp)
    for k = 0, 6 do
      if hash(k, f, 17) % 3 ~= 0 then
        local x, y = 3 + (hash(k, 6, 17) % 26), 3 + (hash(k, 7, 17) % 26)
        rect(E, x, y, x + 1, y, ramp[4]); put(E, x, y + 1, ramp[3])
      end
    end
  end,
}

-- ── The catalogue ───────────────────────────────────────────────────────────────────────────────────────────────
-- id, painter, base ramp, options, element (a variant's element swaps the ramp and adds its particles).
local WEAPONS = {
  { 'pulse', 'pulse', 'solar', {} },
  { 'pulse-twin', 'pulse', 'solar', { twin = true } },
  { 'pulse-frost', 'pulse', 'solar', {}, 'slow' },
  { 'nova', 'nova', 'ice', {} },
  { 'nova-wide', 'nova', 'ice', { wide = true } },
  { 'nova-ember', 'nova', 'ice', {}, 'burn' },
  { 'arc', 'arc', 'lilac', {} },
  { 'arc-chain', 'arc', 'lilac', { chain = true } },
  { 'arc-shock', 'arc', 'lilac', {}, 'shock' },
  { 'drone', 'drone', 'cyan', {} },
  { 'drone-pair', 'drone', 'cyan', { twin = true } },
  { 'drone-leech', 'drone', 'cyan', {}, 'leech' },
  { 'field', 'field', 'uv', {} },
  { 'field-wide', 'field', 'uv', { wide = true } },
  { 'field-corrosion', 'field', 'uv', {}, 'corrosion' },
  { 'beam', 'beam', 'lilac', {} },
  { 'beam-split', 'beam', 'lilac', { twin = true } },
  { 'beam-prism', 'beam', 'lilac', {}, 'prism' },
  { 'boomerang', 'boomerang', 'cyan', {} },
  { 'boomerang-twin', 'boomerang', 'cyan', { twin = true } },
  { 'boomerang-breach', 'boomerang', 'cyan', { pierce = true }, 'breach' },
  { 'turret', 'turret', 'solar', {} },
  { 'turret-rapid', 'turret', 'solar', { rapid = true } },
  { 'turret-hack', 'turret', 'solar', {}, 'hack' },
}

local ELEMENT_RAMP = { slow = R.frost, burn = R.burn, shock = R.shock, leech = R.leech, corrosion = R.corrosion, breach = R.breach, hack = R.hack }

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

local NAMES = { 'fondo', 'efectos', 'arma' }
local function build(entry, seed)
  local id, painter, rampName, opts, element = entry[1], entry[2], entry[3], entry[4], entry[5]
  local spr = Sprite(W, H, ColorMode.RGB)
  local layers = { spr.layers[1] }
  layers[1].name = NAMES[1]
  for i = 2, #NAMES do
    layers[i] = spr:newLayer()
    layers[i].name = NAMES[i]
  end
  for f = 1, FRAMES do
    if f > 1 then spr:newEmptyFrame() end
    spr.frames[f].duration = 0.15
    local ramp = element == 'prism' and PRISM[f] or (element and ELEMENT_RAMP[element]) or R[rampName]
    local B, A, E = background(f - 1, seed), layer(), layer()
    P[painter](A, E, f - 1, ramp, opts)
    if element and PARTICLES[element] then PARTICLES[element](E, f - 1, ramp) end
    local out = { fondo = B, efectos = E, arma = A }
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

for i, entry in ipairs(WEAPONS) do
  if not ONLY or ONLY == entry[1] then build(entry, 40 + i) end
end
