-- Galaxy Survivor: the planetarium's dome (GDD §10.5, DESIGN_SYSTEM §8 decies).
-- Paints the dome at 192×96 in eight frames, in editable layers (cupula, rayos, estrellas, escenario, hologramas,
-- proyector), saves the .aseprite and exports the horizontal strip the web plays with CSS steps(8). The six exhibited
-- cards stand over the six pedestals in the DOM (centres at x = 18, 46, 74, 118, 146, 174; pedestal tops at y = 84).
-- Run from games/galaxy:
--   aseprite -b --script-param out=art/planetarium --script-param web=apps/web/src/planetarium/art --script art/planetarium/paint-planetarium.lua
local W, H, FRAMES = 192, 96, 8
local OUT = app.params['out']
local WEB = app.params['web']

-- The station's ramps (art/station/paint-rooms.lua), dark to light.
local R = {
  steel = { '#07081a', '#0b0c24', '#151838', '#1f2350', '#2a2f5e', '#3a4278', '#4b5390', '#6670b0', '#8890c4', '#b9bfe6' },
  space = { '#04050f', '#070a1c', '#0d1130' },
  ice = { '#101a4a', '#26389a', '#3a58e0', '#6fb7ff', '#6fe3ff', '#bfe3ff', '#f3f5ff' },
  solar = { '#3a1410', '#5a1d10', '#c25f1c', '#ff9a3c', '#ffc94a', '#ffe9a8', '#fff8e0' },
  uv = { '#1c1450', '#3a2a9a', '#5a43d6', '#7259ee', '#b39dff', '#e0d6ff' },
  coral = { '#4a1a30', '#c94f7c', '#ff8fb3' },
}
local S = R.steel
local PEDESTALS = { 18, 46, 74, 118, 146, 174 }

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
local function line(L, x0, y0, x1, y1, c, keep)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, n do
    local x, y = math.floor(x0 + (x1 - x0) * i / n + 0.5), math.floor(y0 + (y1 - y0) * i / n + 0.5)
    if not keep or keep(x, y, i / n) then put(L, x, y, c) end
  end
end

-- The dome: a hemisphere seen from its floor, a little from below. Azimuth th in [0, π] is the half in front of the
-- viewer; elevation ph in [0, π/2]. The rim (ph = 0) bows up in the middle, so the circles of latitude read as arcs.
local CX, CY, RX, RY, TILT = 96, 76, 92, 70, 9
local function project(th, ph)
  return CX - RX * math.cos(ph) * math.cos(th), CY - RY * math.sin(ph) - TILT * math.cos(ph) * math.sin(th)
end
local function inDome(x, y)
  local dx, dy = (x + 0.5 - CX) / RX, (y + 0.5 - CY) / RY
  return dx * dx + dy * dy < 1 and y < CY
end
--- The rim's height at column x (the circle ph = 0 seen from below).
local function rimY(x)
  local c = (CX - (x + 0.5)) / RX
  if c < -1 or c > 1 then return CY end
  return CY - TILT * math.sqrt(1 - c * c)
end

local function cupula()
  local L = layer()
  rect(L, 0, 0, W - 1, H - 1, R.space[1])
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if inDome(x, y) and y < rimY(x) then
        -- Deep at the zenith, a violet haze toward the rim.
        local dx, dy = (x + 0.5 - CX) / RX, (y + 0.5 - CY) / RY
        local d = math.sqrt(dx * dx + dy * dy)
        local b = bayer(x, y)
        local c = R.space[2]
        if d > 0.55 and b < (d - 0.55) * 2.2 then c = R.space[3] end
        if d > 0.8 and b < (d - 0.8) * 3.2 then c = R.uv[1] end
        put(L, x, y, c)
      end
    end
  end
  -- The reticle: meridians every π/8 and three circles of latitude, faint, dotted.
  for k = 1, 7 do
    local th = k * math.pi / 8
    local px, py
    for i = 0, 60 do
      local x, y = project(th, i / 60 * math.pi / 2)
      if px and (i % 2 == 0) then line(L, px, py, x, y, S[3]) end
      px, py = x, y
    end
  end
  for _, ph in ipairs({ math.pi / 8, math.pi / 4, 3 * math.pi / 8 }) do
    for i = 0, 180 do
      if i % 3 ~= 2 then
        local x, y = project(i / 180 * math.pi, ph)
        if get(L, x, y) then put(L, x, y, S[3]) end
      end
    end
  end
  -- The ring at the dome's base, with its lip.
  for x = 0, W - 1 do
    local y = math.floor(rimY(x))
    if inDome(x, y - 1) or x > 4 and x < W - 5 then
      put(L, x, y, S[6]); put(L, x, y + 1, S[4]); put(L, x, y + 2, S[2])
    end
  end
  return L
end

-- Stars: 40 seeds, each repeated four times around the zenith, so a turn of π/2 gives the same sky; frame f turns
-- (π/2)·f/8 and the loop is seamless.
local function sky(f)
  local L, rays = layer(), layer()
  local rot = f * (math.pi / 2) / FRAMES
  local stars = {}
  for k = 0, 39 do
    local th0 = hash(k, 1, 7) / 1000 * (math.pi / 2)
    local ph = (hash(k, 2, 7) / 1000) ^ 0.8 * (math.pi / 2) * 0.92 + 0.06
    local size = hash(k, 3, 7)
    for q = 0, 3 do
      local th = (th0 + q * math.pi / 2 + rot) % (2 * math.pi)
      if th > 0.05 and th < math.pi - 0.05 then
        local x, y = project(th, ph)
        stars[#stars + 1] = { x = x, y = y, size = size, k = k, q = q }
      end
    end
  end
  -- Four nebulae, one a quarter, soft and dithered, turning with the stars.
  for q = 0, 3 do
    local th = (0.7 + q * math.pi / 2 + rot) % (2 * math.pi)
    if th > 0.1 and th < math.pi - 0.1 then
      for j = 0, 140 do
        local dth = (hash(j, 11, 5) / 1000 - 0.5) * 0.9
        local dph = (hash(j, 12, 5) / 1000 - 0.5) * 0.5
        local x, y = project(th + dth, 0.55 + dph)
        local d = math.sqrt((dth / 0.45) ^ 2 + (dph / 0.25) ^ 2)
        if inDome(x, y) and y < rimY(x) - 1 and d < 1 then
          -- The same in every quarter, so the turn of π/2 that closes the loop leaves the sky unchanged.
          local c = d < 0.3 and R.coral[2] or d < 0.6 and R.uv[3] or R.uv[2]
          put(L, x, y, c)
          if d < 0.6 then put(L, x + 1, y, d < 0.3 and R.coral[1] or R.uv[2]) end
        end
      end
    end
  end
  -- Constellations: the first seeds of each quarter, joined in a chain.
  local chain = {}
  for _, s in ipairs(stars) do
    if s.k < 6 then
      chain[s.q] = chain[s.q] or {}
      chain[s.q][s.k] = s
    end
  end
  for _, c in pairs(chain) do
    for k = 0, 4 do
      local a, b = c[k], c[k + 1]
      if a and b then line(L, a.x, a.y, b.x, b.y, R.uv[2], function(x, y) return inDome(x, y) and y < rimY(x) - 1 and bayer(x, y) < 0.6 end) end
    end
  end
  for _, s in ipairs(stars) do
    if inDome(s.x, s.y) and s.y < rimY(s.x) - 1 then
      local tw = (s.k + s.q + f) % 4
      if s.size > 930 then
        put(L, s.x, s.y, R.ice[7])
        put(L, s.x - 1, s.y, R.ice[5]); put(L, s.x + 1, s.y, R.ice[5])
        put(L, s.x, s.y - 1, R.ice[5]); put(L, s.x, s.y + 1, R.ice[5])
      elseif s.size > 700 then
        put(L, s.x, s.y, tw == 0 and R.ice[7] or R.ice[6])
      elseif s.k < 6 then
        put(L, s.x, s.y, R.uv[5])
      else
        put(L, s.x, s.y, tw == 0 and S[9] or tw == 1 and S[8] or S[7])
      end
    end
  end
  -- The projector's beams: four, turning with the sky, faint and dithered.
  for q = 0, 3 do
    local th = (q * math.pi / 2 + math.pi / 4 + rot) % (2 * math.pi)
    if th > 0.2 and th < math.pi - 0.2 then
      local tx, ty = project(th, 0.85)
      line(rays, CX, 70, tx, ty, R.uv[2], function(x, y, t) return y < rimY(x) and bayer(x, y) < 0.42 * (1 - t) + 0.08 end)
      line(rays, CX + 1, 70, tx + 2, ty, R.uv[1], function(x, y, t) return y < rimY(x) and bayer(x, y) < 0.3 * (1 - t) end)
    end
  end
  return L, rays
end

-- The stage under the dome: a dark wall with seams and the ring's lamps chasing, then a grated floor and the six
-- pedestals.
local function escenario(f)
  local L = layer()
  for x = 0, W - 1 do
    local top = math.floor(rimY(x)) + 3
    for y = top, 83 do
      local c = S[3]
      if x % 24 == 0 then c = S[2] elseif x % 24 == 1 then c = S[4] end
      if y == top then c = S[2] end
      put(L, x, y, c)
    end
  end
  -- Lamps in the ring, one in four lit and running.
  for k = 0, 23 do
    local x = 4 + k * 8
    local y = math.floor(rimY(x)) + 1
    local lit = (k + f) % 4 == 0
    put(L, x, y, lit and R.solar[6] or R.solar[2])
    if lit then put(L, x - 1, y, R.solar[4]); put(L, x + 1, y, R.solar[4]) end
  end
  -- Floor: grate lines toward the viewer.
  for y = 84, H - 1 do
    for x = 0, W - 1 do
      local c = (y % 3 == 0) and S[2] or S[3]
      if (x + (y - 84) * ((x - CX) > 0 and 1 or -1) // 3) % 12 == 0 then c = S[2] end
      put(L, x, y, c)
    end
  end
  hline(L, 0, W - 1, 84, S[5])
  -- Pedestals: hexagonal plinths with a lit top and an emitter.
  for i, px in ipairs(PEDESTALS) do
    local x0, x1 = px - 8, px + 8
    for y = 85, 93 do
      local inset = (y >= 92) and 1 or 0
      for x = x0 + inset, x1 - inset do
        local t = (x - x0) / (x1 - x0)
        local c = t < 0.25 and S[6] or t < 0.7 and S[5] or S[4]
        put(L, x, y, c)
      end
    end
    hline(L, x0 + 1, x1 - 1, 85, S[8])
    hline(L, x0, x1, 94, S[1])
    vline(L, x0, 85, 91, S[2]); vline(L, x1, 85, 91, S[2])
    -- A plate with the pedestal's number of lights.
    for k = 0, 2 do put(L, px - 2 + k * 2, 89, ((k + f + i) % 3 == 0) and R.ice[5] or R.ice[2]) end
  end
  return L
end

-- Holograms: a cone of light from each emitter, crisp at its edges and sparse inside, with a scanline that climbs two
-- pixels a frame (a loop in 8).
local function hologramas(f)
  local L = layer()
  for i, px in ipairs(PEDESTALS) do
    disc(L, px, 84, 3, R.ice[3], 0.5)
    hline(L, px - 1, px + 1, 84, R.ice[6])
    for y = 48, 83 do
      local t = (83 - y) / 35
      local half = 2.5 + t * 9
      local scan = ((y + f * 2 + i * 3) % 16) == 0
      local l, r = math.floor(px - half), math.ceil(px + half) - 1
      if y % 2 == 0 or t < 0.2 then put(L, l, y, R.ice[4]); put(L, r, y, R.ice[4]) end
      for x = l + 1, r - 1 do
        if scan then
          if (x + y) % 2 == 0 then put(L, x, y, R.ice[5]) end
        elseif bayer(x, y) < 0.1 - t * 0.06 then
          put(L, x, y, R.ice[3])
        end
      end
    end
    -- The light it throws on the floor.
    for y = 86, H - 1 do
      for x = px - 12, px + 12 do
        local d = math.abs(x + 0.5 - px) / 12 + (y - 86) / 14
        local onPlinth = y <= 94 and math.abs(x - px) <= 8
        if d < 1 and not onPlinth and bayer(x, y) < (1 - d) * 0.35 then put(L, x, y, R.ice[1]) end
      end
    end
  end
  return L
end

-- The star ball on its column in the middle of the stage: its lenses turn with the sky (12 of them, a twelfth per
-- loop).
local function proyector(f)
  local L = layer()
  -- Column and base.
  for x = CX - 4, CX + 4 do
    local t = (x - (CX - 4)) / 8
    local c = t < 0.3 and S[7] or t < 0.7 and S[5] or S[4]
    vline(L, x, 79, 92, c)
  end
  vline(L, CX - 5, 79, 92, S[2]); vline(L, CX + 5, 79, 92, S[2])
  rect(L, CX - 9, 91, CX + 9, 94, S[4]); hline(L, CX - 8, CX + 8, 91, S[7]); hline(L, CX - 9, CX + 9, 95, S[1])
  -- The ball, with its halo.
  for y = 58, 84 do
    for x = CX - 14, CX + 14 do
      local d = math.sqrt((x + 0.5 - CX) ^ 2 + (y + 0.5 - 70) ^ 2)
      if d > 9 and d < 14 and bayer(x, y) < (14 - d) / 5 * 0.45 then put(L, x, y, R.uv[2]) end
    end
  end
  disc(L, CX, 70, 9, S[4])
  disc(L, CX - 2, 68, 6, S[5])
  disc(L, CX - 3, 67, 3, S[7])
  put(L, CX - 4, 66, S[9])
  local rot = f * (2 * math.pi / 12) / FRAMES
  for row = -1, 1 do
    local lat = row * 0.55
    for k = 0, 11 do
      local a = k * 2 * math.pi / 12 + rot + row * 0.26
      local z = math.cos(a)
      if z > 0.15 then
        local x = CX + 8 * math.sin(a) * math.cos(lat)
        local y = 70 + 8 * math.sin(lat)
        local c = z > 0.7 and R.uv[6] or z > 0.4 and R.uv[5] or R.uv[3]
        put(L, x, y, c)
        if z > 0.7 then put(L, x + 1, y, R.uv[4]) end
      end
    end
  end
  -- Its ring and the glow under it.
  for x = CX - 9, CX + 9 do put(L, x, 79, (x % 2 == 0) and S[8] or S[6]) end
  return L
end

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

local NAMES = { 'cupula', 'rayos', 'estrellas', 'escenario', 'hologramas', 'proyector' }
local spr = Sprite(W, H, ColorMode.RGB)
local layers = { spr.layers[1] }
layers[1].name = NAMES[1]
for i = 2, #NAMES do
  layers[i] = spr:newLayer()
  layers[i].name = NAMES[i]
end
local base = cupula()
for f = 1, FRAMES do
  if f > 1 then spr:newEmptyFrame() end
  spr.frames[f].duration = 0.2
  local stars, rays = sky(f - 1)
  local out = { cupula = base, rayos = rays, estrellas = stars, escenario = escenario(f - 1), hologramas = hologramas(f - 1), proyector = proyector(f - 1) }
  for i, n in ipairs(NAMES) do spr:newCel(layers[i], f, image(out[n]), Point(0, 0)) end
end
spr:saveAs(OUT .. '/dome.aseprite')
local sheet = Image(W * FRAMES, H, ColorMode.RGB)
for f = 1, FRAMES do
  local frame = Image(W, H, ColorMode.RGB)
  frame:drawSprite(spr, f)
  sheet:drawImage(frame, Point((f - 1) * W, 0))
end
sheet:saveAs(WEB .. '/dome.png')
spr:close()
